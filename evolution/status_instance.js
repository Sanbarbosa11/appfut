/**
 * status_instance.js - Mostra estado da instancia no Evolution.
 *
 * Uso:
 *   node status_instance.js                 # PILOT_INSTANCE_NAME do .env
 *   node status_instance.js appfut-piloto   # nome explicito
 *
 * Imprime:
 *   - connectionState: open | close | connecting
 *   - dados do fetch (numero, nome do perfil, etc)
 *   - webhook registrado (url, events)
 */

require('dotenv').config({ path: '.env.evolution' });

var createClient = require('./client/evolutionClient');
var client = createClient();

var instanceName = process.argv[2] || process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';

function pick(obj, keys) {
  var out = {};
  keys.forEach(function(k) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

(async function main() {
  console.log('=== AppFut Evolution - Status da Instancia ===');
  console.log('Instancia:', instanceName);
  console.log('');

  // 1. Estado de conexao
  try {
    var cs = await client.instance.connectionState(instanceName);
    var state = (cs && cs.instance && cs.instance.state)
             || (cs && cs.state) || '?';
    console.log('connectionState: ' + state);
    try { console.log('  raw:', JSON.stringify(cs)); } catch(e) {}
  } catch(e) {
    console.error('Falha connectionState:', e.message);
  }
  console.log('');

  // 2. Fetch (numero/perfil)
  try {
    var inst = await client.instance.fetch(instanceName);
    var arr = Array.isArray(inst) ? inst : (inst && inst.instances) || [];
    if (!arr.length) {
      console.log('Instancia nao encontrada no fetchInstances.');
    } else {
      var i = arr[0];
      var info = i.instance || i;
      console.log('Dados:');
      console.log('  nome    :', info.instanceName || info.name);
      console.log('  status  :', info.status || info.connectionStatus);
      console.log('  numero  :', info.owner || info.number || info.wuid || '?');
      console.log('  perfil  :', info.profileName || info.pushName || '?');
      console.log('  integr. :', info.integration || '?');
    }
  } catch(e) {
    console.error('Falha fetch:', e.message);
  }
  console.log('');

  // 3. Webhook
  try {
    var wh = await client.webhook.find(instanceName);
    if (!wh || (!wh.url && !(wh.webhook && wh.webhook.url))) {
      console.log('Webhook: nao configurado. (rode: node set_webhook.js ' + instanceName + ')');
    } else {
      var w = wh.webhook || wh;
      console.log('Webhook:');
      console.log('  enabled :', w.enabled);
      console.log('  url     :', w.url);
      console.log('  events  :', Array.isArray(w.events) ? w.events.join(', ') : w.events);
    }
  } catch(e) {
    console.log('Webhook: nao configurado ou erro (' + e.message + ')');
  }
})().catch(function(err) {
  console.error('Erro inesperado:', err && err.stack || err);
  process.exit(1);
});
