/**
 * index_meta.js — Entry point do AppFut usando Meta WhatsApp Business API
 *
 * Substitui index.js (WPPConnect) sem mudar a logica de negocios.
 *
 * Variaveis de ambiente (.env):
 *   META_PHONE_NUMBER_ID        — ex: 123456789012345
 *   META_ACCESS_TOKEN           — token permanente do System User
 *   META_WEBHOOK_VERIFY_TOKEN   — segredo definido no Meta Dashboard
 *   DB_HOST, DB_USER, DB_PASS, DB_NAME
 *   PORT                        — porta do servidor (default 3000)
 */

require('dotenv').config();

var express = require('express');
var db    = require('../database/connection');

var { client, sendText: metaSendText } = require('./whatsapp/metaClient');
var { router: webhookRouter, setHandlers } = require('./whatsapp/webhook');

var { processarComandoGrupo } = require('./commands/grupo');
var { processarComandoAdmin }  = require('./commands/admin');
var { confirmar }              = require('./commands/confirmar');
var { cancelar }               = require('./commands/cancelar');
var { lista }                  = require('./commands/lista');
var { enviarMenuJogador, enviarMenuAdmin, enviarCriarPartida } = require('./commands/menu');
var { adicionarAvulso, removerAvulso } = require('./commands/avulso');

// ---------- dedup de mensagens (evita processar duplicatas) ----------
var processadas = new Set();
function dedup(msgId) {
  if (processadas.has(msgId)) return false;
  processadas.add(msgId);
  setTimeout(function() { processadas.delete(msgId); }, 30 * 60 * 1000);
  return true;
}

// ---------- helper: monta fake message para comandos que precisam de message.from ----------
function fakeMensagem(sender, senderName) {
  return {
    id:         'fake_' + Date.now(),
    from:       sender,
    isGroupMsg: false,
    body:       '',
    sender:     { id: sender, pushname: senderName || 'Jogador' }
  };
}

// ---------- registro minimo: salva nome, sem vincular a grupo ----------
async function autoRegistrar(sender, senderName) {
  try {
    await db.execute(
      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)',
      [sender, senderName]
    );
  } catch(e) {
    console.error('[autoRegistrar] Erro:', e);
  }
}

// ---------- verifica vinculo e orienta caso nao esteja cadastrado ----------
var META_NUMERO = process.env.META_BOT_NUMBER || '5511995421741';

async function verificarVinculoOuOrientar(sender, senderName) {
  var [jog] = await db.execute(
    'SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]
  );
  if (jog.length === 0) return false;

  var [vinculo] = await db.execute(
    'SELECT id FROM grupo_jogadores WHERE jogador_id = ? AND ativo = TRUE LIMIT 1',
    [jog[0].id]
  );
  if (vinculo.length > 0) return true; // ja vinculado, pode prosseguir

  // Sem vinculo — busca grupos com partida aberta para mostrar links
  var [grupos] = await db.execute(
    'SELECT g.id, g.nome FROM grupos g ' +
    'JOIN partidas p ON p.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND g.ativo = TRUE ' +
    'ORDER BY g.nome ASC'
  );

  var msg = '\ud83d\udc4b Ol\u00e1, ' + senderName + '!\n\n' +
    'Para usar o bot voc\u00ea precisa se cadastrar no seu grupo.\n' +
    'Clique no link do seu grupo abaixo:\n\n';

  if (grupos.length > 0) {
    for (var i = 0; i < grupos.length; i++) {
      var link = 'https://wa.me/' + META_NUMERO + '?text=entrar%20' + grupos[i].id;
      msg += '\u26bd *' + grupos[i].nome + '*\n' + link + '\n\n';
    }
  } else {
    msg += '_Nenhum grupo com partida aberta no momento._\n\n';
  }

  msg += '_N\u00e3o encontrou seu grupo? Pe\u00e7a o link para o administrador._';

  await metaSendText(sender, msg);
  return false; // bloqueia prosseguimento
}

// ---------- entrar no grupo via link ----------

async function verificarAdminViaWpp(groupWppId, senderCus) {
  return new Promise(function(resolve) {
    var http = require('http');
    var url = 'http://localhost:3001/isAdmin?groupId=' + encodeURIComponent(groupWppId) + '&userId=' + encodeURIComponent(senderCus);
    http.get(url, function(res) {
      var data = '';
      res.on('data', function(d) { data += d; });
      res.on('end', function() {
        try { resolve(JSON.parse(data).isAdmin === true); } catch(e) { resolve(false); }
      });
    }).on('error', function() { resolve(false); });
  });
}

async function entrarGrupo(sender, senderName, grupoId) {
  try {
    var [grupo] = await db.execute(
      'SELECT id, nome, whatsapp_id FROM grupos WHERE id = ? AND ativo = TRUE', [grupoId]
    );
    if (grupo.length === 0) {
      await metaSendText(sender, '⚠️ Link inválido ou grupo não encontrado.');
      return;
    }

    await db.execute(
      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)', [sender, senderName]
    );
    var [jog] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);
    if (jog.length === 0) return;

    await db.execute(
      'INSERT IGNORE INTO grupo_jogadores (grupo_id, jogador_id, ativo) VALUES (?, ?, TRUE)',
      [grupo[0].id, jog[0].id]
    );

    var isAdmin = await verificarAdminViaWpp(grupo[0].whatsapp_id, sender);
    if (!isAdmin) {
      var [adminsCus] = await db.execute(
        'SELECT id FROM admins WHERE grupo_id = ? AND whatsapp_id NOT LIKE "%@lid" LIMIT 1',
        [grupo[0].id]
      );
      if (adminsCus.length === 0) {
        isAdmin = true;
        console.log('[entrarGrupo] Admin por fallback:', sender, 'grupo', grupo[0].id);
      }
    }

    if (isAdmin) {
      await db.execute('DELETE FROM admins WHERE grupo_id = ? AND whatsapp_id LIKE "%@lid"', [grupo[0].id]);
      await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [grupo[0].id, sender]);
      console.log('[entrarGrupo] Admin registrado:', sender, 'grupo', grupo[0].id);
    }

    console.log('[entrarGrupo]', sender, '→ grupo', grupo[0].id, grupo[0].nome, isAdmin ? '(admin)' : '');

    await metaSendText(sender,
      '✅ *Pronto, ' + senderName + '!*\n\n' +
      'Você está cadastrado no grupo *' + grupo[0].nome + '*.\n\n' +
      'Agora é só aguardar a próxima partida e confirmar presença aqui! ⚽'
    );
  } catch(e) {
    console.error('[entrarGrupo] Erro:', e);
  }
}

// ---------- handlers ----------

async function onMessage(message) {
  try {
    if (!message.sender) return;
    if (!dedup(message.id)) return;

    var isGroup    = message.isGroupMsg;
    var text       = (message.body || '').trim().toLowerCase();
    var sender     = message.sender.id;
    var senderName = message.sender.pushname || 'Jogador';

    if (isGroup) {
      await processarComandoGrupo(client, message);
      return;
    }

    // Vinculo direto por link do grupo: "entrar 8"
    if (text.startsWith('entrar ')) {
      var grupoIdEntrar = parseInt(text.split(' ')[1]);
      if (grupoIdEntrar) {
        await entrarGrupo(sender, senderName, grupoIdEntrar);
        return;
      }
    }

    // Registra nome e verifica vinculo ao grupo — bloqueia se nao cadastrado
    await autoRegistrar(sender, senderName);
    var vinculado = await verificarVinculoOuOrientar(sender, senderName);
    if (!vinculado) return;

    // Admin com argumentos → processar comando direto
    if (text.startsWith('admin ')) {
      await processarComandoAdmin(client, message, sender, text);
      return;
    }

    // Admin sozinho → menu admin interativo
    if (text === 'admin') {
      await enviarMenuAdmin(client, sender);
      return;
    }

    // Avulsos
    if (text.startsWith('avulso ')) {
      var nomeAvulso = (message.body || '').trim().slice(7).trim();
      if (nomeAvulso) await adicionarAvulso(client, message, sender, nomeAvulso);
      return;
    }
    if (text.startsWith('remover avulso ')) {
      var nomeRemover = (message.body || '').trim().slice(15).trim();
      if (nomeRemover) await removerAvulso(client, message, sender, nomeRemover);
      return;
    }

    // Comandos de texto (backward compat)
    if (text === 'confirmar') {
      await confirmar(client, message, sender, senderName);
      return;
    }
    if (text === 'cancelar') {
      await cancelar(client, message, sender);
      return;
    }
    if (text === 'lista') {
      await lista(client, message, sender);
      return;
    }

    // Qualquer outra mensagem → menu jogador
    await enviarMenuJogador(client, sender, senderName);

  } catch(e) {
    console.error('[onMessage] Erro:', e);
  }
}

async function onPollResponse(response, sender, opcao) {
  try {
    var chave = sender + (response.id || '') + opcao;
    if (!dedup(chave)) return;

    var selectedId = (response.selectedOptions && response.selectedOptions[0] && response.selectedOptions[0].id) || '';
    var senderName = response.senderName || 'Jogador';
    var msg        = fakeMensagem(sender, senderName);

    if (selectedId === 'confirmar') {
      await confirmar(client, msg, sender, senderName);

    } else if (selectedId === 'cancelar') {
      await cancelar(client, msg, sender);

    } else if (selectedId === 'lista') {
      await lista(client, msg, sender);

    } else if (selectedId === 'admin_status') {
      await processarComandoAdmin(client, msg, sender, 'admin status');

    } else if (selectedId === 'admin_fechar') {
      await processarComandoAdmin(client, msg, sender, 'admin fechar');

    } else if (selectedId === 'admin_participantes') {
      await processarComandoAdmin(client, msg, sender, 'admin participantes');

    } else if (selectedId === 'admin_ativar_todos') {
      await processarComandoAdmin(client, msg, sender, 'admin ativar todos');

    } else if (selectedId === 'admin_desativar_todos') {
      await processarComandoAdmin(client, msg, sender, 'admin desativar todos');

    } else if (selectedId === 'admin_criar_ajuda') {
      await metaSendText(sender,
        '\u2795 *Como criar uma partida*\n\n' +
        'Digite no privado:\n' +
        'admin criar DD/MM [HH:MM] [vagas]\n\n' +
        'Exemplos:\n' +
        '\u2022 admin criar 25/04\n' +
        '\u2022 admin criar 25/04 20:00 14\n\n' +
        'Somente administradores do grupo podem criar partidas.'
      );

    } else {
      // ID desconhecido → volta pro menu
      await enviarMenuJogador(client, sender, senderName);
    }

  } catch(e) {
    console.error('[onPollResponse] Erro:', e);
  }
}

// Meta API nao envia eventos de participantes diretamente
// Usamos registro progressivo: ao receber mensagem de numero desconhecido,
// o bot cadastra o jogador automaticamente (ver onMessage).
async function onParticipantsChanged(event) {
  try {
    console.log('[Participants] Evento:', JSON.stringify(event));
  } catch(e) {
    console.error('[onParticipantsChanged] Erro:', e);
  }
}

// ---------- servidor Express ----------

function start() {
  var app  = express();
  var PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Injeta handlers no webhook
  setHandlers({
    onMessage:             onMessage,
    onPollResponse:        onPollResponse,
    onParticipantsChanged: onParticipantsChanged
  });

  // Rotas do webhook
  app.use('/', webhookRouter);

  // Health check
  app.get('/health', function(req, res) {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // QR Code do WPPConnect — protegido por token
  app.get('/wpp-qr', function(req, res) {
    var token = process.env.QR_SECRET_TOKEN || 'appfut_qr';
    if (req.query.token !== token) {
      return res.status(403).send('Acesso negado');
    }
    var fs = require('fs');
    var qrPath = '/tmp/wpp_qr.png';
    if (!fs.existsSync(qrPath)) {
      return res.status(404).send('QR nao disponivel no momento. Bot pode ja estar conectado.');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(qrPath);
  });

  app.listen(PORT, function() {
    console.log('AppFut Bot (Meta API) rodando na porta ' + PORT);
    console.log('Webhook: http://SEU_DOMINIO/webhook');
    console.log('Phone Number ID:', process.env.META_PHONE_NUMBER_ID || '(nao configurado)');
  });

  console.log('AppFut Meta Bot pronto.');
}

start();
