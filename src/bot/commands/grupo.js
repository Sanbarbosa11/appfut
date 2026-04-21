var db = require('../../database/connection');
var { verificarRateLimit, delay, isDuplicado } = require('../utils/rateLimit');
var { montarListaCompleta } = require('../utils/listaHelper');

async function processarComandoGrupo(client, message) {
  var text = (message.body || '').trim().toLowerCase();
  switch (text) {
    case '!ajuda': await delay(); await comandoAjuda(client, message); break;
    case '!lista': await comandoLista(client, message); break;
    default: break;
  }
}

async function comandoAjuda(client, message) {
  await client.sendText(message.from,
    '\u26bd *Assistente do Rach\u00e3o*\n\n' +
    'Fala, pessoal! \ud83d\udc4b\n\n' +
    'Pra manter o grupo organizado, os comandos funcionam s\u00f3 no privado \ud83d\udc4d\n\n' +
    '\ud83d\udce9 Me chama pra:\n' +
    '\u2022 Confirmar presen\u00e7a no jogo\n' +
    '\u2022 Cancelar presen\u00e7a\n\n' +
    '\ud83d\udccb No grupo, s\u00f3 funciona:\n' +
    '\u2022 *!ajuda* - Esta mensagem\n' +
    '\u2022 *!lista* - Ver lista completa\n\n' +
    '\ud83d\udc49 Clica no meu n\u00famero e manda um "oi" pra come\u00e7ar!\n\n' +
    'Bora organizar esse jogo! \u26bd\ud83d\udd25'
  );
}

async function comandoLista(client, message) {
  if (isDuplicado(message.from, 'lista')) return;

  var limite = verificarRateLimit(message.from, 'lista');
  if (!limite.permitido) {
    await delay();
    await client.sendText(message.from,
      '\u23f3 *!lista* j\u00e1 foi usado 3x nesta hora. Tente em ~' + limite.minutosRestantes + ' min.'
    );
    return;
  }

  await delay();

  var [partidas] = await db.execute(
    'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND g.whatsapp_id = ? ' +
    'ORDER BY p.data_partida ASC LIMIT 1',
    [message.from]
  );

  if (partidas.length === 0) {
    await client.sendText(message.from, 'N\u00e3o h\u00e1 jogo aberto no momento. \u26a0\ufe0f');
    return;
  }

  var p = partidas[0];
  var texto = await montarListaCompleta(p.id, p.grupo_id, p.grupo_nome, p.data_partida, p.max_jogadores, p.horario_inicio, p.horario_fim, true);

  if (limite.restante > 0) {
    texto += '\n\ud83d\udcca _Consultas restantes: ' + limite.restante + '_';
  } else {
    texto += '\n\ud83d\udcca _\u00daltima consulta nesta hora_';
  }

  await client.sendText(message.from, texto);
}

module.exports = { processarComandoGrupo };
