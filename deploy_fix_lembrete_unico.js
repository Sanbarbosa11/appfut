/**
 * deploy_fix_lembrete_unico.js
 *
 * Unifica lembrete em UMA mensagem so:
 * Em vez de sendText() + sendButtons() separados,
 * usa sendButtons() com o texto completo no body.
 * Resultado: uma unica mensagem com texto + botoes.
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';
var schedulerPath = BASE + '/src/bot/scheduler.js';
var content = fs.readFileSync(schedulerPath, 'utf8');

// Substitui: sendText(msg) + delay + sendButtons(titulo curto, botoes)
// Por: sendButtons(msg completo, botoes) — mensagem unica
var oldBloco = [
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

var newBloco = [
  "      // Envia lembrete com botoes em mensagem unica",
  "      await clientRef.sendButtons(",
  "        jogador.whatsapp_id,",
  "        msg,",
  "        [",
  "          { id: 'confirmar_' + partida.id, title: 'Confirmar presen\u00e7a' },",
  "          { id: 'ausente_' + partida.id,   title: 'Estarei ausente'    }",
  "        ]",
  "      );"
].join('\n');

if (content.includes(oldBloco)) {
  content = content.replace(oldBloco, newBloco);
  console.log('[OK] Lembrete unificado em mensagem unica');
} else {
  // Fallback: regex
  content = content.replace(
    /\/\/ Envia texto do lembrete[\s\S]*?\/\/ Envia botoes de confirmacao com IDs da partida\s*await clientRef\.sendButtons\(\s*jogador\.whatsapp_id,\s*'[^']*',\s*\[\s*\{[^}]*confirmar_[^}]*\}[^}]*\}[^}]*\}\s*\]\s*\);/,
    [
      "// Envia lembrete com botoes em mensagem unica",
      "      await clientRef.sendButtons(",
      "        jogador.whatsapp_id,",
      "        msg,",
      "        [",
      "          { id: 'confirmar_' + partida.id, title: 'Confirmar presen\u00e7a' },",
      "          { id: 'ausente_' + partida.id,   title: 'Estarei ausente'    }",
      "        ]",
      "      );"
    ].join('\n      ')
  );
  if (content.includes("Envia lembrete com botoes em mensagem unica")) {
    console.log('[OK] Lembrete unificado (fallback regex)');
  } else {
    console.log('[ERRO] Nao foi possivel aplicar o patch — verifique manualmente');
  }
}

fs.writeFileSync(schedulerPath, content);
console.log('[OK] scheduler.js salvo');
console.log('\nReinicie: pm2 restart appfut-meta --update-env');
