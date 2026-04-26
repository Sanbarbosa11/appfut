var limites = {};
var dedup   = {};

function verificarRateLimit(chaveBase, acao) {
  var chave  = chaveBase + ':' + acao;
  var agora  = Date.now();
  var janela = 3600000;
  var max    = 3;

  if (!limites[chave]) limites[chave] = [];
  limites[chave] = limites[chave].filter(function(t) { return agora - t < janela; });

  if (limites[chave].length >= max) {
    var mais_antigo = limites[chave][0];
    var minutosRestantes = Math.ceil((mais_antigo + janela - agora) / 60000);
    return { permitido: false, minutosRestantes: minutosRestantes, restante: 0 };
  }

  limites[chave].push(agora);
  return { permitido: true, restante: max - limites[chave].length };
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
