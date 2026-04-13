/**
 * deploy_scheduler_botoes.js
 *
 * Corrige o scheduler.js para usar sendButtons com IDs corretos:
 *   confirmar_PARTIDAID  →  onPollResponse captura e chama confirmarPartida()
 *   ausente_PARTIDAID    →  onPollResponse captura e chama cancelarPartida()
 *
 * Tambem garante MODO_TESTE = true e NUMERO_TESTE configurado.
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';
var schedulerPath = BASE + '/src/bot/scheduler.js';
var content = fs.readFileSync(schedulerPath, 'utf8');

// ---- 1. Garante MODO_TESTE = true ----
if (content.includes('MODO_TESTE = false')) {
  content = content.replace('MODO_TESTE = false', 'MODO_TESTE = true');
  console.log('[OK] MODO_TESTE = true');
} else {
  console.log('[SKIP] MODO_TESTE ja era true');
}

// ---- 2. Garante NUMERO_TESTE ----
if (!content.includes('NUMERO_TESTE')) {
  content = content.replace(
    /var MODO_TESTE = (true|false);/,
    'var MODO_TESTE = true;\nvar NUMERO_TESTE = \'5511963456139@c.us\'; // filtro de teste'
  );
  console.log('[OK] NUMERO_TESTE adicionado');
} else {
  console.log('[SKIP] NUMERO_TESTE ja existe');
}

// ---- 3. Adiciona filtro de NUMERO_TESTE no loop (se nao existe) ----
if (!content.includes('MODO_TESTE && jogador.whatsapp_id !== NUMERO_TESTE')) {
  content = content.replace(
    "if (jogador.whatsapp_id.startsWith('fake')) {",
    "if (MODO_TESTE && jogador.whatsapp_id !== NUMERO_TESTE) {\n      await db.execute('INSERT IGNORE INTO lembretes_enviados (partida_id, jogador_id, tipo) VALUES (?, ?, ?)', [partida.id, jogador.id, tipo]);\n      continue;\n    }\n    if (jogador.whatsapp_id.startsWith('fake')) {"
  );
  console.log('[OK] filtro NUMERO_TESTE aplicado');
} else {
  console.log('[SKIP] filtro NUMERO_TESTE ja existe');
}

// ---- 4. Substitui sendPollMessage por sendButtons com IDs corretos ----
var oldEnvio = [
  "      // Envia texto do lembrete",
  "      await clientRef.sendText(jogador.whatsapp_id, msg);",
  "",
  "      // Delay antes da enquete",
  "      await new Promise(function(r) { setTimeout(r, 1500); });",
  "",
  "      // Envia enquete de confirmacao",
  "      await clientRef.sendPollMessage(",
  "        jogador.whatsapp_id,",
  "        'Confirmar presenca no proximo jogo?',",
  "        ['Confirmar presenca', 'Agora nao'],",
  "        { selectableCount: 1 }",
  "      );"
].join('\n');

var newEnvio = [
  "      // Envia texto do lembrete",
  "      await clientRef.sendText(jogador.whatsapp_id, msg);",
  "",
  "      // Delay antes dos botoes",
  "      await new Promise(function(r) { setTimeout(r, 1500); });",
  "",
  "      // Envia botoes de confirmacao com IDs da partida",
  "      await clientRef.sendButtons(",
  "        jogador.whatsapp_id,",
  "        'Vai jogar? Confirma abaixo \u26bd',",
  "        [",
  "          { id: 'confirmar_' + partida.id, title: 'Confirmar presen\u00e7a' },",
  "          { id: 'ausente_' + partida.id,   title: 'Estarei ausente'    }",
  "        ]",
  "      );"
].join('\n');

if (content.includes("await clientRef.sendPollMessage(")) {
  content = content.replace(oldEnvio, newEnvio);
  if (content.includes("await clientRef.sendPollMessage(")) {
    // fallback: substituicao simples
    content = content.replace(
      /\/\/ Envia enquete de confirmacao[\s\S]*?selectableCount: 1[\s\S]*?\);/,
      [
        "// Envia botoes de confirmacao com IDs da partida",
        "      await clientRef.sendButtons(",
        "        jogador.whatsapp_id,",
        "        'Vai jogar? Confirma abaixo \u26bd',",
        "        [",
        "          { id: 'confirmar_' + partida.id, title: 'Confirmar presen\u00e7a' },",
        "          { id: 'ausente_' + partida.id,   title: 'Estarei ausente'    }",
        "        ]",
        "      );"
      ].join('\n      ')
    );
  }
  if (!content.includes("await clientRef.sendPollMessage(")) {
    console.log('[OK] sendPollMessage substituido por sendButtons com IDs');
  } else {
    console.log('[ERRO] nao foi possivel substituir sendPollMessage — verifique manualmente');
  }
} else {
  console.log('[SKIP] sendPollMessage nao encontrado (ja foi substituido?)');
}

fs.writeFileSync(schedulerPath, content);
console.log('[OK] scheduler.js salvo');
console.log('\nReinicie: pm2 restart appfut-meta --update-env');
