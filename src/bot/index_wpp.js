/**
 * index_wpp.js — WPPConnect limitado ao grupo
 *
 * Responsabilidades:
 *   - Auto-setup: quando bot e adicionado ao grupo, registra grupo + membros + admins
 *   - !lista e !ajuda no grupo
 *   - Lembretes no grupo (scheduler)
 *
 * Tudo no privado e tratado pelo index_meta.js (Meta API)
 */

require('dotenv').config();

var wppconnect = require('@wppconnect-team/wppconnect');
var db = require('../database/connection');
var { iniciarScheduler } = require('./scheduler');

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function start() {
  var client = await wppconnect.create({
    session: 'appfut-grupo',
    headless: true,
    useChrome: false,
    puppeteerOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
    }
  });

  console.log('[WPP] Bot grupo iniciado!');

  // Passa o client do WPPConnect para o scheduler (lembretes no grupo)
  iniciarScheduler(client);

  // Escaneia grupos existentes na inicializacao (captura grupos ja registrados antes do bot)
  setTimeout(async function() {
    try {
      var chats = await client.getAllChats();
      var grupos = chats.filter(function(c) { return c.isGroup; });
      console.log('[WPP] Grupos encontrados na inicializacao: ' + grupos.length);
      for (var i = 0; i < grupos.length; i++) {
        var g = grupos[i];
        var gid = g.id && g.id._serialized ? g.id._serialized : (g.chatId || g.id);
        if (gid) {
          var [existente] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [gid]);
          if (existente.length === 0) {
            console.log('[WPP] Registrando grupo nao cadastrado:', g.name || gid);
            await registrarGrupo(client, gid);
          } else {
            console.log('[WPP] Grupo ja cadastrado:', g.name || gid);
          }
        }
      }
    } catch(e) {
      console.error('[WPP] Erro no scan inicial de grupos:', e.message);
    }
  }, 5000); // aguarda 5s para o client estabilizar

  // ============================================================
  // AUTO-SETUP: bot adicionado ao grupo
  // ============================================================
  client.onParticipantsChanged(async function(event) {
    try {
      // Bot foi adicionado a um grupo
      var botId = client.getSessionTokenBrowser ? null : null;
      var info = await client.getHostDevice();
      var botWid = info && (info.wid || info.id);
      var botNum = botWid ? String(botWid).split('@')[0] + '@c.us' : null;

      var action = event.action;
      var groupId = event.groupId || event.chatId;

      // Verifica se o proprio bot foi adicionado
      var isBotAdded = action === 'add' && event.participants &&
        event.participants.some(function(p) {
          var pid = typeof p === 'string' ? p : (p.id || p._serialized || '');
          return botNum && pid.includes(String(botWid).split('@')[0]);
        });

      if (isBotAdded) {
        console.log('[WPP] Bot adicionado ao grupo:', groupId);
        await registrarGrupo(client, groupId);
        return;
      }

      // Novo membro adicionado ao grupo ja registrado
      if (action === 'add' && event.participants) {
        var [grupos] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
        if (grupos.length === 0) return;
        var grupoId = grupos[0].id;
        for (var i = 0; i < event.participants.length; i++) {
          var p = event.participants[i];
          var pid = typeof p === 'string' ? p : (p.id || p._serialized || '');
          if (pid) await registrarMembro(grupoId, pid, null);
        }
      }

      // Membro saiu/foi removido
      if ((action === 'remove' || action === 'leave') && event.participants) {
        var [grupos2] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
        if (grupos2.length === 0) return;
        var grupoId2 = grupos2[0].id;
        for (var j = 0; j < event.participants.length; j++) {
          var p2 = event.participants[j];
          var pid2 = typeof p2 === 'string' ? p2 : (p2.id || p2._serialized || '');
          if (pid2) {
            var [jog] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [pid2]);
            if (jog.length > 0) {
              await db.execute('UPDATE grupo_jogadores SET ativo = FALSE WHERE grupo_id = ? AND jogador_id = ?', [grupoId2, jog[0].id]);
              console.log('[WPP] Membro desativado:', pid2);
            }
          }
        }
      }
    } catch(e) {
      console.error('[WPP] Erro onParticipantsChanged:', e);
    }
  });

  // ============================================================
  // MENSAGENS NO GRUPO
  // ============================================================
  client.onMessage(async function(message) {
    try {
      if (!message.sender) return;
      if (!message.isGroupMsg) return; // ignora privado completamente

      var text = normalizar(message.body);

      if (text === '!lista' || text === '!lista ') {
        await processarListaGrupo(client, message);
        return;
      }

      if (text === '!ajuda') {
        await client.sendText(message.from,
          '\u26bd *AppFut* \u2014 Comandos no grupo:\n\n' +
          '`!lista` \u2014 Ver quem confirmou\n' +
          '`!ajuda` \u2014 Ver este menu\n\n' +
          '\ud83d\udcf2 Para confirmar, cancelar ou ver lista completa, mande mensagem direto para o bot no privado!'
        );
        return;
      }
    } catch(e) {
      console.error('[WPP] Erro onMessage:', e);
    }
  });
}

// ============================================================
// REGISTRAR GRUPO + MEMBROS
// ============================================================

async function registrarGrupo(client, groupId) {
  try {
    // Busca info do grupo
    var chat = await client.getChatById(groupId);
    if (!chat) { console.log('[WPP] Chat nao encontrado:', groupId); return; }

    var nomeGrupo = chat.name
      || chat.formattedTitle
      || (chat.groupMetadata && chat.groupMetadata.subject)
      || chat.subject
      || chat.title
      || 'Grupo ' + groupId;

    // Insere grupo se nao existe
    var [existente] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
    var grupoDbId;

    if (existente.length > 0) {
      grupoDbId = existente[0].id;
      console.log('[WPP] Grupo ja existe no banco:', nomeGrupo);
    } else {
      var [result] = await db.execute(
        'INSERT INTO grupos (whatsapp_id, nome, tipo) VALUES (?, ?, "variavel")',
        [groupId, nomeGrupo]
      );
      grupoDbId = result.insertId;
      console.log('[WPP] Grupo registrado:', nomeGrupo, '(id:', grupoDbId + ')');
    }

    // Busca membros do grupo
    var members = await client.getGroupMembers(groupId);
    if (!members || members.length === 0) {
      console.log('[WPP] Nenhum membro encontrado no grupo');
      return;
    }

    console.log('[WPP] Registrando ' + members.length + ' membros...');

    for (var i = 0; i < members.length; i++) {
      var member = members[i];
      // id pode ser objeto {server, user, _serialized} ou string
      var midObj = member.id || member;
      var midStr = typeof midObj === 'object'
        ? (midObj._serialized || (midObj.user + '@' + midObj.server))
        : String(midObj);

      var nome = member.pushname || member.name || member.notify || null;
      var isAdmin = member.isAdmin || member.isSuperAdmin || false;

      await registrarMembro(grupoDbId, midStr, nome);

      // Registra admin
      if (isAdmin) {
        await db.execute(
          'INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)',
          [grupoDbId, midStr]
        );
        console.log('[WPP] Admin registrado:', midStr);
      }
    }

    console.log('[WPP] Auto-setup concluido para:', nomeGrupo);
  } catch(e) {
    console.error('[WPP] Erro ao registrar grupo:', e);
  }
}

async function registrarMembro(grupoId, wid, nome) {
  try {
    // wid pode ser objeto {server, user, _serialized} ou string
    var widStr = typeof wid === 'object'
      ? (wid._serialized || (wid.user + '@' + wid.server))
      : String(wid);

    if (!widStr || widStr === 'false' || widStr === 'undefined') return;

    var wid = widStr; // usa sempre a string daqui pra frente

    var nomeUsar = nome || 'Jogador';

    // Insere jogador
    await db.execute(
      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)',
      [wid, nomeUsar]
    );

    // Atualiza nome se veio com nome real
    if (nome) {
      await db.execute(
        'UPDATE jogadores SET nome = ? WHERE whatsapp_id = ? AND nome = "Jogador"',
        [nome, wid]
      );
    }

    // Vincula ao grupo
    var [jogRow] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [wid]);
    if (jogRow.length > 0) {
      await db.execute(
        'INSERT IGNORE INTO grupo_jogadores (grupo_id, jogador_id, ativo) VALUES (?, ?, TRUE)',
        [grupoId, jogRow[0].id]
      );
    }
  } catch(e) {
    console.error('[WPP] Erro ao registrar membro:', wid, e.message);
  }
}

// ============================================================
// !LISTA NO GRUPO
// ============================================================

async function processarListaGrupo(client, message) {
  try {
    var grupoWppId = message.from;

    var [grupos] = await db.execute(
      'SELECT id, nome FROM grupos WHERE whatsapp_id = ?', [grupoWppId]
    );
    if (grupos.length === 0) {
      await client.sendText(message.from, '\u26a0\ufe0f Grupo nao cadastrado.');
      return;
    }
    var grupo = grupos[0];

    var [partidas] = await db.execute(
      'SELECT id, data_partida, horario_inicio, horario_fim, max_jogadores FROM partidas WHERE grupo_id = ? AND status = "aberta" ORDER BY data_partida ASC LIMIT 1',
      [grupo.id]
    );
    if (partidas.length === 0) {
      await client.sendText(message.from, '\u26a0\ufe0f Nenhuma partida aberta no momento.');
      return;
    }
    var partida = partidas[0];

    var [confirmados] = await db.execute(
      'SELECT j.nome FROM presencas p JOIN jogadores j ON p.jogador_id = j.id WHERE p.partida_id = ? AND p.status = "confirmado" ORDER BY j.nome',
      [partida.id]
    );
    var [avulsos] = await db.execute(
      'SELECT nome FROM avulsos WHERE partida_id = ? ORDER BY nome',
      [partida.id]
    );

    var data = new Date(partida.data_partida);
    var dataStr = String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0');
    var horario = partida.horario_inicio ? String(partida.horario_inicio).replace(/:(\d{2})$/, '') : '';

    var total = confirmados.length + avulsos.length;
    var max = partida.max_jogadores || 20;

    var linhas = ['\u26bd *' + grupo.nome + '* \u2014 ' + dataStr + (horario ? ' \u00e0s ' + horario : '')];
    linhas.push('Confirmados: *' + total + '/' + max + '*\n');

    if (confirmados.length > 0) {
      linhas.push('*Jogadores:*');
      confirmados.forEach(function(j, i) { linhas.push((i + 1) + '. ' + j.nome); });
    }
    if (avulsos.length > 0) {
      linhas.push('\n*Avulsos:*');
      avulsos.forEach(function(a, i) { linhas.push((i + 1) + '. ' + a.nome); });
    }

    linhas.push('\n\ud83d\udcf2 Para confirmar, mande mensagem para o bot no privado!');

    await client.sendText(message.from, linhas.join('\n'));
  } catch(e) {
    console.error('[WPP] Erro lista grupo:', e);
  }
}

start().catch(console.error);
