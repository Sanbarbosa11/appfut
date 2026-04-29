var db = require('../database/connection');

// dedup permanece em memoria (janela de 10s — perda num restart e aceitavel)
var dedup = {};

// Rate limit persistido no MySQL para sobreviver restarts.
// Falha silenciosamente (permite a acao) se o banco estiver indisponivel.
async function verificarRateLimit(chaveBase, acao, max, janelaMs) {
  var chave  = chaveBase + ':' + acao;
  var agora  = Date.now();
  max      = max      || 3;
  janelaMs = janelaMs || 3600000;

  try {
    var [rows] = await db.execute('SELECT chamadas FROM rate_limits WHERE chave = ?', [chave]);
    var chamadas = rows.length > 0
      ? (Array.isArray(rows[0].chamadas) ? rows[0].chamadas : JSON.parse(rows[0].chamadas))
      : [];
    chamadas = chamadas.filter(function(t) { return agora - t < janelaMs; });

    if (chamadas.length >= max) {
      var minutosRestantes = Math.ceil((chamadas[0] + janelaMs - agora) / 60000);
      return { permitido: false, minutosRestantes: minutosRestantes, restante: 0 };
    }

    chamadas.push(agora);
    await db.execute(
      'INSERT INTO rate_limits (chave, chamadas) VALUES (?, ?) ON DUPLICATE KEY UPDATE chamadas = VALUES(chamadas)',
      [chave, JSON.stringify(chamadas)]
    );
    return { permitido: true, restante: max - chamadas.length };
  } catch(e) {
    console.error('[rateLimit] Erro DB, permitindo por seguranca:', e.message);
    return { permitido: true, restante: max };
  }
}

function isDuplicado(chaveBase, acao) {
  var chave = chaveBase + ':' + acao;
  var agora = Date.now();
  if (dedup[chave] && agora - dedup[chave] < 10000) return true;
  dedup[chave] = agora;
  return false;
}

function delay() {
  return new Promise(function(resolve) {
    setTimeout(resolve, 1000 + Math.random() * 2000);
  });
}

module.exports = { verificarRateLimit, isDuplicado, delay };
