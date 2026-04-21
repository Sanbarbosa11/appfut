/**
 * webhook.js — Servidor Express para receber eventos da Meta WhatsApp API
 *
 * GET  /webhook  → verificacao do webhook (Meta envia challenge)
 * POST /webhook  → mensagens/eventos recebidos
 *
 * Normaliza o payload da Meta para um formato parecido com
 * o que o WPPConnect gerava, entao chama os handlers existentes.
 *
 * Variaveis de ambiente necessarias:
 *   META_WEBHOOK_VERIFY_TOKEN  — segredo que voce define no Meta Dashboard
 *   META_PHONE_NUMBER_ID       — ID do numero no Meta
 *   META_ACCESS_TOKEN          — token permanente do System User
 */

var express = require('express');
var router  = express.Router();

var VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'appfut_verify_token';

// Handler injetado pelo index_meta.js
var messageHandler    = null;
var pollHandler       = null;
var participantHandler = null;

function setHandlers(handlers) {
  messageHandler     = handlers.onMessage;
  pollHandler        = handlers.onPollResponse;
  participantHandler = handlers.onParticipantsChanged;
}

// ---------- GET: verificacao do webhook ----------

router.get('/webhook', function(req, res) {
  var mode      = req.query['hub.mode'];
  var token     = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook] Verificacao OK');
    res.status(200).send(challenge);
  } else {
    console.error('[Webhook] Token invalido:', token);
    res.sendStatus(403);
  }
});

// ---------- POST: receber mensagens ----------

router.post('/webhook', function(req, res) {
  // Responde 200 imediatamente (Meta exige < 20s)
  res.sendStatus(200);

  try {
    var body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') return;

    var entries = body.entry || [];
    entries.forEach(function(entry) {
      var changes = entry.changes || [];
      changes.forEach(function(change) {
        var value = change.value || {};
        processValue(value);
      });
    });
  } catch(e) {
    console.error('[Webhook] Erro ao processar payload:', e);
  }
});

function processValue(value) {
  var messages = value.messages || [];
  var contacts = value.contacts || [];
  var statuses = value.statuses || [];

  // Mapeia contatos para nomes
  var contactMap = {};
  contacts.forEach(function(c) {
    if (c.wa_id) {
      contactMap[c.wa_id] = (c.profile && c.profile.name) || 'Jogador';
    }
  });

  messages.forEach(function(msg) {
    var from   = msg.from;  // ex: "5511999999999"
    var fromId = from + '@c.us';  // normaliza para formato WPPConnect
    var senderName = contactMap[from] || 'Jogador';
    var msgId  = msg.id;
    var timestamp = msg.timestamp;

    // Metadata do grupo/numero destino
    var metadata  = value.metadata || {};
    var toPhone   = metadata.display_phone_number || '';

    if (msg.type === 'text') {
      handleTextMessage(fromId, senderName, msgId, msg.text && msg.text.body, false);

    } else if (msg.type === 'interactive') {
      var interactive = msg.interactive || {};
      handleInteractive(fromId, senderName, msgId, interactive);

    } else if (msg.type === 'image' || msg.type === 'document' || msg.type === 'audio') {
      handleMediaMessage(fromId, senderName, msgId, msg.type, msg[msg.type]);

    } else {
      // Outros tipos: location, contacts, sticker, etc.
      console.log('[Webhook] Tipo nao tratado:', msg.type, 'de', from);
    }
  });

  // Status de entrega (sent, delivered, read, failed) — apenas log
  statuses.forEach(function(s) {
    if (s.status === 'failed') {
      console.error('[Webhook] Falha na entrega para', s.recipient_id, ':', JSON.stringify(s.errors));
    }
  });
}

function handleTextMessage(fromId, senderName, msgId, text, isGroup) {
  if (!messageHandler || !text) return;

  var message = {
    id:          msgId,
    body:        text,
    isGroupMsg:  isGroup,
    sender:      { id: fromId, pushname: senderName },
    from:        fromId,
    type:        'chat'
  };

  messageHandler(message).catch(function(e) {
    console.error('[Webhook] Erro em messageHandler:', e);
  });
}

function handleInteractive(fromId, senderName, msgId, interactive) {
  var type = interactive.type;

  if (type === 'button_reply') {
    var btnReply = interactive.button_reply || {};
    var title    = btnReply.title || '';
    var btnId    = btnReply.id    || '';

    if (pollHandler) {
      var response = {
        id:              msgId,
        sender:          fromId,
        senderName:      senderName,
        selectedOptions: [{ name: title, id: btnId }],
        _allSelected:    [{ name: title }]
      };
      pollHandler(response, fromId, title).catch(function(e) {
        console.error('[Webhook] Erro em pollHandler (button):', e);
      });
    }

  } else if (type === 'list_reply') {
    var listReply = interactive.list_reply || {};
    var lTitle    = listReply.title || '';
    var lId       = listReply.id    || '';

    if (pollHandler) {
      var lResponse = {
        id:              msgId,
        sender:          fromId,
        senderName:      senderName,
        selectedOptions: [{ name: lTitle, id: lId }],
        _allSelected:    [{ name: lTitle }]
      };
      pollHandler(lResponse, fromId, lTitle).catch(function(e) {
        console.error('[Webhook] Erro em pollHandler (list):', e);
      });
    }
  }
}

function handleMediaMessage(fromId, senderName, msgId, mediaType, mediaObj) {
  if (!messageHandler) return;

  var message = {
    id:         msgId,
    body:       '',
    isGroupMsg: false,
    sender:     { id: fromId, pushname: senderName },
    from:       fromId,
    type:       mediaType,
    mediaData:  mediaObj  // id, mime_type, sha256
  };

  messageHandler(message).catch(function(e) {
    console.error('[Webhook] Erro em messageHandler (media):', e);
  });
}

module.exports = { router, setHandlers };
