/**
 * set_webhook.js - Registra/atualiza o webhook de UMA instancia no Evolution.
 *
 * So faz sentido rodar DEPOIS que a instancia existir (Fase 3). Aqui apenas
 * ja deixamos pronto para quando a Fase 3 criar 'appfut-piloto'.
 *
 * Uso:
 *   cd ~/appfut/evolution
 *   node set_webhook.js appfut-piloto
 *
 * Requer variaveis em .env.evolution:
 *   SERVER_URL, AUTHENTICATION_API_KEY, WEBHOOK_URL, WEBHOOK_EVENTS
 */

require('dotenv').config({ path: '.env.evolution' });

var createClient = require('./client/evolutionClient');
var client = createClient();

var instanceName = process.argv[2];
if (!instanceName) {
  console.error('Uso: node set_webhook.js <nome-da-instancia>');
  console.error('Ex : node set_webhook.js appfut-piloto');
  process.exit(1);
}

var url           = process.env.WEBHOOK_URL    || 'http://127.0.0.1:3002/evolution';
var webhookSecret = process.env.WEBHOOK_SECRET || '';
var events = (process.env.WEBHOOK_EVENTS || 'MESSAGES_UPSERT,CONNECTION_UPDATE')
  .split(',')
  .map(function(s) { return s.trim(); })
  .filter(Boolean);

(async function main() {
  console.log('=== AppFut Evolution - Configurar Webhook ===');
  console.log('Instancia:', instanceName);
  console.log('URL      :', url);
  console.log('Eventos  :', events.join(', '));
  console.log('');

  // 1. Confirma que instancia existe
  try {
    var inst = await client.instance.fetch(instanceName);
    var arr = Array.isArray(inst) ? inst : (inst && inst.instances) || [];
    if (!arr.length) {
      console.error('Instancia "' + instanceName + '" nao existe. Crie antes (Fase 3).');
      process.exit(1);
    }
  } catch(e) {
    console.error('Falha ao checar instancia:', e.message);
    process.exit(1);
  }

  // 2. Registra webhook
  try {
    var cfg = {
      enabled:           true,
      url:               url,
      webhook_by_events: false,
      base64:            false,
      events:            events
    };
    // Problema 1: Evolution envia este header em cada POST para o nosso servidor
    if (webhookSecret) cfg.headers = { apikey: webhookSecret };

    var r = await client.webhook.set(instanceName, cfg);
    console.log('Webhook registrado:');
    console.log(JSON.stringify(r, null, 2));
  } catch(e) {
    console.error('Falha:', e.message);
    if (e.body) console.error('body:', JSON.stringify(e.body));
    process.exit(1);
  }

  // 3. Le de volta para confirmar
  try {
    var atual = await client.webhook.find(instanceName);
    console.log('');
    console.log('Webhook atual da instancia:');
    console.log(JSON.stringify(atual, null, 2));
  } catch(e) {
    console.error('(aviso) Falha ao reler webhook:', e.message);
  }

  console.log('');
  console.log('=== OK. Envie uma mensagem pra instancia e veja webhook_server.js logar. ===');
})().catch(function(err) {
  console.error('Erro inesperado:', err && err.stack || err);
  process.exit(1);
});
