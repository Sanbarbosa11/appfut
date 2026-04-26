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

['log', 'error', 'warn'].forEach(function(method) {
  var orig = console[method].bind(console);
  console[method] = function() {
    var ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[' + ts + ']');
    orig.apply(console, args);
  };
});

var wppconnect = require('@wppconnect-team/wppconnect');
var db = require('../database/connection');
var { iniciarScheduler } = require('./scheduler');
var { sendText: metaSendText } = require('./whatsapp/metaClient');
var { montarListaCompleta } = require('./utils/listaHelper');

var META_NUMERO  = process.env.META_BOT_NUMBER  || '5511995421741';
var ADMIN_NUMERO = process.env.ADMIN_WHATSAPP   || '';

async function alertarAdmin(msg) {
  if (!ADMIN_NUMERO) return;
  try {
    await metaSendText(ADMIN_NUMERO, '\u26a0\ufe0f *AppFut \u2014 Alerta WPP*\n\n' + msg);
    console.log('[WPP] Alerta enviado para admin');
  } catch(e) {
    console.error('[WPP] Falha ao enviar alerta para admin:', e.message);
  }
}

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Extrai apenas os digitos do WID.
// Aceita: string "5511...@c.us" | objeto Wid {_serialized, user, server} | toString custom
function extrairNumero(wid) {
  if (wid === null || wid === undefined) return null;
  var s = '';
  if (typeof wid === 'string') {
    s = wid;
  } else if (typeof wid === 'object') {
    s = wid._serialized
      || (wid.user && wid.server ? wid.user + '@' + wid.server : '')
      || wid.user
      || '';
    // Fallback: toString retorna algo com @ (formato WID)
    if (!s && typeof wid.toString === 'function') {
      var ts = wid.toString();
      if (ts && ts !== '[object Object]' && ts.indexOf('@') !== -1) s = ts;
    }
  } else {
    s = String(wid);
  }
  var digits = String(s).replace(/@.*$/, '').replace(/\D/g, '');
  return digits || null;
}

async function start() {
  var client = await wppconnect.create({
    session: 'appfut-grupo',
    headless: true,
    useChrome: false,
    autoClose: 0,
    whatsappVersion: '2.3000.1023569519',
    puppeteerOptions: {
      protocolTimeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-gpu',
        '--no-first-run'
      ]
    },
    catchQR: function(base64Qr, asciiQR) {
      console.log('[WPP] QR Code gerado — escaneie com o WhatsApp:');
      console.log(asciiQR);
      alertarAdmin(
        'QR Code gerado \u2014 sess\u00e3o precisa ser reautenticada.\n\n' +
        '\ud83d'  + '\udcbb *Para reconectar, acesse o servidor:*\n' +
        '`ssh appfutadmin@31.97.94.250`\n\n' +
        'Depois rode:\n' +
        '`pm2 logs appfut-grupo --lines 60 --nostream`\n\n' +
        'O QR aparece no terminal. Escaneie com o celular do bot:\n' +
        'WhatsApp \u2192 Configura\u00e7\u00f5es \u2192 Dispositivos conectados \u2192 Conectar dispositivo'
      );
    }
  });

  console.log('[WPP] Bot grupo iniciado!');

  // Cache das identidades do bot: @c.us (numero real) e @lid (novo formato privacidade)
  // Eventos onParticipantsChanged vem como @lid; getHostDevice em algumas versoes nao expoe.
  // Estrategias em ordem: hostDevice.wid -> WPP.conn via page.evaluate -> env BOT_WHATSAPP_NUMBER.
  var botNumCus = null;
  var botNumLid = null;
  (async function identificarBot() {
    // 1. getHostDevice (algumas versoes retornam info.wid/info.me)
    try {
      var info = await client.getHostDevice();
      try { console.log('[WPP] hostDevice dump:', JSON.stringify(info)); } catch(e) {}
      var cand = info && (info.wid || info.me
        || (info.id && typeof info.id === 'object' ? info.id : null));
      if (cand) botNumCus = extrairNumero(cand);
    } catch(e) {
      console.error('[WPP] Erro getHostDevice:', e.message || e);
    }

    // 2. page.evaluate no WPP.conn (wa-js interno) - cobre versoes onde hostDevice e minimo
    try {
      if (client.page && typeof client.page.evaluate === 'function') {
        var pd = await client.page.evaluate(function() {
          var out = {};
          try {
            if (typeof WPP !== 'undefined' && WPP.conn) {
              var meObj = WPP.conn.me || null;
              if (meObj) out.me = meObj._serialized || (meObj.user && meObj.server ? meObj.user + '@' + meObj.server : '');
              if (typeof WPP.conn.getMaybeMeLidUser === 'function') {
                var lidObj = WPP.conn.getMaybeMeLidUser();
                if (lidObj) out.meLid = lidObj._serialized || (lidObj.user && lidObj.server ? lidObj.user + '@' + lidObj.server : '');
              }
              if (typeof WPP.conn.getMyUserId === 'function') {
                var muid = WPP.conn.getMyUserId();
                if (muid) out.myUserId = muid._serialized || (muid.user && muid.server ? muid.user + '@' + muid.server : '');
              }
            }
          } catch(e) { out.error = String((e && e.message) || e); }
          return out;
        });
        try { console.log('[WPP] WPP.conn dump:', JSON.stringify(pd)); } catch(e) {}
        if (pd) {
          if (!botNumCus) botNumCus = extrairNumero(pd.me || pd.myUserId);
          if (!botNumLid) botNumLid = extrairNumero(pd.meLid);
        }
      }
    } catch(e) {
      console.error('[WPP] Falha page.evaluate WPP.conn:', e.message || e);
    }

    // 3. env BOT_WHATSAPP_NUMBER como fallback (ex: 5511999999999)
    if (!botNumCus && process.env.BOT_WHATSAPP_NUMBER) {
      botNumCus = String(process.env.BOT_WHATSAPP_NUMBER).replace(/\D/g, '') || null;
      console.log('[WPP] Usando BOT_WHATSAPP_NUMBER do env:', botNumCus);
    }

    // 4. Se temos @c.us mas nao @lid, resolver via getContact
    if (botNumCus && !botNumLid) {
      try {
        var cctx = await client.getContact(botNumCus + '@c.us');
        try { console.log('[WPP] getContact(bot@c.us) dump:', JSON.stringify(cctx)); } catch(e) {}
        if (cctx) {
          if (cctx.lid) botNumLid = extrairNumero(cctx.lid);
          if (!botNumLid && cctx.id) {
            var idRaw = cctx.id._serialized || String(cctx.id);
            if (idRaw.indexOf('@lid') !== -1) botNumLid = extrairNumero(idRaw);
          }
        }
      } catch(e) {
        console.error('[WPP] Falha getContact(bot@c.us):', e.message || e);
      }
    }

    console.log('[WPP] Bot identidade FINAL - @c.us num:', botNumCus, ' @lid num:', botNumLid);
    if (!botNumCus && !botNumLid) {
      console.error('[WPP] ATENCAO: nao foi possivel identificar o bot. Deteccao de entrada/saida vai falhar.');
      console.error('[WPP] Adicione BOT_WHATSAPP_NUMBER=5511XXXXXXXX no .env e reinicie.');
    }
  })();

  // Endpoint interno: Meta bot consulta para verificar se numero e admin do grupo
  var httpServer = require('http');
  httpServer.createServer(async function(req, res) {
    try {
      var url = new URL(req.url, 'http://localhost:3001');
      if (url.pathname === '/isAdmin') {
        var groupId = url.searchParams.get('groupId');
        var userId  = url.searchParams.get('userId'); // formato @c.us
        var members = await client.getGroupMembers(groupId);
        var isAdmin = false;

        // Tenta obter o @lid do sender via getContact(@c.us)
        var senderLid = null;
        try {
          var senderContact = await client.getContact(userId);
          if (senderContact) {
            // Pode estar em lid, id.lid, ou no proprio id se for @lid
            senderLid = (senderContact.lid && (senderContact.lid._serialized || String(senderContact.lid)))
              || (senderContact.id && senderContact.id._serialized && senderContact.id._serialized.endsWith('@lid') ? senderContact.id._serialized : null);
          }
        } catch(e) {}

        for (var i = 0; i < members.length; i++) {
          var m = members[i];
          if (!m.isAdmin && !m.isSuperAdmin) continue;
          var mId = m.id && m.id._serialized ? m.id._serialized : String(m.id);

          // Match direto por @c.us
          if (mId === userId) { isAdmin = true; break; }
          // Match por @lid resolvido do sender
          if (senderLid && mId === senderLid) { isAdmin = true; break; }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ isAdmin: isAdmin }));
      } else {
        res.writeHead(404); res.end();
      }
    } catch(e) {
      res.writeHead(500); res.end(JSON.stringify({ isAdmin: false }));
    }
  }).listen(3001, function() {
    console.log('[WPP] Endpoint interno rodando na porta 3001');
  });

  // Aguarda Meta API subir e envia alerta apenas quando ambos estao online
  (async function verificarAmbosOnline() {
    var http = require('http');
    var tentativas = 0;
    var maxTentativas = 10; // ~50s
    var intervalo = setInterval(async function() {
      tentativas++;
      try {
        await new Promise(function(resolve, reject) {
          http.get('http://localhost:' + (process.env.PORT || 3000) + '/health', function(res) {
            res.statusCode === 200 ? resolve() : reject();
          }).on('error', reject);
        });
        clearInterval(intervalo);
        alertarAdmin('\u2705 *AppFut 100% online*\n\nBot do grupo + Meta API conectados e prontos.\nSe foi reinicio inesperado, verifique: `pm2 logs`');
      } catch(e) {
        if (tentativas >= maxTentativas) {
          clearInterval(intervalo);
          alertarAdmin('\u26a0\ufe0f *Bot do grupo online, mas Meta API nao respondeu.*\n\nVerifique: `pm2 status` e `pm2 logs appfut-meta`');
        }
      }
    }, 5000);
  })();

  // Keepalive com watchdog — alerta admin se conexao cair + exit em falha persistente
  var keepaliveFalhas = 0;
  setInterval(async function() {
    try {
      await client.getHostDevice();
      await client.isConnected(); // ativa o socket para evitar Auto Close
      keepaliveFalhas = 0; // reset ao ter sucesso
    } catch(e) {
      keepaliveFalhas++;
      // Log apenas 1a/2a/3a falha e depois a cada 10x - evita spam em zumbi
      if (keepaliveFalhas <= 3 || keepaliveFalhas % 10 === 0) {
        console.error('[WPP] Keepalive falhou (' + keepaliveFalhas + 'x):', e.message || e);
      }
      if (keepaliveFalhas === 3) {
        alertarAdmin(
          '\u26a0\ufe0f *Bot do grupo perdeu conex\u00e3o!*\n\n' +
          'getHostDevice falhou 3 vezes seguidas (~6 min).\n\n' +
          'PM2 vai tentar reiniciar. Se n\u00e3o resolver:\n' +
          '`pm2 restart appfut-grupo`\n\n' +
          'Logs: `pm2 logs appfut-grupo --lines 30 --nostream`'
        );
      }
      // Depois de 5 falhas seguidas (~10 min) mata o processo para PM2 reiniciar
      // com Chromium novo - recupera de "detached Frame" e similares
      if (keepaliveFalhas >= 5) {
        console.error('[WPP] 5 falhas seguidas - encerrando processo para PM2 reiniciar.');
        process.exit(1);
      }
    }
  }, 2 * 60 * 1000);

  // Monitoramento de estado — alerta admin se sessao cair
  client.onStateChange(function(state) {
    console.log('[WPP] Estado da sessao:', state);
    var estadosProblema = ['CONFLICT', 'UNPAIRED', 'UNLAUNCHED', 'TIMEOUT', 'UNPAIRED_IDLE'];
    if (estadosProblema.indexOf(state) !== -1) {
      alertarAdmin(
        'Sess\u00e3o encerrada! Estado: *' + state + '*\n\n' +
        'O bot do grupo est\u00e1 offline. PM2 vai reiniciar automaticamente.\n\n' +
        'Se precisar de QR, acesse o servidor:\n' +
        '`ssh appfutadmin@31.97.94.250`\n' +
        '`pm2 logs appfut-grupo --lines 60 --nostream`'
      );
    }
  });

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
      var action = event.action;
      var groupId = event.groupId || event.chatId || event.chat;
      var participantId = event.who || event.participant;

      if (!groupId || !participantId) return;

      var partNum = extrairNumero(participantId);
      var isBot = !!(partNum && (
        (botNumCus && partNum === botNumCus) ||
        (botNumLid && partNum === botNumLid)
      ));

      console.log('[WPP] onParticipantsChanged action=' + action + ' who=' + participantId +
                  ' grupo=' + groupId + ' partNum=' + partNum +
                  ' botCus=' + botNumCus + ' botLid=' + botNumLid + ' isBot=' + isBot);

      // BOT ADICIONADO ao grupo
      if (action === 'add' && isBot) {
        console.log('[WPP] Bot adicionado ao grupo:', groupId);
        await registrarGrupo(client, groupId);
        return;
      }

      // BOT REMOVIDO do grupo → soft delete + alerta
      if ((action === 'remove' || action === 'leave') && isBot) {
        console.log('[WPP] Bot removido do grupo:', groupId);
        await limparGrupo(groupId);
        return;
      }

      // Membro normal adicionado
      if (action === 'add') {
        var [grupos] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
        if (grupos.length === 0) return;
        await registrarMembro(grupos[0].id, participantId, null);
        return;
      }

      // Membro normal removido/saiu → apenas desativa no banco (silencioso, sem alerta)
      if (action === 'remove' || action === 'leave') {
        var [grupos2] = await db.execute('SELECT id FROM grupos WHERE whatsapp_id = ?', [groupId]);
        if (grupos2.length === 0) return;
        var [jog] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [participantId]);
        if (jog.length > 0) {
          await db.execute('UPDATE grupo_jogadores SET ativo = FALSE WHERE grupo_id = ? AND jogador_id = ?', [grupos2[0].id, jog[0].id]);
          console.log('[WPP] Membro desativado no grupo (silencioso):', participantId);
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
      console.log('[WPP] onMessage fromMe=' + (message.fromMe || false) +
                  ' isGroup=' + (message.isGroupMsg || false) +
                  ' body=' + JSON.stringify((message.body || '').slice(0, 60)));
      // Mensagem privada — redireciona para Meta
      if (!message.isGroupMsg) {
        var sender = message.sender.id;
        await client.sendText(sender,
          '\u26bd *AppFut*\n\nOl\u00e1! Para confirmar presen\u00e7a, cancelar ou ver sua lista, fale com o bot no privado:\n\n' +
          '\ud83d\udcf1 wa.me/' + META_NUMERO + '\n\nDigite *ajuda* l\u00e1 para ver os comandos.'
        );
        return;
      }

      var text = normalizar(message.body);
      console.log('[WPP] texto normalizado=' + JSON.stringify(text));

      if (text === '!lista' || text === '!lista ') {
        await processarListaGrupo(client, message);
        return;
      }

      if (text === '!ajuda') {
        try {
          await client.sendText(message.from,
            '\u26bd *AppFut* \u2014 Comandos no grupo:\n\n' +
            '`!lista` \u2014 Ver quem confirmou\n' +
            '`!ajuda` \u2014 Ver este menu\n\n' +
            '\ud83d\udcf2 Para confirmar, cancelar ou ver lista completa, mande mensagem direto para o bot no privado!'
          );
        } catch(eSend) {
          console.error('[WPP] Falha ao enviar !ajuda no grupo:', eSend.message || eSend);
          alertarAdmin('\u26a0\ufe0f *Bot falhou ao enviar no grupo!*\n\nComando: !ajuda\nGrupo: ' + message.from + '\nErro: ' + (eSend.message || eSend));
        }
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

async function limparGrupo(groupId) {
  try {
    var [grupos] = await db.execute('SELECT id, nome FROM grupos WHERE whatsapp_id = ?', [groupId]);
    if (grupos.length === 0) {
      console.log('[WPP] limparGrupo: grupo nao encontrado no banco:', groupId);
      return;
    }
    var grupoDbId = grupos[0].id;
    var grupoNome = grupos[0].nome;

    // Fecha partidas abertas
    await db.execute('UPDATE partidas SET status = "fechada" WHERE grupo_id = ? AND status = "aberta"', [grupoDbId]);

    // Desativa todos os vinculos de jogadores
    await db.execute('UPDATE grupo_jogadores SET ativo = FALSE WHERE grupo_id = ?', [grupoDbId]);

    // Desativa o grupo
    await db.execute('UPDATE grupos SET ativo = FALSE WHERE id = ?', [grupoDbId]);

    console.log('[WPP] Grupo desativado (soft delete):', grupoNome, '(id:', grupoDbId + ')');

    alertarAdmin(
      '\ud83d\udd34 *Bot removido do grupo*\n\n' +
      'Grupo: *' + grupoNome + '*\n' +
      'Partidas fechadas e jogadores desvinculados.\n\n' +
      '_Dados preservados no banco. Para reativar, adicione o bot novamente._'
    );
  } catch(e) {
    console.error('[WPP] Erro ao limpar grupo:', e);
  }
}

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
    var [existente] = await db.execute('SELECT id, ativo FROM grupos WHERE whatsapp_id = ?', [groupId]);
    var grupoDbId;

    if (existente.length > 0) {
      grupoDbId = existente[0].id;
      if (!existente[0].ativo) {
        console.log('[WPP] Grupo pausado, ignorando:', nomeGrupo);
        return;
      }
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
      var midObj = member.id || member;
      var midStr = typeof midObj === 'object'
        ? (midObj._serialized || (midObj.user + '@' + midObj.server))
        : String(midObj);

      var nome = member.pushname || member.name || member.notify || null;
      var isAdmin = member.isAdmin || member.isSuperAdmin || false;

      if (midStr.endsWith('@lid')) {
        if (isAdmin) {
          // Tenta resolver @lid para @c.us
          var resolvido = await resolverLid(client, midStr);
          if (resolvido) {
            await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [grupoDbId, resolvido]);
            console.log('[WPP] Admin @lid resolvido:', midStr, '->', resolvido);
          } else {
            // Guarda @lid pendente — sera substituido quando admin clicar entrar
            await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [grupoDbId, midStr]);
            console.log('[WPP] Admin @lid pendente:', midStr);
          }
        }
        continue; // jogadores @lid ignorados ate interagirem via Meta
      }

      await registrarMembro(grupoDbId, midStr, nome);

      if (isAdmin) {
        await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [grupoDbId, midStr]);
        console.log('[WPP] Admin registrado:', midStr);
      }
    }

    console.log('[WPP] Auto-setup concluido para:', nomeGrupo);

    // Boas-vindas apenas para grupos novos (primeiro registro)
    if (existente.length > 0) return;

    // Aguarda estabilizar antes de enviar (WhatsApp rejeita msg imediata apos join)
    await new Promise(function(r) { setTimeout(r, 25000); });
    console.log('[WPP] Enviando boas-vindas para:', nomeGrupo);

    var linkEntrar = 'https://wa.me/' + META_NUMERO + '?text=entrar%20' + grupoDbId;
    var boasVindas =
      '\u26bd *AppFut chegou!*\n\n' +
      'Ol\u00e1, ' + nomeGrupo + '! \n' +
      'Sou o bot de gest\u00e3o do rach\u00e3o.\n\n' +
      '\ud83d\udcf2 *Para voc\u00ea Confirmar/Cancelar a presen\u00e7a, Clique no WhatsApp:* ' + linkEntrar + '\n\n' +
      '\ud83d\udccb *Comandos aqui no grupo:*\n' +
      '!lista \u2014 ver lista de confirmados\n' +
      '!ajuda \u2014 ver ajuda\n\n' +
      '_Cada membro deve clicar no link uma \u00fanica vez para se cadastrar._';

    try {
      var sendPromise = client.sendText(groupId, boasVindas);
      var timeoutPromise = new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timeout')); }, 20000); });
      await Promise.race([sendPromise, timeoutPromise]);
      console.log('[WPP] Boas-vindas enviada OK para:', nomeGrupo);
    } catch(eSend) {
      console.error('[WPP] Falha ao enviar boas-vindas:', eSend.message || eSend);
    }
  } catch(e) {
    console.error('[WPP] Erro ao registrar grupo:', e);
  }
}

async function resolverLid(client, lid) {
  try {
    var contact = await client.getContact(lid);
    if (contact && contact.id && contact.id._serialized && contact.id._serialized.endsWith('@c.us')) {
      return contact.id._serialized;
    }
    // Tenta via pushname/wid direto
    if (contact && contact.wid && String(contact.wid).endsWith('@c.us')) {
      return String(contact.wid);
    }
  } catch(e) {}
  return null; // privacidade ativa ou nao resolvivel
}

async function registrarMembro(grupoId, wid, nome) {
  try {
    // wid pode ser objeto {server, user, _serialized} ou string
    var widStr = typeof wid === 'object'
      ? (wid._serialized || (wid.user + '@' + wid.server))
      : String(wid);

    if (!widStr || widStr === 'false' || widStr === 'undefined') return;

    // @lid e o novo formato de ID do WhatsApp — nao tem numero de telefone
    // Membros serao registrados pelo Meta bot quando interagirem no privado
    if (widStr.endsWith('@lid')) return;

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

    var [partidas] = await db.execute(
      'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
      'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +
      'WHERE g.whatsapp_id = ? AND p.status = "aberta" ' +
      'ORDER BY p.data_partida ASC LIMIT 1',
      [grupoWppId]
    );
    if (partidas.length === 0) {
      await client.sendText(message.from, '\u26a0\ufe0f Nenhuma partida aberta no momento.');
      return;
    }
    var p = partidas[0];

    var texto = await montarListaCompleta(
      p.id, p.grupo_id, p.grupo_nome, p.data_partida,
      p.max_jogadores, p.horario_inicio, p.horario_fim, true
    );
    try {
      await client.sendText(message.from, texto);
    } catch(eSend) {
      console.error('[WPP] Falha ao enviar !lista no grupo:', eSend.message || eSend);
      alertarAdmin('\u26a0\ufe0f *Bot falhou ao enviar no grupo!*\n\nComando: !lista\nGrupo: ' + message.from + '\nErro: ' + (eSend.message || eSend));
    }
  } catch(e) {
    console.error('[WPP] Erro lista grupo:', e);
    alertarAdmin('\u26a0\ufe0f *Erro interno no !lista do grupo*\n\nGrupo: ' + (message && message.from) + '\nErro: ' + (e.message || e));
  }
}

start().catch(console.error);
