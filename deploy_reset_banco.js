/**
 * deploy_reset_banco.js
 *
 * Limpa TODOS os dados do banco mantendo a estrutura das tabelas.
 * Use antes de iniciar testes com grupo real.
 */

var { execSync } = require('child_process');

var sql = [
  "SET FOREIGN_KEY_CHECKS = 0;",
  "TRUNCATE TABLE lembretes_enviados;",
  "TRUNCATE TABLE avulsos;",
  "TRUNCATE TABLE presencas;",
  "TRUNCATE TABLE partidas;",
  "TRUNCATE TABLE grupo_jogadores;",
  "TRUNCATE TABLE admins;",
  "TRUNCATE TABLE jogadores;",
  "TRUNCATE TABLE grupos;",
  "SET FOREIGN_KEY_CHECKS = 1;"
].join('\n');

require('fs').writeFileSync('/tmp/reset_banco.sql', sql);

try {
  execSync('sudo mysql appfut < /tmp/reset_banco.sql');
  console.log('[OK] Banco resetado com sucesso!');
  console.log('');
  console.log('Tabelas limpas:');
  console.log('  - grupos');
  console.log('  - jogadores');
  console.log('  - grupo_jogadores');
  console.log('  - admins');
  console.log('  - partidas');
  console.log('  - presencas');
  console.log('  - avulsos');
  console.log('  - lembretes_enviados');
  console.log('');
  console.log('Proximo passo: pm2 start appfut-grupo e escanear QR');
} catch(e) {
  console.error('[ERRO] Falha ao resetar banco:', e.message);
}
