/**
 * webhook_server.js - Servidor Express minimo que recebe eventos do Evolution API.
 *
 * Objetivo da Fase 2: apenas LOGAR eventos crus. Nao responde mensagem nenhuma,
 * nao toca em banco, nao chama nada do bot de producao. Serve pra descobrir o
 * shape exato dos payloads antes de escrever logica.
 *
 * Evolution API POSTa em 2 formatos:
 *   a) webhook_by_events=false: POST /evolution    body = { event, instance, data, ... }
 *   b) webhook_by_events=true : POST /evolution/messages-upsert  body = { event, instance, data, ... }
 *
 * Cobrimos os dois pegando qualquer sub-rota abaixo de /evolution.
 *
 * Uso no servidor:
 *   cd ~/appfut/evolution
 *   npm install
 *   node webhook_server.js
 *   # ou: pm2 start webhook_server.js --name evolution-webhook
 */

require('dotenv').config({ path: '.env.evolution' });

var fs = require('fs');
var path = require('path');
var express = require('express');
var autoSetup = require('./handlers/autoSetup');
var commands  = require('./handlers/commands');
var { iniciarScheduler } = require('./scheduler');

var PORT       = Number(process.env.WEBHOOK_PORT || 3002);
var DUMP_FILE  = process.env.WEBHOOK_DUMP_FILE || ''; // vazio = nao grava
var MAX_BODY   = process.env.WEBHOOK_BODY_LIMIT || '5mb';

// Contador simples para ver volume em memoria
var stats = { total: 0, porEvento: {}, porInstancia: {}, inicio: Date.now() };

function ts() {
  return new Date().toISOString();
}

function resumoBody(event, body) {
  // Reduz o payload para algo legivel no console. Mantem campos chave por evento.
  try {
    if (!body || typeof body !== 'object') return body;
    var data = body.data || {};
    switch (event) {
      case 'messages.upsert':
      case 'MESSAGES_UPSERT': {
        var key = data.key || {};
        var msg = data.message || {};
        var tipo = Object.keys(msg)[0] || 'desconhecido';
        var texto = msg.conversation
          || (msg.extendedTextMessage && msg.extendedTextMessage.text)
          || (msg.pollCreationMessageV3 && msg.pollCreationMessageV3.name)
          || '';
        return {
          from: key.remoteJid,
          fromMe: !!key.fromMe,
          participant: key.participant,
          tipo: tipo,
          texto: texto ? texto.slice(0, 120) : undefined,
          pushName: data.pushName
        };
      }
      case 'connection.update':
      case 'CONNECTION_UPDATE':
        return { state: data.state, statusReason: data.statusReason };
      case 'qrcode.updated':
      case 'QRCODE_UPDATED':
        return { temQr: !!(data.qrcode && (data.qrcode.base64 || data.qrcode.code)) };
      case 'group-participants.update':
      case 'GROUP_PARTICIPANTS_UPDATE':
        return { id: data.id, action: data.action, participants: data.participants };
      case 'groups.upsert':
      case 'GROUPS_UPSERT':
        return { groups: Array.isArray(data) ? data.map(function(g) { return { id: g.id, subject: g.subject }; }) : data };
      default:
        return data;
    }
  } catch(e) {
    return { _resumoErro: e.message };
  }
}

function appendDump(obj) {
  if (!DUMP_FILE) return;
  try {
    fs.appendFileSync(DUMP_FILE, JSON.stringify(obj) + '\n');
  } catch(e) {
    console.error('[webhook] falha ao gravar dump:', e.message);
  }
}

var app = express();
app.use(express.json({ limit: MAX_BODY }));

// Healthcheck pro proprio webhook
app.get('/health', function(req, res) {
  var upSec  = Math.floor((Date.now() - stats.inicio) / 1000);
  var upMin  = Math.floor(upSec / 60);
  var upHora = Math.floor(upMin / 60);
  var upDia  = Math.floor(upHora / 24);

  var upFormatado =
    (upDia  > 0 ? upDia  + 'd ' : '') +
    (upHora % 24 > 0 ? (upHora % 24) + 'h ' : '') +
    (upMin  % 60 > 0 ? (upMin  % 60) + 'min ' : '') +
    (upSec  % 60) + 's';

  var marcos = {
    '6h':  upSec >= 6  * 3600,
    '12h': upSec >= 12 * 3600,
    '24h': upSec >= 24 * 3600
  };

  var estabilidade = marcos['24h'] ? '✅ 24h+' :
                     marcos['12h'] ? '🟡 12h+' :
                     marcos['6h']  ? '🟠 6h+'  : '🔴 < 6h';

  res.json({
    ok:           true,
    iniciadoEm:   new Date(stats.inicio).toISOString(),
    uptime:       upFormatado,
    uptimeSec:    upSec,
    estabilidade: estabilidade,
    marcos:       marcos,
    eventos:      stats.total,
    porEvento:    stats.porEvento,
    porInstancia: stats.porInstancia
  });
});

// Handler generico. Evolution pode mandar em:
//   POST /evolution                  (webhook_by_events=false)
//   POST /evolution/<event-kebab>    (webhook_by_events=true)
function handle(req, res) {
  var body = req.body || {};
  var event = body.event || req.params[0] || 'desconhecido';
  var instance = body.instance || '?';

  stats.total++;
  stats.porEvento[event] = (stats.porEvento[event] || 0) + 1;
  stats.porInstancia[instance] = (stats.porInstancia[instance] || 0) + 1;

  var resumo = resumoBody(event, body);
  console.log('[' + ts() + '] <- ' + event + ' (' + instance + ')');
  try { console.log('    ' + JSON.stringify(resumo)); } catch(e) { console.log('    <nao serializavel>'); }

  appendDump({
    receivedAt: ts(),
    event: event,
    instance: instance,
    sourceUrl: req.originalUrl,
    body: body
  });

  // Rotear para handlers de negocio (nao bloqueia resposta)
  if (event === 'GROUPS_UPSERT' || event === 'groups.upsert') {
    autoSetup.handleGroupsUpsert(body.data).catch(function(e) {
      console.error('[webhook] GROUPS_UPSERT handler erro:', e.message);
    });
  } else if (event === 'GROUP_PARTICIPANTS_UPDATE' || event === 'group-participants.update') {
    autoSetup.handleGroupParticipantsUpdate(body.data).catch(function(e) {
      console.error('[webhook] GROUP_PARTICIPANTS_UPDATE handler erro:', e.message);
    });
  } else if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
    var data = body.data || {};
    var key  = data.key || {};
    var remoteJid = key.remoteJid || '';
    var fromMe    = !!key.fromMe;
    var isGroup   = remoteJid.endsWith('@g.us');
    var msg       = data.message || {};
    var text      = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || '';

    if (isGroup && !fromMe && text) {
      var participant = key.participant || '';
      var pushName    = data.pushName || '';
      commands.processarComandoGrupo(remoteJid, text, participant, pushName).catch(function(e) {
        console.error('[webhook] commands handler erro:', e.message);
      });
    } else if (!isGroup && !fromMe) {
      var pushName = data.pushName || '';
      commands.processarMensagemPrivada(remoteJid, text, pushName).catch(function(e) {
        console.error('[webhook] privado handler erro:', e.message);
      });
    }
  }

  // Responde rapido. Evolution re-tenta se demorar.
  res.status(200).json({ received: true });
}

app.post('/evolution', handle);
app.post('/evolution/*', handle);

// Qualquer outra rota -> 404 verboso pra ajudar a debugar config
app.use(function(req, res) {
  console.log('[' + ts() + '] 404 ' + req.method + ' ' + req.originalUrl);
  res.status(404).json({ error: 'rota nao reconhecida', hint: 'use POST /evolution' });
});

app.listen(PORT, '0.0.0.0', function() {
  console.log('=== AppFut Evolution Webhook ===');
  console.log('Ouvindo em http://0.0.0.0:' + PORT);
  console.log('Rota principal: POST /evolution');
  console.log('Healthcheck   : GET  /health');
  console.log('Dump JSONL    : ' + (DUMP_FILE || '(desligado)'));
  console.log('Eventos aguardando...');
  iniciarScheduler();
});

process.on('SIGINT', function() {
  console.log('\n[webhook] encerrando. Total recebido:', stats.total);
  process.exit(0);
});
