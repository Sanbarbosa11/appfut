var db = require('../../database/connection');
var { verificarRateLimit, delay } = require('../utils/rateLimit');

async function duvida(client, message, sender, senderName) {
  var limite = verificarRateLimit(sender, 'duvida');
  if (!limite.permitido) return;
  await delay();

  await db.execute('INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)', [sender, senderName]);
  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);
  if (jogador.length === 0) return;
  var jogadorId = jogador[0].id;

  var [partidas] = await db.execute(
    'SELECT p.id, g.nome as grupo_nome FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE ORDER BY p.data_partida ASC LIMIT 1',
    [jogadorId]
  );

  if (partidas.length === 0) {
    await client.sendText(message.from, 'N\u00e3o h\u00e1 nenhum jogo aberto no momento. \u26a0\ufe0f');
    return;
  }

  var partida = partidas[0];

  // Remove da lista de confirmados (se estava), registra duvida
  await db.execute('DELETE FROM presencas WHERE partida_id = ? AND jogador_id = ?', [partida.id, jogadorId]);
  await db.execute('INSERT IGNORE INTO duvidas (partida_id, jogador_id) VALUES (?, ?)', [partida.id, jogadorId]);

  await client.sendText(message.from,
    '\u2753 D\u00favida registrada, ' + senderName + '!\n' +
    '\u26bd Grupo: ' + partida.grupo_nome + '\n\n' +
    'Se confirmar depois, manda *confirmar* no privado.'
  );
}

module.exports = { duvida };
