/**
 * evolutionClient.js - Wrapper HTTP para Evolution API v2.3.5
 *
 * Isolado do src/ de producao. Le config do .env.evolution.
 * Nao toca em nada do bot atual.
 *
 * Uso:
 *   var client = require('./evolutionClient')();
 *   await client.instance.create('appfut-piloto');
 *   await client.instance.connect('appfut-piloto');
 *   await client.message.sendText('appfut-piloto', '5511999999999', 'oi');
 */

var SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
var API_KEY    = process.env.AUTHENTICATION_API_KEY || '';
var TIMEOUT_MS = Number(process.env.EVOLUTION_HTTP_TIMEOUT_MS || 15000);

function headers(extra) {
  var h = {
    'Content-Type': 'application/json',
    'apikey': API_KEY
  };
  if (extra) Object.keys(extra).forEach(function(k) { h[k] = extra[k]; });
  return h;
}

function urlJoin(base, path) {
  var b = String(base).replace(/\/+$/, '');
  var p = String(path).replace(/^\/+/, '');
  return b + '/' + p;
}

async function request(method, path, body, opts) {
  opts = opts || {};
  var url = urlJoin(SERVER_URL, path);
  var ctrl = new AbortController();
  var to = setTimeout(function() { ctrl.abort(); }, opts.timeoutMs || TIMEOUT_MS);

  var init = {
    method: method,
    headers: headers(opts.headers),
    signal: ctrl.signal
  };
  if (body !== undefined && body !== null && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  var res, text;
  try {
    res = await fetch(url, init);
    text = await res.text();
  } catch(err) {
    clearTimeout(to);
    var msg = err && err.name === 'AbortError'
      ? 'timeout apos ' + (opts.timeoutMs || TIMEOUT_MS) + 'ms'
      : (err && err.message) || String(err);
    throw new EvolutionError('Falha HTTP (' + method + ' ' + path + '): ' + msg, { cause: err });
  }
  clearTimeout(to);

  var data = null;
  if (text) {
    try { data = JSON.parse(text); } catch(e) { data = text; }
  }

  if (!res.ok) {
    throw new EvolutionError(
      'Evolution API respondeu ' + res.status + ' em ' + method + ' ' + path,
      { status: res.status, body: data }
    );
  }
  return data;
}

function EvolutionError(message, meta) {
  var e = new Error(message);
  e.name = 'EvolutionError';
  if (meta) {
    if (meta.status) e.status = meta.status;
    if (meta.body !== undefined) e.body = meta.body;
    if (meta.cause) e.cause = meta.cause;
  }
  return e;
}

// --- Normalizacao de numero ---
// JIDs (@g.us, @s.whatsapp.net, @lid) passam direto.
// Numeros de telefone ficam no formato '55DDDNNNNNNNNN'.
function normalizarNumero(num) {
  if (!num) return null;
  var s = String(num);
  if (s.indexOf('@') !== -1) return s; // JID completo, nao normalizar
  var digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 || digits.length === 10) digits = '55' + digits;
  return digits;
}

// ========== INSTANCE ==========
var instance = {
  // Lista instancias. Sem filtro retorna todas.
  fetch: function(name) {
    var qs = name ? '?instanceName=' + encodeURIComponent(name) : '';
    return request('GET', '/instance/fetchInstances' + qs);
  },

  // Cria instancia. 'integration' padrao v2.3.5: 'WHATSAPP-BAILEYS'
  // webhook opcional: { url, events: [...] }
  create: function(instanceName, opts) {
    opts = opts || {};
    var payload = {
      instanceName: instanceName,
      integration: opts.integration || 'WHATSAPP-BAILEYS',
      qrcode: opts.qrcode !== false  // default true
    };
    if (opts.token)   payload.token = opts.token;
    if (opts.number)  payload.number = normalizarNumero(opts.number);
    if (opts.webhook) payload.webhook = opts.webhook;
    return request('POST', '/instance/create', payload);
  },

  // Retorna QR code (base64) + pairingCode
  connect: function(instanceName) {
    return request('GET', '/instance/connect/' + encodeURIComponent(instanceName));
  },

  // { state: 'open' | 'close' | 'connecting' }
  connectionState: function(instanceName) {
    return request('GET', '/instance/connectionState/' + encodeURIComponent(instanceName));
  },

  restart: function(instanceName) {
    return request('PUT', '/instance/restart/' + encodeURIComponent(instanceName));
  },

  logout: function(instanceName) {
    return request('DELETE', '/instance/logout/' + encodeURIComponent(instanceName));
  },

  // CUIDADO: remove a instancia e todos os dados
  delete: function(instanceName) {
    return request('DELETE', '/instance/delete/' + encodeURIComponent(instanceName));
  }
};

// ========== MESSAGE ==========
var message = {
  sendText: function(instanceName, number, text, opts) {
    opts = opts || {};
    var payload = {
      number: normalizarNumero(number),
      text: text
    };
    if (opts.delay !== undefined) payload.delay = opts.delay;
    if (opts.quoted) payload.quoted = opts.quoted;
    if (opts.linkPreview !== undefined) payload.linkPreview = opts.linkPreview;
    if (opts.mentionsEveryOne) payload.mentionsEveryOne = true;
    if (opts.mentioned) payload.mentioned = opts.mentioned;
    return request('POST', '/message/sendText/' + encodeURIComponent(instanceName), payload);
  },

  // Enquete WhatsApp nativa
  sendPoll: function(instanceName, number, poll) {
    // poll = { name, selectableCount, values: ['op1','op2'] }
    var payload = {
      number: normalizarNumero(number),
      name: poll.name,
      selectableCount: poll.selectableCount || 1,
      values: poll.values
    };
    return request('POST', '/message/sendPoll/' + encodeURIComponent(instanceName), payload);
  },

  // Lista interativa (WhatsApp List Message)
  sendList: function(instanceName, number, list) {
    // list = { title, description, buttonText, footerText?, sections: [...] }
    var payload = Object.assign({ number: normalizarNumero(number) }, list);
    return request('POST', '/message/sendList/' + encodeURIComponent(instanceName), payload);
  },

  sendMedia: function(instanceName, number, media) {
    // media = { mediatype: 'image'|'video'|'document', media: url|base64, caption?, fileName? }
    var payload = Object.assign({ number: normalizarNumero(number) }, media);
    return request('POST', '/message/sendMedia/' + encodeURIComponent(instanceName), payload);
  }
};

// ========== GROUP ==========
var group = {
  // getParticipants=true traz membros e admins
  fetchAll: function(instanceName, getParticipants) {
    var qs = '?getParticipants=' + (getParticipants ? 'true' : 'false');
    return request('GET', '/group/fetchAllGroups/' + encodeURIComponent(instanceName) + qs);
  },

  findInfo: function(instanceName, groupJid) {
    var qs = '?groupJid=' + encodeURIComponent(groupJid);
    return request('GET', '/group/findGroupInfos/' + encodeURIComponent(instanceName) + qs);
  },

  participants: function(instanceName, groupJid) {
    var qs = '?groupJid=' + encodeURIComponent(groupJid);
    return request('GET', '/group/participants/' + encodeURIComponent(instanceName) + qs);
  },

  create: function(instanceName, subject, participants) {
    var payload = {
      subject: subject,
      participants: (participants || []).map(normalizarNumero).filter(Boolean)
    };
    return request('POST', '/group/create/' + encodeURIComponent(instanceName), payload);
  },

  leave: function(instanceName, groupJid) {
    var qs = '?groupJid=' + encodeURIComponent(groupJid);
    return request('DELETE', '/group/leaveGroup/' + encodeURIComponent(instanceName) + qs);
  }
};

// ========== WEBHOOK ==========
var webhook = {
  // cfg = { enabled: true, url, webhook_by_events?, base64?, events: [...] }
  set: function(instanceName, cfg) {
    var payload = { webhook: cfg };
    return request('POST', '/webhook/set/' + encodeURIComponent(instanceName), payload);
  },
  find: function(instanceName) {
    return request('GET', '/webhook/find/' + encodeURIComponent(instanceName));
  }
};

// ========== CHAT (util para checar contato/JID) ==========
var chat = {
  // Verifica se numero tem WhatsApp e retorna JID real
  whatsappNumbers: function(instanceName, numbers) {
    var payload = { numbers: (numbers || []).map(normalizarNumero).filter(Boolean) };
    return request('POST', '/chat/whatsappNumbers/' + encodeURIComponent(instanceName), payload);
  }
};

// ========== HEALTHCHECK ==========
async function health() {
  try {
    var r = await request('GET', '/');
    return { ok: true, info: r };
  } catch(e) {
    return { ok: false, error: e.message, status: e.status };
  }
}

module.exports = function createClient(override) {
  if (override) {
    if (override.serverUrl) SERVER_URL = override.serverUrl;
    if (override.apiKey)    API_KEY    = override.apiKey;
    if (override.timeoutMs) TIMEOUT_MS = override.timeoutMs;
  }
  return {
    config: function() {
      return {
        serverUrl: SERVER_URL,
        timeoutMs: TIMEOUT_MS,
        apiKeyPreview: API_KEY ? (API_KEY.slice(0, 6) + '...' + API_KEY.slice(-4)) : '(vazia)'
      };
    },
    health: health,
    instance: instance,
    message: message,
    group: group,
    webhook: webhook,
    chat: chat,
    // utilitarios
    _normalizarNumero: normalizarNumero,
    _request: request,
    EvolutionError: EvolutionError
  };
};
