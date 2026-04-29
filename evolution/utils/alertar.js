var createClient = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';
var ADMIN_JID    = process.env.ALERT_ADMIN_JID || '';

function agora() {
  var d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') +
    ' de ' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
}

async function alertar(mensagem) {
  if (!ADMIN_JID) return;
  try {
    var client = createClient();
    await client.message.sendText(instanceName, ADMIN_JID, mensagem);
  } catch(e) { console.error('[alertar] Erro ao enviar alerta:', e.message); }
}

module.exports = { alertar, agora };
