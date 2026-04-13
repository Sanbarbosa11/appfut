/**
 * deploy_scheduler_producao.js
 *
 * Volta MODO_TESTE = false no scheduler.js apos validacao.
 * Lembretes voltam para horarios reais (9h, 1h antes).
 */

var fs = require('fs');
var BASE = '/home/appfutadmin/appfut';

var schedulerPath = BASE + '/src/bot/scheduler.js';
var schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

if (schedulerContent.includes('MODO_TESTE = true')) {
  schedulerContent = schedulerContent.replace('MODO_TESTE = true', 'MODO_TESTE = false');
  fs.writeFileSync(schedulerPath, schedulerContent);
  console.log('[OK] scheduler.js - MODO_TESTE = false (producao)');
} else {
  console.log('[SKIP] scheduler.js - MODO_TESTE ja era false');
}

console.log('\nReinicie: pm2 restart appfut-meta --update-env');
