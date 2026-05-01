// =============================================================
// paguei.js — Handler Evolution: !paguei e !avulso NOME no grupo
//
// Fluxo:
//   Jogador manda comprovante (imagem/video/doc) + !paguei no grupo
//   → bot reage ⏳ na mensagem
//   → salva mensalidade como pendente no banco
//   → notifica admins no privado via Meta bot (sendText)
//
// Para avulso externo:
//   Membro manda !avulso NOME (com midia anexada)
//   → mesmo fluxo, mas registra avulso_nome no banco
// =============================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../evolution/.env.evolution') });

var queries      = require('../db/queries');
var createClient = require('../../../evolution/client/evolutionClient');

// Meta bot envia a notificacao para o admin no privado
var { sendText: metaSendText, sendButtons } = require('../../bot/whatsapp/metaClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';

// ─── FLAG DE CONTROLE ────────────────────────────────────────────────────────
// false = modo silencioso: processa e salva no banco, mas NAO reage no grupo
//         e NAO envia mensagem de erro no grupo. Notifica so o admin no privado.
// true  = producao: reage com emojis no grupo normalmente.
// Mude para true quando validar com o admin e avisar os jogadores.
var FINANCEIRO_ATIVO = false;
// ─────────────────────────────────────────────────────────────────────────────

// Tipos de midia aceitos como comprovante
var MIDIAS_VALIDAS = ['imageMessage', 'documentMessage', 'videoMessage'];

// Verifica se a mensagem tem alguma midia valida como comprovante
function temMidia(message) {
  if (!message) return false;
  return MIDIAS_VALIDAS.some(function(tipo) { return !!message[tipo]; });
}

// Monta label para exibir no relatorio (mensalista ou avulso)
function labelPagador(jogadorNome, tipo, avulsoNome) {
  if (tipo === 'avulso') return avulsoNome + ' (avulso por ' + jogadorNome + ')';
  return jogadorNome;
}

// Reage a mensagem no grupo via Evolution
async function reagir(client, remoteJid, msgId, emoji) {
  try {
    await client.message.sendReaction(instanceName, remoteJid, msgId, emoji);
  } catch (e) {
    console.error('[financeiro/paguei] Erro ao reagir:', e.message);
  }
}

// Notifica cada admin no privado via Meta bot
async function notificarAdmins(admins, label, grupoNome, mensalidadeId) {
  for (var i = 0; i < admins.length; i++) {
    var adminWid = admins[i];
    try {
      await sendButtons(
        adminWid,
        '💰 *Comprovante recebido*\n\n' +
        '👤 ' + label + '\n' +
        '🏀 Grupo: ' + grupoNome + '\n\n' +
        'Valide em sua conta e confirme:',
        [
          { id: 'fin_confirmar_' + mensalidadeId, title: '✅ Confirmar' },
          { id: 'fin_rejeitar_'  + mensalidadeId, title: '❌ Rejeitar'  }
        ]
      );
    } catch (e) {
      console.error('[financeiro/paguei] Erro ao notificar admin ' + adminWid + ':', e.message);
    }
  }
}

// ─── Handler principal: chamado pelo webhook_server do Evolution ──────────────

async function handlePaguei(remoteJid, participant, pushName, message, msgId) {
  var client = createClient();

  // 1. Valida midia — sem comprovante nao processa
  if (!temMidia(message)) {
    // Modo silencioso: nao manda nada no grupo
    if (FINANCEIRO_ATIVO) {
      try {
        await client.message.sendText(instanceName, remoteJid,
          '❌ ' + (pushName || 'Jogador') + ', envie o comprovante junto com o comando *!paguei*.'
        );
      } catch (e) { /* nao critico */ }
    }
    console.log('[financeiro] !paguei sem midia de ' + (pushName || participant));
    return;
  }

  // 2. Busca grupo pelo whatsapp_id do grupo
  var grupo = await queries.buscarGrupo(remoteJid);
  if (!grupo) return;

  // 3. Busca jogador pelo whatsapp_id do participante
  var jogador = await queries.buscarJogador(participant);
  if (!jogador) {
    console.log('[financeiro] !paguei de jogador nao cadastrado: ' + participant);
    return;
  }

  // 4. Verifica duplicata no mes
  var existente = await queries.buscarMensalidadeExistente(grupo.id, jogador.id, queries.mesAtual());
  if (existente && existente.status === 'pago') {
    if (FINANCEIRO_ATIVO) await reagir(client, remoteJid, msgId, '✅');
    return;
  }

  // 5. Reage com ⏳ (so se FINANCEIRO_ATIVO)
  if (FINANCEIRO_ATIVO) await reagir(client, remoteJid, msgId, '⏳');

  // 6. Salva no banco (sempre — mesmo em modo silencioso)
  await queries.registrarPaguei(grupo.id, jogador.id, participant, msgId);
  console.log('[financeiro] !paguei registrado: ' + jogador.nome + ' / grupo ' + grupo.nome);

  // Busca o id recem inserido para usar nos botoes de confirmar/rejeitar
  var registro = await queries.buscarMensalidadeExistente(grupo.id, jogador.id, queries.mesAtual());
  var mensalidadeId = registro ? registro.id : 0;

  // 7. Notifica admins via Meta (sempre — independente da flag)
  var admins = await queries.buscarAdminsDoGrupo(grupo.id);
  var label  = labelPagador(jogador.nome, 'mensalista', null);
  await notificarAdmins(admins, label, grupo.nome, mensalidadeId);
}

async function handleAvulso(remoteJid, participant, pushName, avulsoNome, message, msgId) {
  var client = createClient();

  // 1. Valida midia
  if (!temMidia(message)) {
    if (FINANCEIRO_ATIVO) {
      try {
        await client.message.sendText(instanceName, remoteJid,
          '❌ Envie o comprovante junto com *!avulso ' + avulsoNome + '*.'
        );
      } catch (e) { /* nao critico */ }
    }
    console.log('[financeiro] !avulso sem midia de ' + (pushName || participant));
    return;
  }

  // 2. Busca grupo
  var grupo = await queries.buscarGrupo(remoteJid);
  if (!grupo) return;

  // 3. Busca jogador (quem enviou — pode ser membro do grupo)
  var jogador = await queries.buscarJogador(participant);
  if (!jogador) return;

  // 4. Reage ⏳ (so se FINANCEIRO_ATIVO)
  if (FINANCEIRO_ATIVO) await reagir(client, remoteJid, msgId, '⏳');

  // 5. Salva avulso no banco
  await queries.registrarAvulso(grupo.id, jogador.id, avulsoNome, participant, msgId);

  // Busca id do registro para os botoes
  var [rows] = await require('../../../evolution/database/connection').execute(
    'SELECT id FROM mensalidades WHERE grupo_id = ? AND jogador_id = ? AND avulso_nome = ? AND mes_referencia = ? ORDER BY id DESC LIMIT 1',
    [grupo.id, jogador.id, avulsoNome, queries.mesAtual()]
  );
  var mensalidadeId = rows.length > 0 ? rows[0].id : 0;

  // 6. Notifica admins
  var admins = await queries.buscarAdminsDoGrupo(grupo.id);
  var label  = labelPagador(jogador.nome, 'avulso', avulsoNome);
  await notificarAdmins(admins, label, grupo.nome, mensalidadeId);
}

module.exports = { handlePaguei, handleAvulso };
