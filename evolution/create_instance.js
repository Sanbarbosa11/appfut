/**
 * create_instance.js - Cria a instancia do piloto no Evolution API.
 *
 * Idempotente: se a instancia ja existe, apenas reporta e sai 0.
 * NAO escaneia QR nem configura webhook (isso fica em connect_instance.js
 * e set_webhook.js).
 *
 * Uso:
 *   cd ~/appfut/evolution
 *   node create_instance.js                 # usa PILOT_INSTANCE_NAME do .env
 *   node create_instance.js appfut-piloto   # ou passa o nome direto
 *
 * Variaveis usadas do .env.evolution:
 *   SERVER_URL, AUTHENTICATION_API_KEY - para falar com Evolution
 *   PILOT_INSTANCE_NAME                - nome padrao se nao passar argv
 *   PILOT_NUMBER                       - se setado, habilita pairing code
 */

require('dotenv').config({ path: '.env.evolution' });

var fs = require('fs');
var createClient = require('./client/evolutionClient');
var client = createClient();

var instanceName = process.argv[2] || process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var pilotNumber  = (process.env.PILOT_NUMBER || '').trim() || null;
var qrFile       = process.env.PILOT_QR_FILE || './qrcode.png';

function salvarQr(base64, arquivo) {
  if (!base64) return false;
  var clean = String(base64).replace(/^data:image\/[a-z]+;base64,/i, '');
  try {
    fs.writeFileSync(arquivo, Buffer.from(clean, 'base64'));
    return true;
  } catch(e) {
    console.error('[create] falha ao salvar QR em ' + arquivo + ':', e.message);
    return false;
  }
}

(async function main() {
  console.log('=== AppFut Evolution - Criar Instancia ===');
  console.log('Instancia:', instanceName);
  console.log('Numero   :', pilotNumber || '(nao definido - usaremos QR scan)');
  console.log('');

  // 1. Ver se ja existe
  try {
    var inst = await client.instance.fetch(instanceName);
    var arr = Array.isArray(inst) ? inst : (inst && inst.instances) || [];
    if (arr.length) {
      console.log('Instancia "' + instanceName + '" JA EXISTE. Nada a fazer.');
      console.log('Proximos passos:');
      console.log('  - node status_instance.js ' + instanceName);
      console.log('  - node connect_instance.js ' + instanceName + '   (se ainda nao conectou)');
      console.log('  - node set_webhook.js ' + instanceName);
      process.exit(0);
    }
  } catch(e) {
    if (e.status !== 404) {
      console.error('Falha ao checar instancia existente:', e.message);
      process.exit(1);
    }
    // 404 = instancia nao existe ainda, prosseguir para criar
  }

  // 2. Criar
  var opts = { qrcode: true };
  if (pilotNumber) opts.number = pilotNumber;

  var r;
  try {
    r = await client.instance.create(instanceName, opts);
  } catch(e) {
    console.error('Falha ao criar instancia:', e.message);
    if (e.body) console.error('body:', JSON.stringify(e.body));
    process.exit(1);
  }

  console.log('Instancia criada. Resposta:');
  try { console.log(JSON.stringify(r, null, 2)); } catch(e) { console.log(r); }
  console.log('');

  // 3. Se Evolution ja retornou o QR junto, salvamos aqui
  var qr = r && (r.qrcode || (r.instance && r.instance.qrcode));
  var base = qr && (qr.base64 || qr.qr || qr.code);
  if (base && salvarQr(base, qrFile)) {
    console.log('QR salvo em: ' + qrFile);
    console.log('Abra esse arquivo e escaneie no WhatsApp do chip secundario.');
  } else {
    console.log('QR nao veio no create. Rode: node connect_instance.js ' + instanceName);
  }

  var pairing = r && (r.pairingCode || (r.instance && r.instance.pairingCode));
  if (pairing) {
    console.log('');
    console.log('Pairing code: ' + pairing);
    console.log('(WhatsApp -> Aparelhos conectados -> Vincular com numero de telefone)');
  }

  console.log('');
  console.log('Apos escanear:');
  console.log('  node status_instance.js ' + instanceName + '      # deve mostrar "open"');
  console.log('  node set_webhook.js ' + instanceName + '          # registrar webhook');
})().catch(function(err) {
  console.error('Erro inesperado:', err && err.stack || err);
  process.exit(1);
});
