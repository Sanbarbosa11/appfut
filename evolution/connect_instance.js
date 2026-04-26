/**
 * connect_instance.js - Busca o QR code atual da instancia e salva como PNG.
 *
 * WhatsApp rotaciona o QR a cada ~20s. Esse script aceita --watch para
 * ficar rebaixando periodicamente ate ver estado 'open'.
 *
 * Uso:
 *   cd ~/appfut/evolution
 *   node connect_instance.js                        # uma vez, sai
 *   node connect_instance.js appfut-piloto          # idem, nome explicito
 *   node connect_instance.js appfut-piloto --watch  # rebaixa a cada 15s
 *
 * O QR vem em base64 dentro do JSON - decodificamos e gravamos PILOT_QR_FILE.
 * Abra o arquivo PNG no visualizador do sistema e escaneie no celular.
 */

require('dotenv').config({ path: '.env.evolution' });

var fs = require('fs');
var createClient = require('./client/evolutionClient');
var client = createClient();

var args = process.argv.slice(2).filter(function(a) { return a !== '--watch'; });
var watch = process.argv.indexOf('--watch') !== -1;
var instanceName = args[0] || process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var qrFile = process.env.PILOT_QR_FILE || './qrcode.png';

function salvarQr(base64, arquivo) {
  if (!base64) return false;
  var clean = String(base64).replace(/^data:image\/[a-z]+;base64,/i, '');
  try {
    fs.writeFileSync(arquivo, Buffer.from(clean, 'base64'));
    return true;
  } catch(e) {
    console.error('[connect] falha ao salvar QR:', e.message);
    return false;
  }
}

async function umaRodada() {
  // 1. Estado atual
  var state = '?';
  try {
    var cs = await client.instance.connectionState(instanceName);
    state = (cs && cs.instance && cs.instance.state)
         || (cs && cs.state)
         || '?';
  } catch(e) {
    console.error('[connect] connectionState falhou:', e.message);
  }
  console.log('[' + new Date().toISOString() + '] state=' + state);

  if (state === 'open') {
    console.log('Ja conectado. Nada a fazer.');
    return { conectado: true };
  }

  // 2. Pedir QR
  var r;
  try {
    r = await client.instance.connect(instanceName);
  } catch(e) {
    console.error('[connect] connect falhou:', e.message);
    if (e.body) console.error('body:', JSON.stringify(e.body));
    return { conectado: false };
  }

  var base = (r && (r.base64 || r.qrcode || r.qr || r.code))
    || (r && r.instance && (r.instance.base64 || r.instance.qrcode))
    || null;
  if (base && typeof base === 'object') base = base.base64 || base.qr || base.code || null;

  var pairing = r && (r.pairingCode || (r.instance && r.instance.pairingCode));

  if (salvarQr(base, qrFile)) {
    console.log('QR atualizado em: ' + qrFile + ' (abra e escaneie)');
  } else {
    console.log('Sem QR no payload. Dump:');
    try { console.log(JSON.stringify(r, null, 2)); } catch(e) { console.log(r); }
  }
  if (pairing) {
    console.log('Pairing code: ' + pairing);
  }

  return { conectado: false };
}

(async function main() {
  console.log('=== AppFut Evolution - Conectar Instancia ===');
  console.log('Instancia:', instanceName, watch ? '(modo watch)' : '');
  console.log('QR file  :', qrFile);
  console.log('');

  if (!watch) {
    var r = await umaRodada();
    process.exit(r.conectado ? 0 : 0);
  }

  // Loop: tenta ate conectar. Sai com Ctrl+C.
  var tentativas = 0;
  var intervaloMs = 15000;
  while (true) {
    tentativas++;
    var r = await umaRodada();
    if (r.conectado) {
      console.log('Conectado apos ' + tentativas + ' tentativas.');
      process.exit(0);
    }
    await new Promise(function(res) { setTimeout(res, intervaloMs); });
  }
})().catch(function(err) {
  console.error('Erro inesperado:', err && err.stack || err);
  process.exit(1);
});
