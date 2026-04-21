var db = require('../../database/connection');

function formatarHorario(h) {
  if (!h) return '';
  return String(h).replace(/:([0-9]{2})$/, '');
}

async function montarListaCompleta(partidaId, grupoId, grupoNome, dataPartida, maxJogadores, horarioInicio, horarioFim, incluirFooter) {
  var [confirmados] = await db.execute(
    'SELECT j.nome FROM presencas pr JOIN jogadores j ON pr.jogador_id = j.id WHERE pr.partida_id = ? ORDER BY pr.confirmado_em ASC',
    [partidaId]
  );
  var [avulsos] = await db.execute(
    'SELECT a.nome, j.nome as adicionado_por FROM avulsos a JOIN jogadores j ON a.adicionado_por = j.id WHERE a.partida_id = ? ORDER BY a.criado_em ASC',
    [partidaId]
  );
  var [ausentes] = await db.execute(
    'SELECT j.nome FROM ausentes a JOIN jogadores j ON a.jogador_id = j.id WHERE a.partida_id = ? ORDER BY a.criado_em ASC',
    [partidaId]
  );
  var [duvidas] = await db.execute(
    'SELECT j.nome FROM grupo_jogadores gj JOIN jogadores j ON gj.jogador_id = j.id WHERE gj.grupo_id = ? AND gj.ativo = TRUE AND j.id NOT IN (SELECT jogador_id FROM presencas WHERE partida_id = ?) AND j.id NOT IN (SELECT jogador_id FROM ausentes WHERE partida_id = ?) ORDER BY j.nome ASC',
    [grupoId, partidaId, partidaId]
  );

  var totalPresentes = confirmados.length + avulsos.length;
  var data = new Date(dataPartida);
  data = new Date(data.getTime() + data.getTimezoneOffset() * 60000);
  var dd = String(data.getDate()).padStart(2, '0');
  var mm = String(data.getMonth() + 1).padStart(2, '0');
  var dataF = data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  var hi = formatarHorario(horarioInicio);
  var hf = formatarHorario(horarioFim);

  var texto = '\u26bd *' + grupoNome + '*\n';
  texto += '\ud83d\udcc5 ' + dataF + '\n';
  if (hi) texto += '\u23f0 ' + hi + ' - ' + hf + '\n';
  texto += '\ud83d\udc65 ' + totalPresentes + '/' + maxJogadores + ' confirmados\n';

  texto += '\n\u2705 *Confirmados (' + confirmados.length + '):*\n';
  if (confirmados.length === 0) {
    texto += '_Nenhum confirmado ainda_\n';
  } else {
    for (var c = 0; c < confirmados.length; c++) {
      texto += (c + 1) + '. ' + confirmados[c].nome + '\n';
    }
  }

  texto += '\n\u274c *Ausentes (' + ausentes.length + '):*\n';
  if (ausentes.length === 0) {
    texto += '_Ningu\u00e9m cancelou ainda_\n';
  } else {
    for (var b = 0; b < ausentes.length; b++) {
      texto += (b + 1) + '. ' + ausentes[b].nome + '\n';
    }
  }

  texto += '\n\u2753 *D\u00favida (' + duvidas.length + '):*\n';
  if (duvidas.length === 0) {
    texto += '_Todos responderam!_\n';
  } else {
    for (var d = 0; d < duvidas.length; d++) {
      texto += '\u00b7 ' + duvidas[d].nome + '\n';
    }
  }

  texto += '\n\ud83d\udd38 *Avulsos (' + avulsos.length + '):*\n';
  for (var a = 0; a < avulsos.length; a++) {
    texto += (confirmados.length + a + 1) + '. ' + avulsos[a].nome + ' _(por ' + avulsos[a].adicionado_por + ')_\n';
  }

  if (incluirFooter) {
    var botPhone = process.env.META_BOT_NUMBER || '5511995421741';
    texto += '\n\ud83d\udcf2 *Clique no WhatsApp:* https://wa.me/' + botPhone;
  } else {
    texto += '\n\ud83d\udccc _avulso Nome \u2014 adicionar avulso_\n';
    texto += '_remover avulso Nome \u2014 remover avulso_';
  }

  return texto;
}

module.exports = { montarListaCompleta, formatarHorario };
