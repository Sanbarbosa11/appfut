require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var db               = require('../database/connection');
var { verificarRateLimit, isDuplicado, delay } = require('../utils/rateLimit');
var { montarListaCompleta }                    = require('../utils/listaHelper');
var { processarComandoAdmin, getGrupoAtivoId } = require('./admin');
var { confirmar }                              = require('./confirmar');
var { cancelar }                               = require('./cancelar');
var { adicionarAvulso, removerAvulso }         = require('./avulso');
var createClient                               = require('../client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';

var DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function formatarData(dataPartida) {
  var d = new Date(dataPartida);
  d = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  var dia = String(d.getDate()).padStart(2, '0');
  var mes = String(d.getMonth() + 1).padStart(2, '0');
  return DIAS[d.getDay()] + ', ' + dia + '/' + mes;
}

function formatarHorario(h) {
  if (!h) return '';
  return String(h).replace(/:(\d{2})$/, '');
}

// ============================================================
// Atualiza nome quando era placeholder numerico (@lid)
// ============================================================

async function atualizarNomeSePendente(jid, pushName) {
  if (!jid || !pushName) return;
  await db.execute(
    'UPDATE jogadores SET nome = ? WHERE whatsapp_id = ? AND nome REGEXP \'^[0-9]+$\'',
    [pushName, jid]
  );
}

// ============================================================
// GRUPO: !ajuda e !lista
// ============================================================

async function processarComandoGrupo(remoteJid, text, participant, pushName) {
  if (participant && pushName) {
    atualizarNomeSePendente(participant, pushName).catch(function() {});
  }
  var cmd = (text || '').trim().toLowerCase();
  if (cmd !== '!ajuda' && cmd !== '!lista') return;

  var client = createClient();

  if (cmd === '!ajuda') {
    await delay();
    await client.message.sendText(instanceName, remoteJid,
      '⚽ *Assistente do Rachão*\n\n' +
      'Fala, pessoal! 👋\n\n' +
      'Pra manter o grupo organizado, os comandos funcionam só no privado 👍\n\n' +
      '📩 Me chama pra:\n' +
      '• Confirmar presença no jogo\n' +
      '• Cancelar presença\n\n' +
      '📋 No grupo, só funciona:\n' +
      '• *!ajuda* - Esta mensagem\n' +
      '• *!lista* - Ver lista completa\n\n' +
      '👉 Clica no meu número e manda um "oi" pra começar!\n\n' +
      'Bora organizar esse jogo! ⚽🔥'
    );
    return;
  }

  if (cmd === '!lista') {
    if (isDuplicado(remoteJid, 'lista')) return;
    var limite = verificarRateLimit(remoteJid, 'lista');
    if (!limite.permitido) {
      await delay();
      await client.message.sendText(instanceName, remoteJid,
        '⏳ *!lista* já foi usado 3x nesta hora. Tente em ~' + limite.minutosRestantes + ' min.'
      );
      return;
    }
    await delay();
    var [partidas] = await db.execute(
      'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
      'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +
      'WHERE p.status = "aberta" AND g.whatsapp_id = ? ' +
      'ORDER BY p.data_partida ASC LIMIT 1',
      [remoteJid]
    );
    if (partidas.length === 0) {
      await client.message.sendText(instanceName, remoteJid, 'Não há jogo aberto no momento. ⚠️');
      return;
    }
    var p = partidas[0];
    var texto = await montarListaCompleta(
      p.id, p.grupo_id, p.grupo_nome, p.data_partida,
      p.max_jogadores, p.horario_inicio, p.horario_fim, true
    );
    await client.message.sendText(instanceName, remoteJid, texto);
  }
}

// ============================================================
// Menu contextual no privado (substitui botoes interativos)
// ============================================================

async function enviarMenuJogador(remoteJid, senderName) {
  var client = createClient();
  var nome   = senderName || 'Jogador';
  var corpo  = '_Nenhuma partida aberta no momento._';

  try {
    var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [remoteJid]);
    if (jogador.length > 0) {
      var grupoHint = getGrupoAtivoId(remoteJid);
      var q = 'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, ' +
        'g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
        'FROM partidas p JOIN grupos g ON p.grupo_id = g.id ' +
        'JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
        'WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE' +
        (grupoHint ? ' AND p.grupo_id = ?' : '') +
        ' ORDER BY p.data_partida ASC LIMIT 1';
      var args = grupoHint ? [jogador[0].id, grupoHint] : [jogador[0].id];
      var [rows] = await db.execute(q, args);
      if (rows.length > 0) {
        var p = rows[0];
        corpo = await montarListaCompleta(
          p.id, p.grupo_id, p.grupo_nome, p.data_partida,
          p.max_jogadores, p.horario_inicio, p.horario_fim, false
        );
      }
    }
  } catch (e) {
    console.error('[menu] Erro ao buscar partida:', e.message);
  }

  await delay();
  await client.message.sendText(instanceName, remoteJid,
    'Fala, ' + nome + '! ⚽\n\n' +
    corpo + '\n\n' +
    '━━━━━━━━━━━━━━━━\n' +
    '👉 *confirmar* — Confirmar presença\n' +
    '👉 *cancelar* — Cancelar presença\n' +
    '👉 *duvida* — Marcar como dúvida\n' +
    '👉 *lista* — Ver lista completa\n' +
    '👉 *avulso Nome* — Adicionar convidado\n' +
    '👉 *ajuda* — Ver todos os comandos'
  );
}

// ============================================================
// PRIVADO: todos os comandos
// ============================================================

async function processarMensagemPrivada(remoteJid, text, senderName) {
  var cmd    = (text || '').trim().toLowerCase();
  var client = createClient();

  if (senderName) {
    atualizarNomeSePendente(remoteJid, senderName).catch(function() {});
  }

  // Vínculo ao grupo via link de boas-vindas
  if (cmd.startsWith('entrar ')) {
    var grupoId = parseInt(cmd.split(' ')[1]);
    if (grupoId) {
      // entrar é tratado pelo Meta bot (index_meta.js) — aqui só informa
      await delay();
      await client.message.sendText(instanceName, remoteJid,
        '📲 Para se cadastrar no grupo, use o link recebido na mensagem de boas-vindas.\n' +
        'Clique nele diretamente pelo WhatsApp.'
      );
    }
    return;
  }

  // Admin
  if (cmd.startsWith('admin')) {
    return processarComandoAdmin(remoteJid, cmd);
  }

  // Confirmar
  if (cmd === 'confirmar' || cmd === 'sim' || cmd === 'vou') {
    return confirmar(remoteJid, senderName);
  }

  // Cancelar
  if (cmd === 'cancelar' || cmd === 'nao' || cmd === 'não' || cmd === 'nao vou') {
    return cancelar(remoteJid);
  }

  // Dúvida
  if (cmd === 'duvida' || cmd === 'dúvida' || cmd === 'talvez' || cmd === 'nao sei' || cmd === 'não sei') {
    return registrarDuvida(remoteJid, senderName);
  }

  // Lista
  if (cmd === 'lista') {
    return listaPrivada(remoteJid);
  }

  // Avulso
  if (cmd.startsWith('avulso ')) {
    var nomeAvulso = (text || '').trim().slice(7).trim();
    if (nomeAvulso) return adicionarAvulso(remoteJid, nomeAvulso);
  }
  if (cmd.startsWith('remover avulso ')) {
    var nomeRemover = (text || '').trim().slice(15).trim();
    if (nomeRemover) return removerAvulso(remoteJid, nomeRemover);
  }

  // Ajuda explícita
  if (cmd === 'ajuda' || cmd === 'help') {
    await delay();
    await client.message.sendText(instanceName, remoteJid,
      '⚽ *Comandos disponíveis*\n\n' +
      '👉 *confirmar* — Confirmar presença\n' +
      '👉 *cancelar* — Cancelar presença\n' +
      '👉 *duvida* — Marcar como dúvida\n' +
      '👉 *lista* — Ver lista de confirmados\n' +
      '👉 *avulso Nome* — Adicionar convidado\n' +
      '👉 *remover avulso Nome* — Remover convidado\n\n' +
      '_Admin:_\n' +
      '👉 *admin* — Ver painel de administração'
    );
    return;
  }

  // Qualquer outra mensagem: menu com status do jogo
  return enviarMenuJogador(remoteJid, senderName);
}

// ============================================================
// Lista privada
// ============================================================

async function listaPrivada(remoteJid) {
  var limite = verificarRateLimit(remoteJid, 'lista-priv');
  if (!limite.permitido) return;
  await delay();

  var client = createClient();
  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [remoteJid]);
  if (jogador.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Você não está cadastrado em nenhum grupo. ⚠️');
    return;
  }

  var grupoHint = getGrupoAtivoId(remoteJid);
  var q =
    'SELECT p.id, p.data_partida, p.max_jogadores, g.id as grupo_id, g.nome as grupo_nome, g.horario_inicio, g.horario_fim ' +
    'FROM partidas p JOIN grupos g ON p.grupo_id = g.id JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE' +
    (grupoHint ? ' AND p.grupo_id = ?' : '') +
    ' ORDER BY p.data_partida ASC LIMIT 1';
  var args = grupoHint ? [jogador[0].id, grupoHint] : [jogador[0].id];
  var [partidas] = await db.execute(q, args);

  if (partidas.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Não há jogo aberto no momento. ⚠️');
    return;
  }

  var p     = partidas[0];
  var texto = await montarListaCompleta(
    p.id, p.grupo_id, p.grupo_nome, p.data_partida,
    p.max_jogadores, p.horario_inicio, p.horario_fim, false
  );
  await client.message.sendText(instanceName, remoteJid, texto);
}

// ============================================================
// Dúvida
// ============================================================

async function registrarDuvida(remoteJid, senderName) {
  var limite = verificarRateLimit(remoteJid, 'duvida');
  if (!limite.permitido) return;
  await delay();

  var client = createClient();
  var nome   = senderName || 'Jogador';

  await db.execute('INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)', [remoteJid, nome]);
  var [jogador] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [remoteJid]);
  if (jogador.length === 0) return;
  var jogadorId = jogador[0].id;

  var grupoHint = getGrupoAtivoId(remoteJid);
  var q =
    'SELECT p.id, g.nome as grupo_nome FROM partidas p ' +
    'JOIN grupos g ON p.grupo_id = g.id ' +
    'JOIN grupo_jogadores gj ON gj.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND gj.jogador_id = ? AND gj.ativo = TRUE' +
    (grupoHint ? ' AND p.grupo_id = ?' : '') +
    ' ORDER BY p.data_partida ASC LIMIT 1';
  var args = grupoHint ? [jogadorId, grupoHint] : [jogadorId];
  var [partidas] = await db.execute(q, args);

  if (partidas.length === 0) {
    await client.message.sendText(instanceName, remoteJid, 'Não há nenhum jogo aberto no momento. ⚠️');
    return;
  }

  var partida = partidas[0];
  await db.execute('DELETE FROM presencas WHERE partida_id = ? AND jogador_id = ?', [partida.id, jogadorId]);
  await db.execute('INSERT IGNORE INTO duvidas (partida_id, jogador_id) VALUES (?, ?)', [partida.id, jogadorId]);

  await client.message.sendText(instanceName, remoteJid,
    '❓ Dúvida registrada, ' + nome + '!\n' +
    '⚽ Grupo: ' + partida.grupo_nome + '\n\n' +
    'Se confirmar depois, manda *confirmar* no privado.'
  );
}

module.exports = { processarComandoGrupo, processarMensagemPrivada };
