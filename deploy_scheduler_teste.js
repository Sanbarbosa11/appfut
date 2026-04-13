/**
 * deploy_scheduler_teste.js
 *
 * 1. Corrige onPollResponse no index_meta.js:
 *    - Botao "Confirmar presenca" → chama confirmar()
 *    - Botao "Estarei ausente"    → chama cancelar()
 *    - Resto → adminPoll (comportamento atual)
 *
 * 2. Ativa MODO_TESTE = true no scheduler.js (lembretes a cada 3min)
 *    - Filtra: envia lembretes APENAS para NUMERO_TESTE (5511963456139)
 *
 * Apos testar, rode deploy_scheduler_producao.js para voltar MODO_TESTE = false
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';

// ============================================================
// PATCH 1: index_meta.js — onPollResponse
// ============================================================

var indexPath = BASE + '/src/bot/index_meta.js';
var indexContent = fs.readFileSync(indexPath, 'utf8');

var oldPollResponse = /async function onPollResponse\(response, sender, opcao\)[\s\S]*?\n\}/;

var newPollResponse = [
  "async function onPollResponse(response, sender, opcao) {",
  "  try {",
  "    // Normaliza opcao para comparacao",
  "    var opcaoNorm = (opcao || '').toLowerCase().trim()",
  "      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');",
  "",
  "    // Botoes do lembrete de rachao",
  "    if (opcaoNorm === 'confirmar presenca') {",
  "      var chave = sender + (response.id || '') + opcao;",
  "      if (!dedup(chave)) return;",
  "      // Busca nome do jogador no banco",
  "      var senderName = 'Jogador';",
  "      try {",
  "        var [jRow] = await db.execute('SELECT nome FROM jogadores WHERE whatsapp_id = ?', [sender]);",
  "        if (jRow.length > 0) senderName = jRow[0].nome;",
  "      } catch(e) {}",
  "      var msgFake = { from: sender, sender: { id: sender, pushname: senderName } };",
  "      await confirmar(client, msgFake, sender, senderName);",
  "      return;",
  "    }",
  "",
  "    if (opcaoNorm === 'estarei ausente') {",
  "      var chave2 = sender + (response.id || '') + opcao;",
  "      if (!dedup(chave2)) return;",
  "      var msgFake2 = { from: sender, sender: { id: sender, pushname: 'Jogador' } };",
  "      await cancelar(client, msgFake2, sender);",
  "      return;",
  "    }",
  "",
  "    // AdminPoll e outros",
  "    var { processarAdminPoll } = require('./commands/adminPoll');",
  "",
  "    if (getSession(sender)) {",
  "      await processarAdminPoll(client, response, sender, opcao);",
  "      return;",
  "    }",
  "",
  "    var chave3 = sender + (response.id || '') + opcao;",
  "    if (!dedup(chave3)) return;",
  "",
  "    await processarAdminPoll(client, response, sender, opcao);",
  "  } catch(e) {",
  "    console.error('[onPollResponse] Erro:', e);",
  "  }",
  "}"
].join('\n');

if (indexContent.match(oldPollResponse)) {
  indexContent = indexContent.replace(oldPollResponse, newPollResponse);
  fs.writeFileSync(indexPath, indexContent);
  console.log('[OK] index_meta.js - onPollResponse corrigido');
} else {
  console.log('[SKIP] index_meta.js - padrao nao encontrado');
}

// ============================================================
// PATCH 2: scheduler.js — MODO_TESTE = true + NUMERO_TESTE
// ============================================================

var schedulerPath = BASE + '/src/bot/scheduler.js';
var schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

// Ativa MODO_TESTE
if (schedulerContent.includes('MODO_TESTE = false')) {
  schedulerContent = schedulerContent.replace('MODO_TESTE = false', 'MODO_TESTE = true');
  console.log('[OK] scheduler.js - MODO_TESTE = true');
} else {
  console.log('[SKIP] scheduler.js - MODO_TESTE ja era true');
}

// Adiciona NUMERO_TESTE logo apos MODO_TESTE (se ainda nao existe)
if (!schedulerContent.includes('NUMERO_TESTE')) {
  schedulerContent = schedulerContent.replace(
    /var MODO_TESTE = (true|false);/,
    'var MODO_TESTE = true;\nvar NUMERO_TESTE = \'5511963456139@c.us\'; // filtro de teste'
  );
  console.log('[OK] scheduler.js - NUMERO_TESTE adicionado');
}

// Adiciona filtro no loop de envio de lembretes
// Filtra para enviar so para NUMERO_TESTE quando MODO_TESTE = true
if (!schedulerContent.includes('MODO_TESTE && jogador.whatsapp_id !== NUMERO_TESTE')) {
  schedulerContent = schedulerContent.replace(
    "if (jogador.whatsapp_id.startsWith('fake')) {",
    "if (MODO_TESTE && jogador.whatsapp_id !== NUMERO_TESTE) {\n      // Modo teste: pula quem nao e o numero de teste\n      await db.execute('INSERT IGNORE INTO lembretes_enviados (partida_id, jogador_id, tipo) VALUES (?, ?, ?)', [partida.id, jogador.id, tipo]);\n      continue;\n    }\n    if (jogador.whatsapp_id.startsWith('fake')) {"
  );
  console.log('[OK] scheduler.js - filtro NUMERO_TESTE aplicado no loop');
} else {
  console.log('[SKIP] scheduler.js - filtro ja aplicado');
}

fs.writeFileSync(schedulerPath, schedulerContent);

console.log('\nReinicie: pm2 restart appfut-meta --update-env');
console.log('\nNo modo teste:');
console.log('  - Lembretes disparados a cada 3 minutos');
console.log('  - Envio apenas para: 5511963456139');
console.log('\nPara desativar modo teste apos validar:');
console.log('  node deploy_scheduler_producao.js && pm2 restart appfut-meta --update-env');
