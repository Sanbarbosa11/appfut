require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var db               = require('../database/connection');
var { verificarRateLimit, delay } = require('../utils/rateLimit');
var { montarListaCompleta }       = require('../utils/listaHelper');
var { getGrupoAtivoId }           = require('./admin');
var createClient                  = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';

async function cancelar(remoteJid) {
  var limite = verificarRateLimit(remoteJid, 'cancelar');
  if (!limite.permitido) return;
  await delay();

  var client = createClient();
  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [remoteJid]);
  if (jogador.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Você não está cadastrado. ⚠️');
    return;
  }
  var jogadorId = jogador[0].id;

  var grupoHint = getGrupoAtivoId(remoteJid);
  var partQuery =
    'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
    'WHERE gj.jogador_id = ? AND gj.ativo = TRUE AND p.status = "aberta"' +
    (grupoHint ? ' AND p.grupo_id = ?' : '') +
    ' ORDER BY p.data_partida ASC LIMIT 1';
  var partArgs = grupoHint ? [jogadorId, grupoHint] : [jogadorId];
  var [partidas] = await db.execute(partQuery, partArgs);

  if (partidas.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Não há jogo aberto no momento. ⚠️');
    return;
  }

  var p = partidas[0];
  await db.execute('DELETE FROM presencas WHERE partida_id = ? AND jogador_id = ?', [p.id, jogadorId]);
  await db.execute('INSERT IGNORE INTO ausentes (partida_id, jogador_id) VALUES (?, ?)', [p.id, jogadorId]);

  var lista = await montarListaCompleta(
    p.id, p.grupo_id, p.grupo_nome, p.data_partida,
    p.max_jogadores, p.horario_inicio, p.horario_fim, false
  );
  await client.message.sendText(instanceName, remoteJid, 'Presença cancelada. Até a próxima! 👋\n\n' + lista);
}

module.exports = { cancelar };
