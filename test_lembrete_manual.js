/**
 * test_lembrete_manual.js
 *
 * Dispara um lembrete de teste imediato para NUMERO_TESTE
 * sem esperar o cron. Usa a partida aberta do grupo_id informado.
 *
 * Uso: node test_lembrete_manual.js [grupo_id]
 * Exemplo: node test_lembrete_manual.js 4
 */

require('dotenv').config();
var db = require('./src/database/connection');
var { sendText, sendButtons } = require('./src/bot/whatsapp/metaClient');

var NUMERO_TESTE = '5511963456139@c.us';
var grupoId = parseInt(process.argv[2]) || 4;

function formatarHorario(h) {
  if (!h) return '';
  return String(h).replace(/:(\d{2})$/, '');
}

async function main() {
  console.log('Buscando partida aberta do grupo_id =', grupoId, '...');

  var [partidas] = await db.execute(
    'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, ' +
    'g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +
    "WHERE p.status = 'aberta' AND p.grupo_id = ?",
    [grupoId]
  );

  if (partidas.length === 0) {
    console.log('Nenhuma partida aberta encontrada para grupo_id =', grupoId);
    process.exit(1);
  }

  var partida = partidas[0];
  console.log('Partida encontrada: id=' + partida.id + ' | ' + partida.grupo_nome + ' | ' + partida.data_partida);

  var [conf] = await db.execute('SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [partida.id]);
  var [avul] = await db.execute('SELECT COUNT(*) as total FROM avulsos WHERE partida_id = ?', [partida.id]);
  var totalConfirmados = conf[0].total + avul[0].total;

  var dataP = new Date(partida.data_partida);
  var dataF = dataP.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  var hi = formatarHorario(partida.horario_inicio);
  var hf = formatarHorario(partida.horario_fim);
  var horarioTexto = hi ? (hi + ' - ' + hf) : '';

  // Busca nome do jogador de teste
  var [jog] = await db.execute('SELECT nome FROM jogadores WHERE whatsapp_id = ?', [NUMERO_TESTE]);
  var nome = jog.length > 0 ? jog[0].nome : 'Jogador';

  var msg = '\ud83d\udce2 *Lembrete - ' + partida.grupo_nome + '*\n\n';
  msg += 'Fala, ' + nome + '! \ud83d\udc4b\n\n';
  msg += 'Tem jogo chegando:\n';
  msg += '\ud83d\udcc5 ' + dataF + '\n';
  if (horarioTexto) msg += '\u23f0 ' + horarioTexto + '\n';
  msg += '\ud83d\udc65 ' + totalConfirmados + '/' + partida.max_jogadores + ' confirmados\n\n';
  msg += 'Vai jogar? Confirma abaixo! \u26bd';

  console.log('Enviando texto para', NUMERO_TESTE, '...');
  await sendText(NUMERO_TESTE, msg);
  console.log('[OK] Texto enviado');

  await new Promise(function(r) { setTimeout(r, 1500); });

  console.log('Enviando botoes (confirmar_' + partida.id + ' / ausente_' + partida.id + ') ...');
  await sendButtons(
    NUMERO_TESTE,
    'Vai jogar? Confirma abaixo \u26bd',
    [
      { id: 'confirmar_' + partida.id, title: 'Confirmar presen\u00e7a' },
      { id: 'ausente_' + partida.id,   title: 'Estarei ausente' }
    ]
  );
  console.log('[OK] Botoes enviados');
  console.log('\nAgora clique num botao no WhatsApp e veja se o bot responde corretamente.');

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
