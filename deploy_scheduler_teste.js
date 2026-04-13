/**
 * deploy_scheduler_teste.js
 *
 * 1. Corrige onPollResponse no index_meta.js:
 *    - Botao "Confirmar presenca" → chama confirmar()
 *    - Botao "Estarei ausente"    → chama cancelar()
 *    - Resto → adminPoll (comportamento atual)
 *
 * 2. Ativa MODO_TESTE = true no scheduler.js (lembretes a cada 3min)
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
// PATCH 2: scheduler.js — MODO_TESTE = true
// ============================================================

var schedulerPath = BASE + '/src/bot/scheduler.js';
var schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

if (schedulerContent.includes('MODO_TESTE = false')) {
  schedulerContent = schedulerContent.replace('MODO_TESTE = false', 'MODO_TESTE = true');
  fs.writeFileSync(schedulerPath, schedulerContent);
  console.log('[OK] scheduler.js - MODO_TESTE = true (lembretes a cada 3min)');
} else if (schedulerContent.includes('MODO_TESTE = true')) {
  console.log('[SKIP] scheduler.js - MODO_TESTE ja era true');
} else {
  console.log('[SKIP] scheduler.js - flag MODO_TESTE nao encontrada');
}

console.log('\nReinicie: pm2 restart appfut-meta --update-env');
console.log('\nPara desativar modo teste apos validar:');
console.log('  node deploy_scheduler_producao.js && pm2 restart appfut-meta --update-env');
