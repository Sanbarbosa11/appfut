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
var db      = require('../database/connection');

var { client }     = require('./whatsapp/metaClient');
var { router: webhookRouter, setHandlers } = require('./whatsapp/webhook');

var { processarComandoGrupo } = require('./commands/grupo');
var { processarComandoAdmin }  = require('./commands/admin');
var { ajudaPrivado }           = require('./commands/ajuda');
var { confirmar }              = require('./commands/confirmar');
var { cancelar }               = require('./commands/cancelar');
var { lista }                  = require('./commands/lista');

var { iniciarScheduler } = require('./scheduler');

// ---------- dedup de mensagens (evita processar duplicatas) ----------
var processadas = new Set();
function dedup(msgId) {
  if (processadas.has(msgId)) return false;
  processadas.add(msgId);
  // Limpa apos 30 minutos para nao vazar memoria
  setTimeout(function() { processadas.delete(msgId); }, 30 * 60 * 1000);
  return true;
}

// ---------- sessoes admin (state machine adminPoll) ----------
var sessoes = {};
function getSession(sender)         { return sessoes[sender] || null; }
function setSession(sender, data)   { sessoes[sender] = data; }
function clearSession(sender)       { delete sessoes[sender]; }

// Exporta para uso em adminPoll.js (que importa do index via require)
// Compatibilidade: adminPoll espera essas funcoes no modulo pai
global._appfutSession = { getSession, setSession, clearSession };

// ---------- handlers ----------

async function onMessage(message) {
  try {
    if (!message.sender) return;
    if (!dedup(message.id)) return;

    var isGroup  = message.isGroupMsg;
    var text     = (message.body || '').trim().toLowerCase();
    var sender   = message.sender.id;
    var senderName = message.sender.pushname || 'Jogador';

    if (isGroup) {
      await processarComandoGrupo(client, message);
      return;
    }

    // Admin via texto
    if (text.startsWith('admin ') || text === 'admin') {
      var cmdTexto = text === 'admin' ? 'admin ajuda' : text;
      await processarComandoAdmin(client, message, sender, cmdTexto);
      return;
    }

    // Comandos jogador privado
    switch (text) {
      case 'ajuda':
        await ajudaPrivado(client, message, sender);
        break;
      case 'confirmar':
        await confirmar(client, message, sender, senderName);
        break;
      case 'cancelar':
        await cancelar(client, message, sender);
        break;
      case 'lista':
        await lista(client, message, sender);
        break;
      default:
        break;
    }
  } catch(e) {
    console.error('[onMessage] Erro:', e);
  }
}

async function onPollResponse(response, sender, opcao) {
  try {
    // Importa adminPoll dinamicamente para evitar circular dependency
    var { processarAdminPoll } = require('./commands/adminPoll');

    // Sessao admin: processa independente de dedup
    if (getSession(sender)) {
      await processarAdminPoll(client, response, sender, opcao);
      return;
    }

    // Dedup para respostas de jogadores
    var chave = sender + (response.id || '') + opcao;
    if (!dedup(chave)) return;

    await processarAdminPoll(client, response, sender, opcao);
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

  app.listen(PORT, function() {
    console.log('AppFut Bot (Meta API) rodando na porta ' + PORT);
    console.log('Webhook: http://SEU_DOMINIO/webhook');
    console.log('Phone Number ID:', process.env.META_PHONE_NUMBER_ID || '(nao configurado)');
  });

  // Inicia o scheduler de lembretes
  iniciarScheduler(client);

  console.log('Scheduler iniciado.');
}

start();
