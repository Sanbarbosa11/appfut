/**
 * index_wpp.js — WPPConnect limitado ao grupo
 *
 * Responsabilidades:
 *   - !lista e !ajuda no grupo
 *   - Lembretes financeiros no grupo (scheduler)
 *
 * Tudo no privado e tratado pelo index_meta.js (Meta API)
 */

require('dotenv').config();

var wppconnect = require('@wppconnect-team/wppconnect');
var db = require('../database/connection');
var { iniciarScheduler } = require('./scheduler');

function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function start() {
  var client = await wppconnect.create({
    session: 'appfut-grupo',
    headless: true,
    useChrome: false,
    puppeteerOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
    }
  });

  console.log('[WPP] Bot grupo iniciado!');

  // Passa o client do WPPConnect para o scheduler (lembretes no grupo)
  iniciarScheduler(client);

  client.onMessage(async function(message) {
    try {
      if (!message.sender) return;
      if (!message.isGroupMsg) return; // ignora privado completamente

      var text = normalizar(message.body);

      if (text === '!lista' || text === '!lista ') {
        await processarListaGrupo(client, message);
        return;
      }

      if (text === '!ajuda') {
        await client.sendText(message.from,
          '\u26bd *AppFut* \u2014 Comandos no grupo:\n\n' +
          '`!lista` \u2014 Ver quem confirmou\n' +
          '`!ajuda` \u2014 Ver este menu\n\n' +
          '\ud83d\udcf2 Para confirmar presenca, cancela ou ver lista completa, mande mensagem direto para este numero no privado!'
        );
        return;
      }
    } catch(e) {
      console.error('[WPP] Erro onMessage:', e);
    }
  });
}

async function processarListaGrupo(client, message) {
  try {
    var grupoWppId = message.from;

    var [grupos] = await db.execute(
      'SELECT id, nome FROM grupos WHERE whatsapp_id = ?', [grupoWppId]
    );
    if (grupos.length === 0) {
      await client.sendText(message.from, '\u26a0\ufe0f Grupo nao cadastrado.');
      return;
    }
    var grupo = grupos[0];

    var [partidas] = await db.execute(
      'SELECT id, data_partida, horario_inicio, horario_fim, max_jogadores FROM partidas WHERE grupo_id = ? AND status = "aberta" ORDER BY data_partida ASC LIMIT 1',
      [grupo.id]
    );
    if (partidas.length === 0) {
      await client.sendText(message.from, '\u26a0\ufe0f Nenhuma partida aberta no momento.');
      return;
    }
    var partida = partidas[0];

    var [confirmados] = await db.execute(
      'SELECT j.nome FROM presencas p JOIN jogadores j ON p.jogador_id = j.id WHERE p.partida_id = ? ORDER BY j.nome',
      [partida.id]
    );
    var [avulsos] = await db.execute(
      'SELECT nome FROM avulsos WHERE partida_id = ? ORDER BY nome',
      [partida.id]
    );

    var data = new Date(partida.data_partida);
    var dataStr = String(data.getDate()).padStart(2, '0') + '/' + String(data.getMonth() + 1).padStart(2, '0');
    var horario = partida.horario_inicio ? String(partida.horario_inicio).replace(/:(\d{2})$/, '') : '';

    var total = confirmados.length + avulsos.length;
    var max = partida.max_jogadores || 20;

    var linhas = ['\u26bd *' + grupo.nome + '* \u2014 ' + dataStr + (horario ? ' \u00e0s ' + horario : '')];
    linhas.push('Confirmados: *' + total + '/' + max + '*\n');

    if (confirmados.length > 0) {
      linhas.push('*Jogadores:*');
      confirmados.forEach(function(j, i) { linhas.push((i + 1) + '. ' + j.nome); });
    }
    if (avulsos.length > 0) {
      linhas.push('\n*Avulsos:*');
      avulsos.forEach(function(a, i) { linhas.push((i + 1) + '. ' + a.nome); });
    }

    linhas.push('\n\ud83d\udcf2 Para confirmar, mande mensagem para o bot no privado!');

    await client.sendText(message.from, linhas.join('\n'));
  } catch(e) {
    console.error('[WPP] Erro lista grupo:', e);
  }
}

start().catch(console.error);
