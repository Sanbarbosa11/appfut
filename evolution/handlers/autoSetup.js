require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var crypto      = require('crypto');
var db          = require('../database/connection');

function slugify(nome) {
  return (nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // remove especiais
    .trim()
    .replace(/\s+/g, '-')         // espacos → hifens
    .slice(0, 40);
}
var { delay }   = require('../utils/rateLimit');
var createClient = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var metaNumber   = process.env.META_BOT_NUMBER     || '5511995421741';
// Problema 11: JID do proprio bot para detectar quando e removido do grupo
var BOT_JID      = process.env.BOT_JID             || '';

function nomeDoJid(jid) {
  return (jid || '').replace(/@.*$/, '');
}

// Garante que o grupo tenha invite_token e retorna o token atual.
// Token = slug do nome do grupo (ex: "rachao-da-rua").
// Se o slug ja estiver em uso por outro grupo, adiciona sufixo de 4 chars.
// Fallback para hex aleatorio se o nome nao gerar slug valido.
async function garantirInviteToken(grupoId, groupName) {
  var [rows] = await db.execute('SELECT invite_token FROM grupos WHERE id = ?', [grupoId]);
  if (rows.length > 0 && rows[0].invite_token) return rows[0].invite_token;

  var base  = slugify(groupName) || crypto.randomBytes(4).toString('hex');
  var token = base;

  // Garante unicidade
  var [dup] = await db.execute(
    'SELECT id FROM grupos WHERE invite_token = ? AND id != ?', [token, grupoId]
  );
  if (dup.length > 0) {
    token = base + '-' + crypto.randomBytes(2).toString('hex');
  }

  await db.execute('UPDATE grupos SET invite_token = ? WHERE id = ?', [token, grupoId]);
  return token;
}

async function registrarGrupo(groupId, groupName, participants) {
  await db.execute(
    'INSERT INTO grupos (whatsapp_id, nome, ativo) VALUES (?, ?, TRUE) ON DUPLICATE KEY UPDATE nome = VALUES(nome)',
    [groupId, groupName]
  );
  var [rows]  = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
  var grupoId = rows[0].id;

  for (var p of participants) {
    var jid = p.id || p;
    // JIDs @lid sao IDs de privacidade — nao tem como mapear para o numero real.
    // Esses membros se registram via link "entrar" ao clicar na boas-vindas.
    if (String(jid).endsWith('@lid')) continue;

    var nome = p.pushName || p.name || nomeDoJid(jid);
    await db.execute(
      'INSERT INTO jogadores (whatsapp_id, nome) VALUES (?, ?) ON DUPLICATE KEY UPDATE whatsapp_id = whatsapp_id',
      [jid, nome]
    );
    var [jrows]   = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [jid]);
    var jogadorId = jrows[0].id;

    await db.execute(
      'INSERT INTO grupo_jogadores (grupo_id, jogador_id, ativo) VALUES (?, ?, TRUE) ON DUPLICATE KEY UPDATE ativo = TRUE',
      [grupoId, jogadorId]
    );

    if (p.admin === 'admin' || p.admin === 'superadmin') {
      await db.execute(
        'INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)',
        [grupoId, jid]
      );
    }
  }

  console.log('[autoSetup] Grupo registrado:', groupName, '| membros:', participants.length);
  return grupoId;
}

async function handleGroupsUpsert(data) {
  var groups = Array.isArray(data) ? data : [data];
  for (var g of groups) {
    try {
      var grupoId = await registrarGrupo(g.id, g.subject || g.id, g.participants || []);

      if (!metaNumber) continue;

      var [rows] = await db.execute('SELECT boas_vindas_at FROM grupos WHERE whatsapp_id = ?', [g.id]);
      if (rows.length === 0 || rows[0].boas_vindas_at !== null) continue;

      var groupName = g.subject || g.id;
      // Problema 5: token baseado no nome do grupo (legivel) — nao ID sequencial
      var token     = await garantirInviteToken(grupoId, groupName);
      var link      = 'https://wa.me/' + metaNumber + '?text=entrar%20' + token;

      var client = createClient();
      await delay();
      await client.message.sendText(instanceName, g.id,
        '⚽ AppFut chegou!\n\n' +
        'Olá, ' + groupName + '! \n' +
        'Sou o bot de gestão do rachão.\n\n' +
        '📲 Para você Confirmar/Cancelar a presença, Clique no WhatsApp:\n' +
        link + '\n\n' +
        '📋 Comandos aqui no grupo:\n' +
        '*!lista* — ver lista de confirmados\n' +
        '*!ajuda* — ver ajuda\n\n' +
        'Cada membro deve clicar no link uma única vez para se cadastrar.'
      );
      await db.execute('UPDATE grupos SET boas_vindas_at = NOW() WHERE whatsapp_id = ?', [g.id]);
      console.log('[autoSetup] Boas-vindas enviadas para:', g.id);
    } catch(e) {
      console.error('[autoSetup] Erro GROUPS_UPSERT', g.id, ':', e.message);
    }
  }
}

async function handleGroupParticipantsUpdate(data) {
  var groupId      = data.id;
  var participants = data.participants || [];
  var action       = data.action;

  var [grupos] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
  if (grupos.length === 0) {
    console.log('[autoSetup] Grupo nao cadastrado, ignorando update:', groupId);
    return;
  }
  var grupoId = grupos[0].id;

  // Problema 11: detectar se o proprio bot foi removido do grupo
  if (action === 'remove' && BOT_JID) {
    var botBase    = BOT_JID.split('@')[0];
    var botRemovido = participants.some(function(jid) {
      return String(jid) === BOT_JID || String(jid).startsWith(botBase);
    });
    if (botRemovido) {
      await db.execute('UPDATE grupos SET ativo = FALSE WHERE whatsapp_id = ?', [groupId]);
      console.log('[autoSetup] Bot removido do grupo, desativado:', groupId);
      return;
    }
  }

  for (var jid of participants) {
    try {
      if (action === 'add') {
        if (String(jid).endsWith('@lid')) continue;
        var nome = nomeDoJid(jid);
        await db.execute(
          'INSERT INTO jogadores (whatsapp_id, nome) VALUES (?, ?) ON DUPLICATE KEY UPDATE whatsapp_id = whatsapp_id',
          [jid, nome]
        );
        var [jrows] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [jid]);
        await db.execute(
          'INSERT INTO grupo_jogadores (grupo_id, jogador_id, ativo) VALUES (?, ?, TRUE) ON DUPLICATE KEY UPDATE ativo = TRUE',
          [grupoId, jrows[0].id]
        );
        console.log('[autoSetup] Membro adicionado:', jid);

      } else if (action === 'remove') {
        await db.execute(
          'UPDATE grupo_jogadores gj JOIN jogadores j ON gj.jogador_id = j.id SET gj.ativo = FALSE WHERE gj.grupo_id = ? AND j.whatsapp_id = ?',
          [grupoId, jid]
        );
        console.log('[autoSetup] Membro removido:', jid);

      } else if (action === 'promote') {
        await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [grupoId, jid]);
        console.log('[autoSetup] Admin promovido:', jid);

      } else if (action === 'demote') {
        await db.execute('DELETE FROM admins WHERE grupo_id = ? AND whatsapp_id = ?', [grupoId, jid]);
        console.log('[autoSetup] Admin rebaixado:', jid);
      }
    } catch(e) {
      console.error('[autoSetup] Erro ao processar', action, jid, ':', e.message);
    }
  }
}

module.exports = { registrarGrupo, handleGroupsUpsert, handleGroupParticipantsUpdate };
