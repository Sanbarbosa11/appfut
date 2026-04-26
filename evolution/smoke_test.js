/**
 * smoke_test.js - Valida que o Evolution API subiu e responde.
 *
 * NAO cria instancia, NAO conecta WhatsApp. Apenas:
 *   1. Checa health do servidor
 *   2. Lista instancias existentes
 *
 * Rodar no servidor (onde o container esta):
 *   cd ~/appfut/evolution && node smoke_test.js
 *
 * Do PC (opcional) se tiver port-forward ou IP publico exposto.
 */

require('dotenv').config({ path: '.env.evolution' });

var createClient = require('./client/evolutionClient');
var client = createClient();

(async function main() {
  console.log('=== AppFut Evolution - Smoke Test ===');
  console.log('Config:', client.config());
  console.log('');

  // 1. Health
  console.log('[1/2] GET / (healthcheck)...');
  var h = await client.health();
  if (!h.ok) {
    console.error('  FALHOU:', h.error, h.status ? '(HTTP ' + h.status + ')' : '');
    console.error('  Dicas:');
    console.error('   - docker compose -f docker-compose.evolution.yml ps');
    console.error('   - docker compose -f docker-compose.evolution.yml logs --tail 50');
    console.error('   - curl -v ' + (process.env.SERVER_URL || 'http://localhost:8080') + '/');
    process.exit(1);
  }
  console.log('  OK:', JSON.stringify(h.info));
  console.log('');

  // 2. Listar instancias
  console.log('[2/2] GET /instance/fetchInstances...');
  try {
    var inst = await client.instance.fetch();
    var arr = Array.isArray(inst) ? inst : (inst && inst.instances) || [];
    console.log('  OK. Instancias cadastradas:', arr.length);
    if (arr.length > 0) {
      arr.forEach(function(i, idx) {
        var name = (i.instance && i.instance.instanceName) || i.instanceName || i.name || '?';
        var state = (i.instance && i.instance.status) || i.status || i.connectionStatus || '?';
        console.log('   ' + (idx + 1) + '. ' + name + ' [' + state + ']');
      });
    } else {
      console.log('  (nenhuma - esperado na Fase 1, sera criada na Fase 3)');
    }
  } catch(e) {
    console.error('  FALHOU:', e.message);
    if (e.status === 401 || e.status === 403) {
      console.error('  -> Provavelmente AUTHENTICATION_API_KEY errada no .env.evolution.');
    }
    process.exit(1);
  }

  console.log('');
  console.log('=== Smoke test OK. Evolution esta respondendo. ===');
})().catch(function(err) {
  console.error('Erro inesperado:', err && err.stack || err);
  process.exit(1);
});
