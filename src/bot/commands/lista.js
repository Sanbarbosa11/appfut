var db = require('../../database/connection');
var { verificarRateLimit, delay } = require('../utils/rateLimit');
var { montarListaCompleta } = require('../utils/listaHelper');
var { getGrupoAtivoId } = require('./admin');

async function lista(client, message, sender) {
  var limite = verificarRateLimit(sender, 'lista');
  if (!limite.permitido) return;
  await delay();

  var [jogador] = await db.execute(
    'SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]
  );

  if (jogador.length === 0) {
    await client.sendText(message.from, 'Voc\u00ea n\u00e3o est\u00e1 cadastrado em nenhum grupo. \u26a0\ufe0f');
    return;
  }

  var grupoHint = getGrupoAtivoId(sender);
  var partQuery = 'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE' +
    (grupoHint ? ' AND p.grupo_id = ?' : '') +
    ' ORDER BY p.data_partida ASC LIMIT 1';
  var partArgs = grupoHint ? [jogador[0].id, grupoHint] : [jogador[0].id];
  var [partidas] = await db.execute(partQuery, partArgs);

  if (partidas.length === 0) {
    await client.sendText(message.from, 'N\u00e3o h\u00e1 jogo aberto no momento. \u26a0\ufe0f');
    return;
  }

  var p = partidas[0];
  var texto = await montarListaCompleta(p.id, p.grupo_id, p.grupo_nome, p.data_partida, p.max_jogadores, p.horario_inicio, p.horario_fim, false);

  await client.sendText(message.from, texto);
}

module.exports = { lista };
