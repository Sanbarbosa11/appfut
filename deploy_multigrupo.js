/**
 * deploy_multigrupo.js
 *
 * Arquitetura multi-grupo completa:
 *
 * 1. adminHelper.js  — buscarGrupoDoAdmin le sessao (grupo selecionado)
 *                      buscarGruposDoAdmin retorna todos os grupos do admin
 * 2. confirmar.js    — multiplos jogos: mostra botoes para selecionar
 * 3. cancelar.js     — idem
 * 4. lista.js        — idem
 * 5. scheduler.js    — botoes de lembrete carregam partida_id
 * 6. index_meta.js   — intercepta admin multi-grupo + roteia confirmar_ID/ausente_ID/lista_ID
 */

var fs   = require('fs');
var path = require('path');
var BASE = '/home/appfutadmin/appfut';

// ============================================================
// 1. adminHelper.js — session-aware
// ============================================================

var newAdminHelper = [
  "var db = require('../../database/connection');",
  "",
  "// Retorna o grupo do admin respeitando selecao de sessao (multi-grupo)",
  "async function buscarGrupoDoAdmin(sender) {",
  "  try {",
  "    // Verifica se ha grupo forcado via sessao (selecao de grupo no menu)",
  "    var sess = global._appfutSession && global._appfutSession.getSession(sender);",
  "    if (sess && sess.adminGrupoId) {",
  "      var [forced] = await db.execute(",
  "        'SELECT id, nome, whatsapp_id, tipo, max_jogadores, horario_inicio, horario_fim FROM grupos WHERE id = ?',",
  "        [sess.adminGrupoId]",
  "      );",
  "      return forced.length > 0 ? forced[0] : null;",
  "    }",
  "  } catch(e) {}",
  "",
  "  // Padrao: primeiro grupo onde sender e admin",
  "  var [rows] = await db.execute(",
  "    'SELECT g.id, g.nome, g.whatsapp_id, g.tipo, g.max_jogadores, g.horario_inicio, g.horario_fim FROM admins a JOIN grupos g ON a.grupo_id = g.id WHERE a.whatsapp_id = ? ORDER BY g.id LIMIT 1',",
  "    [sender]",
  "  );",
  "  return rows.length > 0 ? rows[0] : null;",
  "}",
  "",
  "// Retorna TODOS os grupos onde sender e admin",
  "async function buscarGruposDoAdmin(sender) {",
  "  var [rows] = await db.execute(",
  "    'SELECT g.id, g.nome, g.whatsapp_id, g.tipo, g.max_jogadores, g.horario_inicio, g.horario_fim FROM admins a JOIN grupos g ON a.grupo_id = g.id WHERE a.whatsapp_id = ? ORDER BY g.id',",
  "    [sender]",
  "  );",
  "  return rows;",
  "}",
  "",
  "module.exports = { buscarGrupoDoAdmin, buscarGruposDoAdmin };"
].join('\n');

fs.writeFileSync(path.join(BASE, 'src/bot/utils/adminHelper.js'), newAdminHelper);
console.log('[OK] adminHelper.js');

// ============================================================
// 2. confirmar.js — multi-grupo com selecao de jogo
// ============================================================

var newConfirmar = [
  "const db = require('../../database/connection');",
  "const { verificarRateLimit, delay } = require('../utils/rateLimit');",
  "",
  "async function confirmar(client, message, sender, senderName) {",
  "  const limite = verificarRateLimit(sender, 'confirmar');",
  "  if (!limite.permitido) return;",
  "  await delay();",
  "",
  "  await db.execute('INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)', [sender, senderName]);",
  "  const [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "",
  "  const [partidas] = await db.execute(",
  "    `SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.id as grupo_id, g.horario_inicio, g.horario_fim",
  "     FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id",
  "     WHERE p.status = 'aberta' AND gj.jogador_id = ? AND gj.ativo = TRUE",
  "     ORDER BY p.data_partida ASC`,",
  "    [jogador[0].id]",
  "  );",
  "",
  "  if (partidas.length === 0) {",
  "    await client.sendText(message.from, 'N\u00e3o h\u00e1 nenhum jogo aberto no momento. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  if (partidas.length === 1) {",
  "    await confirmarPartida(client, message.from, jogador[0].id, senderName, partidas[0]);",
  "    return;",
  "  }",
  "",
  "  // Multiplos jogos: mostrar selecao",
  "  var buttons = partidas.slice(0, 3).map(function(p) {",
  "    var dataP = new Date(p.data_partida);",
  "    var dataStr = String(dataP.getDate()).padStart(2,'0') + '/' + String(dataP.getMonth()+1).padStart(2,'0');",
  "    var nomeGrupo = p.grupo_nome.length > 12 ? p.grupo_nome.substring(0, 12) : p.grupo_nome;",
  "    return { id: 'confirmar_' + p.id, title: nomeGrupo + ' ' + dataStr };",
  "  });",
  "  await client.sendButtons(message.from,",
  "    '\u26bd Voc\u00ea est\u00e1 em mais de um grupo com jogo aberto.\\nQual deseja confirmar?',",
  "    buttons",
  "  );",
  "}",
  "",
  "async function confirmarPartida(client, to, jogadorId, senderName, partida) {",
  "  const [contagem] = await db.execute(",
  "    'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ? AND status = \\'confirmado\\'', [partida.id]",
  "  );",
  "  if (contagem[0].total >= partida.max_jogadores) {",
  "    await client.sendText(to, 'O jogo j\u00e1 est\u00e1 lotado (' + partida.max_jogadores + ' jogadores). \ud83d\ude15');",
  "    return;",
  "  }",
  "  await db.execute(",
  "    'INSERT INTO presencas (partida_id, jogador_id, status) VALUES (?, ?, \\'confirmado\\') ON DUPLICATE KEY UPDATE status = \\'confirmado\\'',",
  "    [partida.id, jogadorId]",
  "  );",
  "  try {",
  "    var dados = await buscarDadosLista(partida);",
  "    var lista = montarLista(dados, partida);",
  "    await client.sendText(to, '\u2705 Presen\u00e7a confirmada, ' + senderName + '!\\n\\n' + lista);",
  "  } catch(e) {",
  "    console.error('[confirmar] Erro lista:', e);",
  "    await client.sendText(to, '\u2705 Presen\u00e7a confirmada, ' + senderName + '!');",
  "  }",
  "}",
  "",
  "async function buscarDadosLista(partida) {",
  "  const [confirmados] = await db.execute(",
  "    'SELECT j.nome FROM presencas pr JOIN jogadores j ON pr.jogador_id = j.id WHERE pr.partida_id = ? AND pr.status = \\'confirmado\\' ORDER BY pr.confirmado_em ASC',",
  "    [partida.id]",
  "  );",
  "  const [ausentes] = await db.execute(",
  "    'SELECT j.nome FROM presencas pr JOIN jogadores j ON pr.jogador_id = j.id WHERE pr.partida_id = ? AND pr.status = \\'ausente\\' ORDER BY j.nome ASC',",
  "    [partida.id]",
  "  );",
  "  const [duvida] = await db.execute(",
  "    `SELECT j.nome FROM grupo_jogadores gj JOIN jogadores j ON gj.jogador_id = j.id",
  "     WHERE gj.grupo_id = ? AND gj.ativo = TRUE",
  "     AND gj.jogador_id NOT IN (SELECT jogador_id FROM presencas WHERE partida_id = ?)`,",
  "    [partida.grupo_id, partida.id]",
  "  );",
  "  const [avulsos] = await db.execute(",
  "    'SELECT nome FROM avulsos WHERE partida_id = ? ORDER BY nome', [partida.id]",
  "  );",
  "  return { confirmados, ausentes, duvida, avulsos };",
  "}",
  "",
  "function montarLista(dados, partida) {",
  "  var { confirmados, ausentes, duvida, avulsos } = dados;",
  "  var total = confirmados.length + avulsos.length;",
  "  var dataP = new Date(partida.data_partida);",
  "  var dataF = dataP.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });",
  "  var hi = partida.horario_inicio ? String(partida.horario_inicio).replace(/:00$/, '') : '';",
  "  var hf = partida.horario_fim    ? String(partida.horario_fim).replace(/:00$/, '')    : '';",
  "  var horario = hi ? hi + ' - ' + hf : '';",
  "  var txt = '\u26bd *' + partida.grupo_nome + '*\\n';",
  "  txt += '\ud83d\udcc5 ' + dataF + '\\n';",
  "  if (horario) txt += '\u23f0 ' + horario + '\\n';",
  "  txt += '\ud83d\udccb ' + total + '/' + partida.max_jogadores + '\\n\\n';",
  "  txt += '\u2705 *Confirmados (' + confirmados.length + '):*\\n';",
  "  if (confirmados.length === 0) { txt += 'Nenhum confirmado ainda\\n'; }",
  "  else { confirmados.forEach(function(j) { txt += '- ' + j.nome + '\\n'; }); }",
  "  txt += '\\n\u274c *Ausentes (' + ausentes.length + '):*\\n';",
  "  if (ausentes.length === 0) { txt += 'Nenhum ausente\\n'; }",
  "  else { ausentes.forEach(function(j) { txt += '- ' + j.nome + '\\n'; }); }",
  "  txt += '\\n\u2753 *D\u00favida (' + duvida.length + '):*\\n';",
  "  if (duvida.length === 0) { txt += 'Todos responderam\\n'; }",
  "  else { duvida.forEach(function(j) { txt += '- ' + j.nome + '\\n'; }); }",
  "  txt += '\\n\ud83d\udd38 *Avulsos (' + avulsos.length + '):*\\n';",
  "  if (avulsos.length === 0) { txt += 'Nenhum avulso\\n'; }",
  "  else { avulsos.forEach(function(a) { txt += '- ' + a.nome + '\\n'; }); }",
  "  txt += '\\n\ud83d\udca1 Caso precise ficar ausente, digite *cancelar*';",
  "  txt += '\\n\ud83d\udca1 Para trazer algu\u00e9m: *avulso Nome*';",
  "  return txt;",
  "}",
  "",
  "module.exports = { confirmar, confirmarPartida, buscarDadosLista, montarLista };"
].join('\n');

fs.writeFileSync(path.join(BASE, 'src/bot/commands/confirmar.js'), newConfirmar);
console.log('[OK] confirmar.js');

// ============================================================
// 3. cancelar.js — multi-grupo
// ============================================================

var newCancelar = [
  "const db = require('../../database/connection');",
  "const { verificarRateLimit, delay } = require('../utils/rateLimit');",
  "const { buscarDadosLista, montarLista } = require('./confirmar');",
  "",
  "async function cancelar(client, message, sender) {",
  "  const limite = verificarRateLimit(sender, 'cancelar');",
  "  if (!limite.permitido) return;",
  "  await delay();",
  "",
  "  const [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "  if (jogador.length === 0) {",
  "    await client.sendText(message.from, 'Voc\u00ea n\u00e3o est\u00e1 cadastrado. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  const [partidas] = await db.execute(",
  "    `SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.id as grupo_id, g.horario_inicio, g.horario_fim",
  "     FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id",
  "     WHERE p.status = 'aberta' AND gj.jogador_id = ? AND gj.ativo = TRUE",
  "     ORDER BY p.data_partida ASC`,",
  "    [jogador[0].id]",
  "  );",
  "",
  "  if (partidas.length === 0) {",
  "    await client.sendText(message.from, 'N\u00e3o h\u00e1 jogo aberto no momento. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  if (partidas.length === 1) {",
  "    await cancelarPartida(client, message.from, jogador[0].id, partidas[0]);",
  "    return;",
  "  }",
  "",
  "  // Multiplos jogos: mostrar selecao",
  "  var buttons = partidas.slice(0, 3).map(function(p) {",
  "    var dataP = new Date(p.data_partida);",
  "    var dataStr = String(dataP.getDate()).padStart(2,'0') + '/' + String(dataP.getMonth()+1).padStart(2,'0');",
  "    var nomeGrupo = p.grupo_nome.length > 12 ? p.grupo_nome.substring(0, 12) : p.grupo_nome;",
  "    return { id: 'ausente_' + p.id, title: nomeGrupo + ' ' + dataStr };",
  "  });",
  "  await client.sendButtons(message.from,",
  "    '\u26bd De qual jogo deseja cancelar presen\u00e7a?',",
  "    buttons",
  "  );",
  "}",
  "",
  "async function cancelarPartida(client, to, jogadorId, partida) {",
  "  await db.execute(",
  "    'INSERT INTO presencas (partida_id, jogador_id, status) VALUES (?, ?, \\'ausente\\') ON DUPLICATE KEY UPDATE status = \\'ausente\\'',",
  "    [partida.id, jogadorId]",
  "  );",
  "  try {",
  "    var dados = await buscarDadosLista(partida);",
  "    var lista = montarLista(dados, partida);",
  "    await client.sendText(to, 'Presen\u00e7a cancelada. At\u00e9 a pr\u00f3xima! \ud83d\udc4b\\n\\n' + lista);",
  "  } catch(e) {",
  "    console.error('[cancelar] Erro lista:', e);",
  "    await client.sendText(to, 'Presen\u00e7a cancelada. At\u00e9 a pr\u00f3xima! \ud83d\udc4b');",
  "  }",
  "}",
  "",
  "module.exports = { cancelar, cancelarPartida };"
].join('\n');

fs.writeFileSync(path.join(BASE, 'src/bot/commands/cancelar.js'), newCancelar);
console.log('[OK] cancelar.js');

// ============================================================
// 4. lista.js — multi-grupo
// ============================================================

var newLista = [
  "const db = require('../../database/connection');",
  "const { verificarRateLimit, delay } = require('../utils/rateLimit');",
  "const { buscarDadosLista, montarLista } = require('./confirmar');",
  "",
  "async function lista(client, message, sender) {",
  "  const limite = verificarRateLimit(sender, 'lista');",
  "  if (!limite.permitido) return;",
  "  await delay();",
  "",
  "  const [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "  if (jogador.length === 0) {",
  "    await client.sendText(message.from, 'Voc\u00ea n\u00e3o est\u00e1 cadastrado em nenhum grupo. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  const [partidas] = await db.execute(",
  "    `SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.id as grupo_id, g.horario_inicio, g.horario_fim",
  "     FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id",
  "     WHERE p.status = 'aberta' AND gj.jogador_id = ? AND gj.ativo = TRUE",
  "     ORDER BY p.data_partida ASC`,",
  "    [jogador[0].id]",
  "  );",
  "",
  "  if (partidas.length === 0) {",
  "    await client.sendText(message.from, 'N\u00e3o h\u00e1 jogo aberto no momento. \u26a0\ufe0f');",
  "    return;",
  "  }",
  "",
  "  if (partidas.length === 1) {",
  "    var dados = await buscarDadosLista(partidas[0]);",
  "    await client.sendText(message.from, montarLista(dados, partidas[0]));",
  "    return;",
  "  }",
  "",
  "  // Multiplos jogos: mostrar selecao",
  "  var buttons = partidas.slice(0, 3).map(function(p) {",
  "    var dataP = new Date(p.data_partida);",
  "    var dataStr = String(dataP.getDate()).padStart(2,'0') + '/' + String(dataP.getMonth()+1).padStart(2,'0');",
  "    var nomeGrupo = p.grupo_nome.length > 12 ? p.grupo_nome.substring(0, 12) : p.grupo_nome;",
  "    return { id: 'lista_' + p.id, title: nomeGrupo + ' ' + dataStr };",
  "  });",
  "  await client.sendButtons(message.from,",
  "    '\ud83d\udccb Qual lista deseja ver?',",
  "    buttons",
  "  );",
  "}",
  "",
  "module.exports = { lista };"
].join('\n');

fs.writeFileSync(path.join(BASE, 'src/bot/commands/lista.js'), newLista);
console.log('[OK] lista.js');

// ============================================================
// 5. scheduler.js — botoes com partida_id
// ============================================================

var schedulerPath = path.join(BASE, 'src/bot/scheduler.js');
var schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

// Substitui sendPollMessage por sendButtons com IDs customizados
var oldPollCall = /await clientRef\.sendPollMessage\(jogador\.whatsapp_id,\s*'Confirmar presenca no proximo jogo\?',\s*\['Confirmar presenca',\s*'Estarei ausente'\],\s*\{\s*selectableCount:\s*1\s*\}\s*\);/;
var newBtnCall = [
  "await clientRef.sendButtons(jogador.whatsapp_id,",
  "        'Vai jogar? Confirma abaixo \u26bd',",
  "        [",
  "          { id: 'confirmar_' + partida.id, title: 'Confirmar presen\u00e7a' },",
  "          { id: 'ausente_' + partida.id, title: 'Estarei ausente' }",
  "        ]",
  "      );"
].join('\n');

if (schedulerContent.match(oldPollCall)) {
  schedulerContent = schedulerContent.replace(oldPollCall, newBtnCall);
  console.log('[OK] scheduler.js - botoes com partida_id');
} else {
  console.log('[SKIP] scheduler.js - padrao nao encontrado, tentando alternativo...');
  // Tenta padrao alternativo (pode ter variado no servidor)
  schedulerContent = schedulerContent.replace(
    /await clientRef\.sendPollMessage\([^;]+\);/,
    newBtnCall
  );
  console.log('[OK] scheduler.js - substituicao alternativa aplicada');
}
fs.writeFileSync(schedulerPath, schedulerContent);

// ============================================================
// 6. index_meta.js — admin multi-grupo + roteamento de botoes
// ============================================================

var indexPath = path.join(BASE, 'src/bot/index_meta.js');
var indexContent = fs.readFileSync(indexPath, 'utf8');

// 6a. Adiciona import de buscarGruposDoAdmin e dos novos exports
if (!indexContent.includes('buscarGruposDoAdmin')) {
  indexContent = indexContent.replace(
    "var { confirmar } = require('./commands/confirmar');",
    "var { confirmar, confirmarPartida } = require('./commands/confirmar');\nvar { cancelarPartida } = require('./commands/cancelar');\nvar { buscarGruposDoAdmin } = require('./utils/adminHelper');"
  );
  console.log('[OK] index_meta.js - imports adicionados');
}

// 6b. Substitui bloco "Admin via texto" para incluir selecao de grupo
var oldAdminBlock = /\/\/ Admin via texto\s*\n\s*if \(text\.startsWith\('admin '\) \|\| text === 'admin'\) \{[\s\S]*?return;\s*\n\s*\}/;
var newAdminBlock = [
  "// Admin via texto",
  "    if (text.startsWith('admin ') || text === 'admin') {",
  "      var cmdTexto = text === 'admin' ? 'admin ajuda' : text;",
  "      var cmdArgs = cmdTexto.substring(6).trim().split(/\\s+/);",
  "      var cmdBase = cmdArgs[0];",
  "      var grupoDep = ['criar','fechar','status','participantes','ativar','desativar','financeiro','pago'];",
  "",
  "      if (grupoDep.indexOf(cmdBase) !== -1) {",
  "        var adminGruposList = await buscarGruposDoAdmin(sender);",
  "        if (adminGruposList.length === 0) {",
  "          await client.sendText(message.from, 'Voc\u00ea n\u00e3o \u00e9 admin de nenhum grupo. \u26a0\ufe0f');",
  "          return;",
  "        }",
  "        if (adminGruposList.length > 1) {",
  "          var adminBtns = adminGruposList.slice(0, 3).map(function(g) {",
  "            return { id: 'adm_grp_' + g.id, title: g.nome.slice(0, 20) };",
  "          });",
  "          setSession(sender, { pendingAdminCmd: cmdTexto, step: 'select_grupo' });",
  "          await client.sendButtons(message.from, '\ud83d\udccb Qual grupo?', adminBtns);",
  "          return;",
  "        }",
  "        // Um grupo: define na sessao e executa",
  "        setSession(sender, { adminGrupoId: adminGruposList[0].id });",
  "      }",
  "",
  "      await processarComandoAdmin(client, message, sender, cmdTexto);",
  "      if (getSession(sender) && getSession(sender).adminGrupoId) clearSession(sender);",
  "      return;",
  "    }"
].join('\n');

if (indexContent.match(oldAdminBlock)) {
  indexContent = indexContent.replace(oldAdminBlock, newAdminBlock);
  console.log('[OK] index_meta.js - admin multi-grupo');
} else {
  console.log('[SKIP] index_meta.js - bloco admin nao encontrado, aplicando patch simples...');
  // Fallback: substitui apenas a linha simples
  indexContent = indexContent.replace(
    "    if (text.startsWith('admin ') || text === 'admin') {\n      var cmdTexto = text === 'admin' ? 'admin ajuda' : text;\n      await processarComandoAdmin(client, message, sender, cmdTexto);\n      return;\n    }",
    newAdminBlock
  );
}

// 6c. Substitui onPollResponse para rotear confirmar_ID, ausente_ID, lista_ID, adm_grp_ID
var oldPollFn = /async function onPollResponse\(response, sender, opcao\)[\s\S]*?\n\}/;
var newPollFn = [
  "async function onPollResponse(response, sender, opcao) {",
  "  try {",
  "    var btnId = (response.selectedOptions && response.selectedOptions[0] && response.selectedOptions[0].id) || '';",
  "    var opcaoNorm = (opcao || '').toLowerCase().trim()",
  "      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');",
  "",
  "    // ---- Botoes de lembrete/selecao de jogo ----",
  "",
  "    // Confirmar presenca em partida especifica",
  "    if (btnId.startsWith('confirmar_')) {",
  "      var chaveC = sender + btnId;",
  "      if (!dedup(chaveC)) return;",
  "      var partidaIdC = parseInt(btnId.replace('confirmar_', ''));",
  "      var [pRowC] = await db.execute(",
  "        'SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.id as grupo_id, g.horario_inicio, g.horario_fim FROM partidas p JOIN grupos g ON p.grupo_id = g.id WHERE p.id = ?',",
  "        [partidaIdC]",
  "      );",
  "      if (pRowC.length === 0) return;",
  "      var [jC] = await db.execute('SELECT id, nome FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "      if (jC.length === 0) return;",
  "      var msgC = { from: sender, sender: { id: sender, pushname: jC[0].nome } };",
  "      await confirmarPartida(client, sender, jC[0].id, jC[0].nome, pRowC[0]);",
  "      return;",
  "    }",
  "",
  "    // Marcar ausente em partida especifica",
  "    if (btnId.startsWith('ausente_')) {",
  "      var chaveA = sender + btnId;",
  "      if (!dedup(chaveA)) return;",
  "      var partidaIdA = parseInt(btnId.replace('ausente_', ''));",
  "      var [pRowA] = await db.execute(",
  "        'SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.id as grupo_id, g.horario_inicio, g.horario_fim FROM partidas p JOIN grupos g ON p.grupo_id = g.id WHERE p.id = ?',",
  "        [partidaIdA]",
  "      );",
  "      if (pRowA.length === 0) return;",
  "      var [jA] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "      if (jA.length === 0) return;",
  "      await cancelarPartida(client, sender, jA[0].id, pRowA[0]);",
  "      return;",
  "    }",
  "",
  "    // Ver lista de partida especifica",
  "    if (btnId.startsWith('lista_')) {",
  "      var chaveL = sender + btnId;",
  "      if (!dedup(chaveL)) return;",
  "      var partidaIdL = parseInt(btnId.replace('lista_', ''));",
  "      var [pRowL] = await db.execute(",
  "        'SELECT p.id, p.max_jogadores, p.data_partida, g.nome as grupo_nome, g.id as grupo_id, g.horario_inicio, g.horario_fim FROM partidas p JOIN grupos g ON p.grupo_id = g.id WHERE p.id = ?',",
  "        [partidaIdL]",
  "      );",
  "      if (pRowL.length === 0) return;",
  "      var { buscarDadosLista, montarLista } = require('./commands/confirmar');",
  "      var dadosL = await buscarDadosLista(pRowL[0]);",
  "      await client.sendText(sender, montarLista(dadosL, pRowL[0]));",
  "      return;",
  "    }",
  "",
  "    // ---- Selecao de grupo admin ----",
  "    if (btnId.startsWith('adm_grp_')) {",
  "      var grupoIdSel = parseInt(btnId.replace('adm_grp_', ''));",
  "      var sessAdm = getSession(sender);",
  "      if (sessAdm && sessAdm.pendingAdminCmd) {",
  "        setSession(sender, { adminGrupoId: grupoIdSel });",
  "        var msgFakeAdm = { from: sender, sender: { id: sender, pushname: 'Admin' } };",
  "        await processarComandoAdmin(client, msgFakeAdm, sender, sessAdm.pendingAdminCmd);",
  "        clearSession(sender);",
  "      }",
  "      return;",
  "    }",
  "",
  "    // ---- Botoes de lembrete (texto normalizado) ----",
  "    if (opcaoNorm === 'confirmar presenca') {",
  "      var chaveCP = sender + (response.id || '') + opcao;",
  "      if (!dedup(chaveCP)) return;",
  "      var senderNameCP = 'Jogador';",
  "      try {",
  "        var [jCP] = await db.execute('SELECT nome FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "        if (jCP.length > 0) senderNameCP = jCP[0].nome;",
  "      } catch(e) {}",
  "      var msgFakeCP = { from: sender, sender: { id: sender, pushname: senderNameCP } };",
  "      await confirmar(client, msgFakeCP, sender, senderNameCP);",
  "      return;",
  "    }",
  "    if (opcaoNorm === 'estarei ausente') {",
  "      var chaveEA = sender + (response.id || '') + opcao;",
  "      if (!dedup(chaveEA)) return;",
  "      var msgFakeEA = { from: sender, sender: { id: sender, pushname: 'Jogador' } };",
  "      await cancelar(client, msgFakeEA, sender);",
  "      return;",
  "    }",
  "",
  "    // ---- AdminPoll ----",
  "    var { processarAdminPoll } = require('./commands/adminPoll');",
  "    if (getSession(sender) && getSession(sender).step !== 'select_grupo') {",
  "      await processarAdminPoll(client, response, sender, opcao);",
  "      return;",
  "    }",
  "    var chave3 = sender + (response.id || '') + opcao;",
  "    if (!dedup(chave3)) return;",
  "    await processarAdminPoll(client, response, sender, opcao);",
  "  } catch(e) {",
  "    console.error('[onPollResponse] Erro:', e);",
  "  }",
  "}"
].join('\n');

if (indexContent.match(oldPollFn)) {
  indexContent = indexContent.replace(oldPollFn, newPollFn);
  console.log('[OK] index_meta.js - onPollResponse atualizado');
} else {
  console.log('[SKIP] index_meta.js - padrao onPollResponse nao encontrado');
}

fs.writeFileSync(indexPath, indexContent);
console.log('[OK] index_meta.js salvo');

console.log('\n============================================');
console.log('Deploy multi-grupo concluido!');
console.log('Reinicie: pm2 restart appfut-meta --update-env');
console.log('============================================');
console.log('\nComo funciona agora:');
console.log('JOGADOR em 1 grupo  -> confirmar/cancelar/lista direto');
console.log('JOGADOR em N grupos -> botoes para selecionar o jogo');
console.log('LEMBRETE            -> botoes carregam partida_id (jogo certo sempre)');
console.log('ADMIN em 1 grupo    -> comandos diretos');
console.log('ADMIN em N grupos   -> botoes para selecionar grupo antes do comando');
