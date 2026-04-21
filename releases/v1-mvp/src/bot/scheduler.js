var cron = require('node-cron');
var db = require('../database/connection');
var { montarListaCompleta } = require('./utils/listaHelper');

var clientRef = null; // WPPConnect — mensagens no grupo

// MODO TESTE: true = lembrete a cada 3 min, false = horarios reais
var MODO_TESTE = false;

function formatarHorario(h) {
  if (!h) return '';
  return String(h).replace(/:(\d{2})$/, '');
}

function iniciarScheduler(client) {
  clientRef = client;

  // Auto-close: a cada 5 minutos
  cron.schedule('*/5 * * * *', async function() {
    try {
      await verificarAutoClose();
    } catch (err) {
      console.error('Erro no auto-close:', err);
    }
  });

  if (MODO_TESTE) {
    // TESTE: roda a cada 3 minutos
    cron.schedule('*/3 * * * *', async function() {
      try {
        await verificarLembretes();
      } catch (err) {
        console.error('Erro nos lembretes:', err);
      }
    });
    console.log('Scheduler iniciado - MODO TESTE (lembretes a cada 3min)');
  } else {
    // PRODUCAO: 9h da manha (2 dias e 1 dia antes)
    cron.schedule('0 9 * * *', async function() {
      try {
        await verificarLembretes();
      } catch (err) {
        console.error('Erro nos lembretes:', err);
      }
    });
    // PRODUCAO: a cada 5 min pra verificar lembrete de 1h antes
    cron.schedule('*/5 * * * *', async function() {
      try {
        await verificarLembrete1hAntes();
      } catch (err) {
        console.error('Erro no lembrete 1h:', err);
      }
    });
    console.log('Scheduler iniciado - PRODUCAO (lembretes 9h + 1h antes)');
  }
}

// ========== AUTO-CLOSE ==========

async function verificarAutoClose() {
  var [partidas] = await db.execute(
    `SELECT p.id, p.grupo_id, g.tipo, g.dia_semana, g.horario_fim, g.horario_inicio,
            g.max_jogadores, g.whatsapp_id, g.nome as grupo_nome, p.data_partida
     FROM partidas p
     JOIN grupos g ON p.grupo_id = g.id
     WHERE p.status = 'aberta' AND g.ativo = TRUE AND g.horario_fim IS NOT NULL`
  );

  var agora = new Date();

  for (var i = 0; i < partidas.length; i++) {
    var p = partidas[i];
    var dataPartida = new Date(p.data_partida);
    var horarioFim = String(p.horario_fim).split(':');
    dataPartida.setHours(parseInt(horarioFim[0]), parseInt(horarioFim[1]), 0);

    var limiteFechar = new Date(dataPartida.getTime() + 60 * 60 * 1000);

    if (agora >= limiteFechar) {
      await db.execute('UPDATE partidas SET status = "fechada" WHERE id = ?', [p.id]);

      var [conf] = await db.execute('SELECT COUNT(*) as total FROM presencas WHERE partida_id = ?', [p.id]);
      var [avul] = await db.execute('SELECT COUNT(*) as total FROM avulsos WHERE partida_id = ?', [p.id]);
      var totalJogadores = conf[0].total + avul[0].total;

      console.log('Auto-close: partida ' + p.id + ' fechada (' + totalJogadores + ' jogadores)');

      if (clientRef) {
        try {
          await clientRef.sendText(p.whatsapp_id,
            '\ud83d\udd12 *Partida encerrada automaticamente!*\n' +
            '\ud83d\udc65 ' + totalJogadores + ' jogadores participaram.\n\n' +
            'Valeu, galera! \u26bd'
          );
        } catch (e) {
          console.error('Erro ao enviar msg de close:', e);
        }
      }

      if (p.tipo === 'fixo' && p.dia_semana !== null) {
        var proxData = proximaData(p.dia_semana);
        var proxDateStr = proxData.toISOString().slice(0, 10);
        await db.execute(
          'INSERT INTO partidas (grupo_id, data_partida, max_jogadores) VALUES (?, ?, ?)',
          [p.grupo_id, proxDateStr, p.max_jogadores]
        );
        var proxF = proxData.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
        console.log('Auto-renew: nova partida para ' + proxF);

        if (clientRef) {
          try {
            await clientRef.sendText(p.whatsapp_id,
              '\ud83d\udd04 *Proxima partida criada!*\n\n' +
              '\ud83d\udcc5 ' + proxF + '\n' +
              '\u23f0 ' + formatarHorario(p.horario_inicio) + ' - ' + formatarHorario(p.horario_fim) + '\n' +
              '\ud83d\udc65 ' + p.max_jogadores + ' vagas\n\n' +
              'Me chama no privado pra confirmar! \ud83d\udcaa'
            );
          } catch (e) {
            console.error('Erro ao enviar msg de renew:', e);
          }
        }
      }
    }
  }
}

// ========== LEMBRETES ==========

async function verificarLembretes() {
  var partidas;

  if (MODO_TESTE) {
    var [rows] = await db.execute(
      `SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id,
              g.nome as grupo_nome, g.horario_inicio, g.horario_fim, g.whatsapp_id as grupo_wid
       FROM partidas p
       JOIN grupos g ON p.grupo_id = g.id
       WHERE p.status = 'aberta' AND g.ativo = TRUE`
    );
    partidas = rows;
  } else {
    var [rows2] = await db.execute(
      `SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id,
              g.nome as grupo_nome, g.horario_inicio, g.horario_fim, g.whatsapp_id as grupo_wid
       FROM partidas p
       JOIN grupos g ON p.grupo_id = g.id
       WHERE p.status = 'aberta'
         AND g.ativo = TRUE
         AND (p.data_partida = DATE_ADD(CURDATE(), INTERVAL 2 DAY)
              OR p.data_partida = DATE_ADD(CURDATE(), INTERVAL 1 DAY))`
    );
    partidas = rows2;
  }

  if (partidas.length === 0) return;

  for (var i = 0; i < partidas.length; i++) {
    var partida = partidas[i];

    var tipo;
    if (MODO_TESTE) {
      var [enviados] = await db.execute(
        'SELECT DISTINCT tipo FROM lembretes_enviados WHERE partida_id = ?',
        [partida.id]
      );
      var tiposEnviados = enviados.map(function(r) { return r.tipo; });

      if (tiposEnviados.indexOf('2_dias') === -1) {
        tipo = '2_dias';
      } else if (tiposEnviados.indexOf('1_dia') === -1) {
        tipo = '1_dia';
      } else if (tiposEnviados.indexOf('1_hora') === -1) {
        tipo = '1_hora';
      } else {
        continue;
      }
    } else {
      var hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      var dataP = new Date(partida.data_partida);
      dataP.setHours(0, 0, 0, 0);
      var diffDias = Math.round((dataP - hoje) / (1000 * 60 * 60 * 24));
      if (diffDias === 2) tipo = '2_dias';
      else if (diffDias === 1) tipo = '1_dia';
      else continue;
    }

    await enviarLembreteGrupo(partida, tipo);
  }
}

// ========== LEMBRETE 1H ANTES (PRODUCAO) ==========

async function verificarLembrete1hAntes() {
  var [partidas] = await db.execute(
    `SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id,
            g.nome as grupo_nome, g.horario_inicio, g.horario_fim, g.whatsapp_id as grupo_wid
     FROM partidas p
     JOIN grupos g ON p.grupo_id = g.id
     WHERE p.status = 'aberta' AND g.ativo = TRUE
       AND g.horario_inicio IS NOT NULL AND p.data_partida = CURDATE()`
  );

  var agora = new Date();

  for (var i = 0; i < partidas.length; i++) {
    var partida = partidas[i];
    if (!partida.horario_inicio) continue;

    var horaParts = String(partida.horario_inicio).split(':');
    var horaInicio = new Date();
    horaInicio.setHours(parseInt(horaParts[0]), parseInt(horaParts[1]), 0, 0);

    var horaLembrete = new Date(horaInicio.getTime() - 60 * 60 * 1000);
    var diffMin = (agora - horaLembrete) / (1000 * 60);
    if (diffMin >= 0 && diffMin < 5) {
      await enviarLembreteGrupo(partida, '1_hora');
    }
  }
}

// ========== ENVIAR LEMBRETE NO GRUPO ==========

async function enviarLembreteGrupo(partida, tipo) {
  // Verifica se ja enviou este tipo para esta partida
  var [jaEnviado] = await db.execute(
    'SELECT id FROM lembretes_enviados WHERE partida_id = ? AND tipo = ? LIMIT 1',
    [partida.id, tipo]
  );
  if (jaEnviado.length > 0) {
    console.log('Lembrete ' + tipo + ': ja enviado (' + partida.grupo_nome + ')');
    return;
  }

  var msg = '';
  if (tipo === '2_dias') {
    msg = '\ud83d\udce2 *Lembrete de jogo - ' + partida.grupo_nome + '*\n\n';
    msg += 'Tem jogo em 2 dias!\n\n';
  } else if (tipo === '1_dia') {
    msg = '\u26a0\ufe0f *Ultimo lembrete - ' + partida.grupo_nome + '*\n\n';
    msg += 'Tem jogo AMANH\u00c3!\n\n';
  } else if (tipo === '1_hora') {
    msg = '\ud83d\udea8 *Falta 1 hora! - ' + partida.grupo_nome + '*\n\n';
    msg += 'O jogo \u00e9 HOJE!\n\n';
  }

  var listaTexto = await montarListaCompleta(partida.id, partida.grupo_id, partida.grupo_nome, partida.data_partida, partida.max_jogadores, partida.horario_inicio, partida.horario_fim, true);
  msg += listaTexto + '\n';

  if (!clientRef) {
    console.log('Lembrete ' + tipo + ': clientRef nao disponivel');
    return;
  }

  try {
    await clientRef.sendText(partida.grupo_wid, msg);
    console.log('Lembrete ' + tipo + ' enviado no grupo: ' + partida.grupo_nome);
  } catch (e) {
    console.error('Erro ao enviar lembrete no grupo:', e.message || e);
    return;
  }

  // Registra usando o primeiro jogador ativo como sentinel
  var [jogadores] = await db.execute(
    'SELECT jogador_id FROM grupo_jogadores WHERE grupo_id = ? AND ativo = TRUE LIMIT 1',
    [partida.grupo_id]
  );
  if (jogadores.length > 0) {
    await db.execute(
      'INSERT IGNORE INTO lembretes_enviados (partida_id, jogador_id, tipo) VALUES (?, ?, ?)',
      [partida.id, jogadores[0].jogador_id, tipo]
    );
  }
}

// ========== HELPERS ==========

function proximaData(diaSemana) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  for (var i = 0; i < 7; i++) {
    if (d.getDay() === diaSemana) return d;
    d.setDate(d.getDate() + 1);
  }
  return d;
}

module.exports = { iniciarScheduler };
