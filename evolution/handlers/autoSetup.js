require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var db           = require('../database/connection');
var { delay }    = require('../utils/rateLimit');
var createClient = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var metaNumber   = process.env.META_BOT_NUMBER     || '5511995421741';

function nomeDoJid(jid) {
  return (jid || '').replace(/@.*$/, '');
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
      var link      = 'https://wa.me/' + metaNumber + '?text=entrar%20' + grupoId;

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
