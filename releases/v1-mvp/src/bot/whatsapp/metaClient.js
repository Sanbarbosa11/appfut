/**
 * metaClient.js — Wrapper para Meta WhatsApp Business API
 *
 * Expoe um objeto `client` compativel com as chamadas existentes no bot:
 *   client.sendText(chatId, text)
 *   client.sendPollMessage(chatId, title, options, config)
 *   client.sendButtons(chatId, title, buttons)   ← novo (max 3)
 *   client.sendList(chatId, header, body, btnText, sections)  ← novo (max 10 rows)
 *   client.sendTemplate(to, templateName, lang, components)   ← lembretes
 *
 * IDs: Meta usa "5511999999999", WPPConnect usava "5511999999999@c.us"
 * A funcao toMetaId() faz a conversao automaticamente.
 */

var https = require('https');

var PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
var ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;
var API_VERSION     = 'v20.0';

// ---------- helpers ----------

function toMetaId(id) {
  if (!id) return id;
  // Remove sufixo @c.us ou @g.us (grupos nao suportados diretamente pela Meta API)
  return String(id).replace(/@c\.us$|@g\.us$|@s\.whatsapp\.net$/, '');
}

function apiRequest(body) {
  return new Promise(function(resolve, reject) {
    var payload = JSON.stringify(body);
    var options = {
      hostname: 'graph.facebook.com',
      path: '/' + API_VERSION + '/' + PHONE_NUMBER_ID + '/messages',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            console.error('[Meta API] Erro HTTP ' + res.statusCode + ':', data);
            reject(new Error('Meta API HTTP ' + res.statusCode + ': ' + data));
          }
        } catch(e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------- funcoes de envio ----------

async function sendText(to, text) {
  return apiRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaId(to),
    type: 'text',
    text: { body: String(text) }
  });
}

/**
 * Botoes de resposta rapida (max 3 botoes)
 * buttons: [{ id: 'btn_1', title: 'Texto' }, ...]
 */
async function sendButtons(to, bodyText, buttons) {
  if (!buttons || buttons.length === 0) {
    return sendText(to, bodyText);
  }
  // Limita a 3 (limite da API)
  var btns = buttons.slice(0, 3).map(function(b) {
    return {
      type: 'reply',
      reply: { id: String(b.id), title: String(b.title).slice(0, 20) }
    };
  });

  return apiRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaId(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(bodyText) },
      action: { buttons: btns }
    }
  });
}

/**
 * Lista de selecao (max 10 rows por section, max 10 sections)
 * sections: [{ title: 'Secao', rows: [{ id: 'r1', title: 'Nome', description: '' }] }]
 */
async function sendList(to, headerText, bodyText, buttonText, sections) {
  return apiRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaId(to),
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: String(headerText).slice(0, 60) },
      body:   { text: String(bodyText).slice(0, 1024) },
      footer: { text: 'AppFut Bot' },
      action: {
        button: String(buttonText).slice(0, 20),
        sections: sections
      }
    }
  });
}

/**
 * Template (obrigatorio para mensagens iniciadas pelo bot — lembretes)
 * components: array de parametros conforme template aprovado
 */
async function sendTemplate(to, templateName, lang, components) {
  var body = {
    messaging_product: 'whatsapp',
    to: toMetaId(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang || 'pt_BR' }
    }
  };
  if (components && components.length > 0) {
    body.template.components = components;
  }
  return apiRequest(body);
}

/**
 * sendPollMessage — compatibilidade com codigo existente.
 *
 * WPPConnect usava enquetes nativas do WhatsApp.
 * Meta API nao tem enquetes — convertemos para:
 *   - Lista (sendList) se opcoes > 3
 *   - Botoes (sendButtons) se opcoes <= 3
 *
 * config.selectableCount ignorado (Meta nao suporta multi-select em listas)
 *
 * Formato de resposta: o usuario seleciona uma row e o webhook recebe
 * { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } }
 */
async function sendPollMessage(to, title, options, config) {
  if (!options || options.length === 0) {
    return sendText(to, title);
  }

  if (options.length <= 3) {
    var buttons = options.map(function(opt, i) {
      return { id: 'poll_' + i, title: String(opt).slice(0, 20) };
    });
    return sendButtons(to, title, buttons);
  }

  // Lista: agrupa em sections de 10
  var rows = [];
  var sections = [];
  var sectionTitle = 'Opcoes';
  var sectionRows = [];

  options.forEach(function(opt, i) {
    sectionRows.push({ id: 'poll_' + i, title: String(opt).slice(0, 24) });
    if (sectionRows.length === 10 || i === options.length - 1) {
      sections.push({ title: sectionTitle, rows: sectionRows.slice() });
      sectionRows = [];
      sectionTitle = 'Mais opcoes';
    }
  });

  return sendList(to, title, title, 'Ver opcoes', sections);
}

// ---------- objeto client compativel ----------

var client = {
  sendText:        sendText,
  sendButtons:     sendButtons,
  sendList:        sendList,
  sendTemplate:    sendTemplate,
  sendPollMessage: sendPollMessage,

  // Stub: Meta API nao permite buscar membros do grupo diretamente
  getChatById: async function(id) {
    console.warn('[metaClient] getChatById nao disponivel na Meta API:', id);
    return null;
  },
  getGroupMembers: async function(id) {
    console.warn('[metaClient] getGroupMembers nao disponivel na Meta API:', id);
    return [];
  }
};

module.exports = { client, sendText, sendButtons, sendList, sendTemplate, sendPollMessage, toMetaId };
