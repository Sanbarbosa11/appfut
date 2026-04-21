var db = require('../../database/connection');
var { verificarRateLimit, delay } = require('../utils/rateLimit');
var { montarListaCompleta } = require('../utils/listaHelper');
var { getGrupoAtivoId } = require('./admin');

async function confirmar(client, message, sender, senderName) {
  var limite = verificarRateLimit(sender, 'confirmar');
  if (!limite.permitido) return;
  await delay();

  await db.execute('INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)', [sender, senderName]);
  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);
  var jogadorId = jogador[0].id;

  // Verifica se esta em grupo COM partida aberta
  var [comPartida] = await db.execute(
    'SELECT gj.grupo_id FROM grupo_jogadores gj JOIN partidas p ON p.grupo_id = gj.grupo_id WHERE gj.jogador_id = ? AND gj.ativo = TRUE AND p.status = "aberta" LIMIT 1',
    [jogadorId]
  );

  if (comPartida.length === 0) {
    var [grupoAberto] = await db.execute(
      'SELECT g.id FROM grupos g JOIN partidas p ON p.grupo_id = g.id WHERE p.status = "aberta" ORDER BY p.data_partida ASC LIMIT 1'
    );
    if (grupoAberto.length > 0) {
      await db.execute(
        'INSERT INTO grupo_jogadores (grupo_id, jogador_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE grupo_id = VALUES(grupo_id)',
        [grupoAberto[0].id, jogadorId]
      );
    } else {
      await client.sendText(message.from, 'N\u00e3o h\u00e1 nenhum jogo aberto no momento. \u26a0\ufe0f');
      return;
    }
  }

  var grupoHint = getGrupoAtivoId(sender);
  var partQuery = 'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE' +
    (grupoHint ? ' AND p.grupo_id = ?' : '') +
    ' ORDER BY p.data_partida ASC LIMIT 1';
  var partArgs = grupoHint ? [jogadorId, grupoHint] : [jogadorId];
  var [partidas] = await db.execute(partQuery, partArgs);

  if (partidas.length === 0) {
    await client.sendText(message.from, 'N\u00e3o h\u00e1 nenhum jogo aberto no momento. \u26a0\ufe0f');
    return;
  }

  var p = partidas[0];

  var [contagem] = await db.execute(
    'SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [p.id]
  );

  if (contagem[0].total >= p.max_jogadores) {
    await client.sendText(message.from, 'O jogo j\u00e1 est\u00e1 lotado (' + p.max_jogadores + ' jogadores). \ud83d\ude22');
    return;
  }

  // Limpa estados anteriores (ausente / duvida) antes de confirmar
  await db.execute('DELETE FROM ausentes WHERE partida_id = ? AND jogador_id = ?', [p.id, jogadorId]);
  await db.execute('DELETE FROM duvidas WHERE partida_id = ? AND jogador_id = ?', [p.id, jogadorId]);

  await db.execute(
    'INSERT IGNORE INTO presencas (partida_id, jogador_id) VALUES (?, ?)',
    [p.id, jogadorId]
  );

  var lista = await montarListaCompleta(
    p.id, p.grupo_id, p.grupo_nome, p.data_partida,
    p.max_jogadores, p.horario_inicio, p.horario_fim, false
  );

  await client.sendText(message.from,
    '\u2705 Presen\u00e7a confirmada, ' + senderName + '!\n\n' + lista
  );
}

module.exports = { confirmar };
