// Envia alertas via Evolution (Baileys) — sem restricao de janela de 24h do Meta API
var EVOLUTION_WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL || 'http://127.0.0.1:3002';

function agora() {
  var d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') +
    ' de ' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
}

async function alertar(mensagem) {
  try {
    await fetch(EVOLUTION_WEBHOOK_URL + '/internal/alert', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: mensagem })
    });
  } catch(e) {
    console.error('[alertar] Erro ao enviar alerta:', e.message);
  }
}

module.exports = { alertar, agora };
