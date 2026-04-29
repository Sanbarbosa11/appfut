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

function urlJoin(base, p) {
  var b = String(base).replace(/\/+$/, '');
  var s = String(p).replace(/^\/+/, '');
  return b + '/' + s;
}

// --- Normalizacao de numero ---
// JIDs (@g.us, @s.whatsapp.net, @lid) passam direto.
// Numeros de telefone ficam no formato '55DDDNNNNNNNNN'.
function normalizarNumero(num) {
  if (!num) return null;
  var s = String(num);
  if (s.indexOf('@') !== -1) return s;
  var digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 || digits.length === 10) digits = '55' + digits;
  return digits;
}

// Cria um cliente com config encapsulada. Cada chamada a createClient() produz
// um objeto independente — sem mutacao de variaveis do modulo.
module.exports = function createClient(override) {
  var serverUrl = (override && override.serverUrl) || process.env.SERVER_URL || 'http://localhost:8080';
  var apiKey    = (override && override.apiKey)    || process.env.AUTHENTICATION_API_KEY || '';
  var timeoutMs = (override && override.timeoutMs) || Number(process.env.EVOLUTION_HTTP_TIMEOUT_MS || 15000);

  function headers(extra) {
    var h = { 'Content-Type': 'application/json', 'apikey': apiKey };
    if (extra) Object.keys(extra).forEach(function(k) { h[k] = extra[k]; });
    return h;
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    var url  = urlJoin(serverUrl, path);
    var ctrl = new AbortController();
    var to   = setTimeout(function() { ctrl.abort(); }, opts.timeoutMs || timeoutMs);

    var init = {
      method:  method,
      headers: headers(opts.headers),
      signal:  ctrl.signal
    };
    if (body !== undefined && body !== null && method !== 'GET') {
      init.body = JSON.stringify(body);
    }

    var res, text;
    try {
      res  = await fetch(url, init);
      text = await res.text();
    } catch(err) {
      clearTimeout(to);
      var msg = err && err.name === 'AbortError'
        ? 'timeout apos ' + (opts.timeoutMs || timeoutMs) + 'ms'
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

  // ========== INSTANCE ==========
  var instance = {
    fetch: function(name) {
      var qs = name ? '?instanceName=' + encodeURIComponent(name) : '';
      return request('GET', '/instance/fetchInstances' + qs);
    },
    create: function(instanceName, opts) {
      opts = opts || {};
      var payload = {
        instanceName: instanceName,
        integration:  opts.integration || 'WHATSAPP-BAILEYS',
        qrcode:       opts.qrcode !== false
      };
      if (opts.token)   payload.token = opts.token;
      if (opts.number)  payload.number = normalizarNumero(opts.number);
      if (opts.webhook) payload.webhook = opts.webhook;
      return request('POST', '/instance/create', payload);
    },
    connect: function(instanceName) {
      return request('GET', '/instance/connect/' + encodeURIComponent(instanceName));
    },
    connectionState: function(instanceName) {
      return request('GET', '/instance/connectionState/' + encodeURIComponent(instanceName));
    },
    restart: function(instanceName) {
      return request('PUT', '/instance/restart/' + encodeURIComponent(instanceName));
    },
    logout: function(instanceName) {
      return request('DELETE', '/instance/logout/' + encodeURIComponent(instanceName));
    },
    delete: function(instanceName) {
      return request('DELETE', '/instance/delete/' + encodeURIComponent(instanceName));
    }
  };

  // ========== MESSAGE ==========
  var message = {
    sendText: function(instanceName, number, text, opts) {
      opts = opts || {};
      var payload = { number: normalizarNumero(number), text: text };
      if (opts.delay !== undefined)  payload.delay = opts.delay;
      if (opts.quoted)               payload.quoted = opts.quoted;
      if (opts.linkPreview !== undefined) payload.linkPreview = opts.linkPreview;
      if (opts.mentionsEveryOne)     payload.mentionsEveryOne = true;
      if (opts.mentioned)            payload.mentioned = opts.mentioned;
      return request('POST', '/message/sendText/' + encodeURIComponent(instanceName), payload);
    },
    sendPoll: function(instanceName, number, poll) {
      var payload = {
        number:          normalizarNumero(number),
        name:            poll.name,
        selectableCount: poll.selectableCount || 1,
        values:          poll.values
      };
      return request('POST', '/message/sendPoll/' + encodeURIComponent(instanceName), payload);
    },
    sendList: function(instanceName, number, list) {
      var payload = Object.assign({ number: normalizarNumero(number) }, list);
      return request('POST', '/message/sendList/' + encodeURIComponent(instanceName), payload);
    },
    sendMedia: function(instanceName, number, media) {
      var payload = Object.assign({ number: normalizarNumero(number) }, media);
      return request('POST', '/message/sendMedia/' + encodeURIComponent(instanceName), payload);
    }
  };

  // ========== GROUP ==========
  var group = {
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
        subject:      subject,
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
    set: function(instanceName, cfg) {
      return request('POST', '/webhook/set/' + encodeURIComponent(instanceName), { webhook: cfg });
    },
    find: function(instanceName) {
      return request('GET', '/webhook/find/' + encodeURIComponent(instanceName));
    }
  };

  // ========== CHAT ==========
  var chat = {
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

  return {
    config: function() {
      return {
        serverUrl:    serverUrl,
        timeoutMs:    timeoutMs,
        apiKeyPreview: apiKey ? (apiKey.slice(0, 6) + '...' + apiKey.slice(-4)) : '(vazia)'
      };
    },
    health:            health,
    instance:          instance,
    message:           message,
    group:             group,
    webhook:           webhook,
    chat:              chat,
    _normalizarNumero: normalizarNumero,
    _request:          request,
    EvolutionError:    EvolutionError
  };
};
