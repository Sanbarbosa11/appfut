/**
 * init_grupos.js — Escaneia grupos existentes da instancia e registra no evolution_db.
 *
 * Rodar uma vez apos subir o webhook_server, ou sempre que quiser sincronizar.
 * Uso:
 *   cd ~/appfut/evolution
 *   node init_grupos.js
 */

require('dotenv').config({ path: '.env.evolution' });

var createClient  = require('./client/evolutionClient');
var { registrarGrupo } = require('./handlers/autoSetup');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var client = createClient();

(async function main() {
  console.log('=== AppFut Evolution - Init Grupos ===');
  console.log('Instancia:', instanceName);
  console.log('');

  var grupos;
  try {
    grupos = await client.group.fetchAll(instanceName, true);
  } catch(e) {
    console.error('Falha ao buscar grupos:', e.message);
    process.exit(1);
  }

  var lista = Array.isArray(grupos) ? grupos : (grupos && grupos.groups) || [];
  console.log('Grupos encontrados:', lista.length);
  console.log('');

  for (var g of lista) {
    try {
      var participants = g.participants || [];
      await registrarGrupo(g.id, g.subject || g.id, participants);
    } catch(e) {
      console.error('Erro ao registrar grupo', g.id, ':', e.message);
    }
  }

  console.log('');
  console.log('=== Concluido. ===');
  process.exit(0);
})().catch(function(err) {
  console.error('Erro inesperado:', err && err.stack || err);
  process.exit(1);
});
