require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var db          = require('../database/connection');
var { verificarRateLimit, delay } = require('../utils/rateLimit');
var { montarListaCompleta }       = require('../utils/listaHelper');
var { getGrupoAtivoId }           = require('./admin');
var createClient                  = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';

async function buscarPartidaAberta(jogadorId, grupoHint) {
  var q = 'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, ' +
    'g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +
    'JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE' +
    (grupoHint ? ' AND p.grupo_id = ?' : '') +
    ' ORDER BY p.data_partida ASC LIMIT 1';
  var args = grupoHint ? [jogadorId, grupoHint] : [jogadorId];
  var [rows] = await db.execute(q, args);
  return rows[0] || null;
}

async function adicionarAvulso(remoteJid, nome) {
  var limite = verificarRateLimit(remoteJid, 'avulso_' + nome);
  if (!limite.permitido) return;
  await delay();

  var client = createClient();

  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [remoteJid]);
  if (jogador.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Você não está cadastrado. ⚠️');
    return;
  }
  var jogadorId = jogador[0].id;

  var p = await buscarPartidaAberta(jogadorId, getGrupoAtivoId(remoteJid));
  if (!p) {
    await client.message.sendText(instanceName, remoteJid, 'Não há jogo aberto no momento. ⚠️');
    return;
  }

  // Verifica se o nome é o próprio membro (self-add)
  var [jogadorExistente] = await db.execute(
    'SELECT id FROM jogadores WHERE LOWER(nome) = LOWER(?)', [nome]
  );
  var jogadorAvulsoId = null;
  if (jogadorExistente.length > 0 && jogadorExistente[0].id === jogadorId) {
    jogadorAvulsoId = jogadorExistente[0].id;
  }

  if (jogadorAvulsoId) {
    await db.execute('DELETE FROM presencas WHERE jogador_id = ? AND partida_id = ?', [jogadorAvulsoId, p.id]);
    await db.execute('DELETE FROM ausentes  WHERE jogador_id = ? AND partida_id = ?', [jogadorAvulsoId, p.id]);
    await db.execute(
      'DELETE FROM avulsos WHERE partida_id = ? AND (LOWER(nome) = LOWER(?) OR jogador_id = ?)',
      [p.id, nome, jogadorAvulsoId]
    );
  } else {
    await db.execute(
      'DELETE FROM avulsos WHERE partida_id = ? AND LOWER(nome) = LOWER(?)', [p.id, nome]
    );
  }

  await db.execute(
    'INSERT INTO avulsos (partida_id, nome, jogador_id, adicionado_por) VALUES (?, ?, ?, ?)',
    [p.id, nome, jogadorAvulsoId, jogadorId]
  );

  var lista = await montarListaCompleta(
    p.id, p.grupo_id, p.grupo_nome, p.data_partida,
    p.max_jogadores, p.horario_inicio, p.horario_fim, false
  );
  await client.message.sendText(instanceName, remoteJid,
    '🔸 *' + nome + '* adicionado aos avulsos!\n\n' + lista
  );
}

async function removerAvulso(remoteJid, nome) {
  var limite = verificarRateLimit(remoteJid, 'remover_avulso_' + nome);
  if (!limite.permitido) return;
  await delay();

  var client = createClient();

  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [remoteJid]);
  if (jogador.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Você não está cadastrado. ⚠️');
    return;
  }

  var p = await buscarPartidaAberta(jogador[0].id, getGrupoAtivoId(remoteJid));
  if (!p) {
    await client.message.sendText(instanceName, remoteJid, 'Não há jogo aberto no momento. ⚠️');
    return;
  }

  var [result] = await db.execute(
    'DELETE FROM avulsos WHERE partida_id = ? AND LOWER(nome) = LOWER(?)', [p.id, nome]
  );
  if (result.affectedRows === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Avulso *' + nome + '* não encontrado. ⚠️');
    return;
  }

  var lista = await montarListaCompleta(
    p.id, p.grupo_id, p.grupo_nome, p.data_partida,
    p.max_jogadores, p.horario_inicio, p.horario_fim, false
  );
  await client.message.sendText(instanceName, remoteJid,
    '❌ *' + nome + '* removido dos avulsos.\n\n' + lista
  );
}

module.exports = { adicionarAvulso, removerAvulso };
