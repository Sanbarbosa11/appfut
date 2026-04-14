/**
 * deploy_fix_sender_normalizacao.js
 *
 * PROBLEMA: Meta API envia sender sem '@c.us' (ex: '5511963456139').
 * WPPConnect registra jogadores COM '@c.us' (ex: '5511963456139@c.us').
 * Resultado: dois registros para o mesmo jogador, cancelar/lista falham.
 *
 * FIXES:
 * 1. index_meta.js — normaliza sender para adicionar '@c.us' antes de qualquer uso
 * 2. cancelar.js   — busca partida via presencas (nao exige grupo_jogadores)
 * 3. lista.js      — busca partida via grupo_jogadores OU via presencas
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';

// ============================================================
// 1. index_meta.js — normalizar sender no onMessage
// ============================================================

var indexPath = BASE + '/src/bot/index_meta.js';
var indexContent = fs.readFileSync(indexPath, 'utf8');

var oldSender = "    var sender     = message.sender.id;";
var newSender = [
  "    var sender     = message.sender.id;",
  "    // Normaliza: Meta API envia sem @c.us, banco usa @c.us (padrao WPPConnect)",
  "    if (sender && !sender.includes('@')) sender = sender + '@c.us';"
].join('\n');

if (!indexContent.includes("!sender.includes('@')")) {
  indexContent = indexContent.replace(oldSender, newSender);
  fs.writeFileSync(indexPath, indexContent);
  console.log('[OK] index_meta.js - normalizacao @c.us adicionada');
} else {
  console.log('[SKIP] index_meta.js - normalizacao ja existe');
}

// ============================================================
// 2. cancelar.js — busca partida via presencas (robusto)
// ============================================================

var cancelarPath = BASE + '/src/bot/commands/cancelar.js';

var cancelarContent = [
  "var db = require('../../database/connection');",
  "var { verificarRateLimit, delay } = require('../utils/rateLimit');",
  "",
  "async function cancelar(client, message, sender) {",
  "  var limite = verificarRateLimit(sender, 'cancelar');",
  "  if (!limite.permitido) return;",
  "  await delay();",
  "",
  "  var [jogador] = await db.execute(",
  "    'SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]",
  "  );",
  "  if (jogador.length === 0) {",
  "    await client.sendText(message.from, 'Voc\u00ea n\u00e3o est\u00e1 cadastrado. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  // Busca partidas abertas onde o jogador esta confirmado",
  "  var [partidas] = await db.execute(",
  "    'SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +",
  "    'FROM presencas pr ' +",
  "    'JOIN partidas p ON pr.partida_id = p.id ' +",
  "    'JOIN grupos g ON p.grupo_id = g.id ' +",
  "    \"WHERE pr.jogador_id = ? AND p.status = 'aberta' \" +",
  "    'ORDER BY p.data_partida ASC',",
  "    [jogador[0].id]",
  "  );",
  "",
  "  if (partidas.length === 0) {",
  "    await client.sendText(message.from, 'Voc\u00ea n\u00e3o tem presen\u00e7a confirmada em nenhum jogo aberto. \ud83e\udd37');",
  "    return;",
  "  }",
  "",
  "  if (partidas.length === 1) {",
  "    await cancelarPartida(client, sender, jogador[0].id, partidas[0]);",
  "    return;",
  "  }",
  "",
  "  // Multiplas partidas: envia botoes",
  "  var btns = partidas.slice(0, 3).map(function(p) {",
  "    var data = new Date(p.data_partida);",
  "    var dataStr = String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0');",
  "    return { id: 'ausente_' + p.id, title: (p.grupo_nome + ' ' + dataStr).slice(0, 20) };",
  "  });",
  "  await client.sendButtons(message.from, 'Qual jogo voc\u00ea quer cancelar?', btns);",
  "}",
  "",
  "async function cancelarPartida(client, sender, jogadorId, partida) {",
  "  await db.execute(",
  "    'DELETE FROM presencas WHERE partida_id = ? AND jogador_id = ?',",
  "    [partida.id, jogadorId]",
  "  );",
  "",
  "  var [conf] = await db.execute(",
  "    'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [partida.id]",
  "  );",
  "  var [avul] = await db.execute(",
  "    'SELECT COUNT(*) as total FROM avulsos WHERE partida_id = ?', [partida.id]",
  "  );",
  "  var totalConfirmados = conf[0].total + avul[0].total;",
  "",
  "  var dataP = new Date(partida.data_partida);",
  "  var dataStr = String(dataP.getDate()).padStart(2, '0') + '/' + String(dataP.getMonth() + 1).padStart(2, '0');",
  "",
  "  // Busca lista completa para mostrar apos cancelamento",
  "  var { buscarDadosLista, montarLista } = require('./confirmar');",
  "  var dadosLista = await buscarDadosLista(partida);",
  "  var textoLista = montarLista(dadosLista, partida);",
  "",
  "  await client.sendText(sender,",
  "    '\u274c Presen\u00e7a cancelada.\\n\\n' +",
  "    '\u26bd ' + partida.grupo_nome + '\\n' +",
  "    '\ud83d\udcc5 ' + dataStr + '\\n' +",
  "    '\ud83d\udccc ' + totalConfirmados + '/' + partida.max_jogadores + ' confirmados\\n\\n' +",
  "    textoLista",
  "  );",
  "}",
  "",
  "module.exports = { cancelar, cancelarPartida };"
].join('\n');

fs.writeFileSync(cancelarPath, cancelarContent);
console.log('[OK] cancelar.js reescrito (busca via presencas)');

// ============================================================
// 3. lista.js — busca partida via grupo_jogadores OU presencas
// ============================================================

var listaPath = BASE + '/src/bot/commands/lista.js';

var listaContent = [
  "var db = require('../../database/connection');",
  "var { verificarRateLimit, delay } = require('../utils/rateLimit');",
  "",
  "async function lista(client, message, sender) {",
  "  var limite = verificarRateLimit(sender, 'lista');",
  "  if (!limite.permitido) return;",
  "  await delay();",
  "",
  "  var [jogador] = await db.execute(",
  "    'SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]",
  "  );",
  "  if (jogador.length === 0) {",
  "    await client.sendText(message.from, 'Voc\u00ea n\u00e3o est\u00e1 cadastrado. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  // Busca partidas abertas: via grupo_jogadores OU via presencas",
  "  var [partidas] = await db.execute(",
  "    'SELECT DISTINCT p.id, p.data_partida, p.max_jogadores, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +",
  "    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +",
  "    'LEFT JOIN grupo_jogadores gj ON gj.grupo_id = g.id AND gj.jogador_id = ? AND gj.ativo = TRUE ' +",
  "    'LEFT JOIN presencas pr ON pr.partida_id = p.id AND pr.jogador_id = ? ' +",
  "    \"WHERE p.status = 'aberta' AND (gj.jogador_id IS NOT NULL OR pr.jogador_id IS NOT NULL) \" +",
  "    'ORDER BY p.data_partida ASC',",
  "    [jogador[0].id, jogador[0].id]",
  "  );",
  "",
  "  if (partidas.length === 0) {",
  "    await client.sendText(message.from, 'N\u00e3o h\u00e1 jogo aberto no momento. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  if (partidas.length === 1) {",
  "    var { buscarDadosLista, montarLista } = require('./confirmar');",
  "    var dados = await buscarDadosLista(partidas[0]);",
  "    await client.sendText(message.from, montarLista(dados, partidas[0]));",
  "    return;",
  "  }",
  "",
  "  // Multiplas partidas: envia botoes",
  "  var btns = partidas.slice(0, 3).map(function(p) {",
  "    var data = new Date(p.data_partida);",
  "    var dataStr = String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0');",
  "    return { id: 'lista_' + p.id, title: (p.grupo_nome + ' ' + dataStr).slice(0, 20) };",
  "  });",
  "  await client.sendButtons(message.from, 'Qual jogo voc\u00ea quer ver?', btns);",
  "}",
  "",
  "module.exports = { lista };"
].join('\n');

fs.writeFileSync(listaPath, listaContent);
console.log('[OK] lista.js reescrito (busca via grupo_jogadores OU presencas)');

console.log('\n=== Limpeza de registros duplicados ===');
console.log('Rode este SQL para ver duplicatas:');
console.log("  sudo mysql appfut -e \"SELECT id, whatsapp_id, nome FROM jogadores WHERE nome IN (SELECT nome FROM jogadores GROUP BY nome HAVING COUNT(*) > 1) ORDER BY nome, id;\"");
console.log('\nDepois: pm2 restart appfut-meta --update-env');
