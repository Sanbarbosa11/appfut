/**
 * menu.js — Menus interativos via sendButtons / sendList (Meta API)
 *
 * enviarMenuJogador  → botoes com contexto da partida
 * enviarMenuAdmin    → lista de acoes do admin
 * enviarCriarPartida → botoes para criar hoje / amanha / sintaxe
 */

var { sendList, sendButtons, sendText } = require('../whatsapp/metaClient');
var db = require('../../database/connection');
var { montarListaCompleta } = require('../utils/listaHelper');
var { getGrupoAtivoId } = require('./admin');

var DIAS = [
  'domingo', 'segunda-feira', 'terca-feira',
  'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'
];

function formatarData(dataPartida) {
  // Evita off-by-one de timezone: trata como data local
  var d = new Date(dataPartida);
  d = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  var dia  = String(d.getDate()).padStart(2, '0');
  var mes  = String(d.getMonth() + 1).padStart(2, '0');
  return DIAS[d.getDay()] + ', ' + dia + '/' + mes;
}

function formatarHorario(h) {
  if (!h) return '';
  return String(h).replace(/:(\d{2})$/, '');
}

function dataParaDDMM(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

// ─── Menu Jogador ────────────────────────────────────────────────────────────

async function enviarMenuJogador(client, sender, senderName, mostrarRetry) {
  var nome     = senderName || 'Jogador';
  var corpo    = null;
  var temPartida = false;

  try {
    var grupoHint = getGrupoAtivoId(sender);
    var queryArgs = grupoHint ? [sender, grupoHint] : [sender];
    var grupoFiltro = grupoHint ? 'AND p.grupo_id = ?' : '';

    var [rows] = await db.execute(
      'SELECT p.id, p.data_partida, p.max_jogadores,' +
      '       g.id AS grupo_id, g.nome AS grupo_nome, g.horario_inicio, g.horario_fim' +
      ' FROM partidas p' +
      ' JOIN grupos g           ON p.grupo_id  = g.id' +
      ' JOIN grupo_jogadores gj ON gj.grupo_id = g.id' +
      ' JOIN jogadores j        ON j.id        = gj.jogador_id' +
      ' WHERE p.status = \'aberta\'' +
      '   AND gj.ativo = TRUE' +
      '   AND j.whatsapp_id = ?' +
      '   ' + grupoFiltro +
      ' ORDER BY p.data_partida ASC LIMIT 1',
      queryArgs
    );

    if (rows.length > 0) {
      var p = rows[0];
      corpo = await montarListaCompleta(
        p.id, p.grupo_id, p.grupo_nome, p.data_partida,
        p.max_jogadores, p.horario_inicio, p.horario_fim, false
      );
      temPartida = true;
    }
  } catch (e) {
    console.error('[menu] Erro ao buscar partida:', e.message);
  }

  if (!temPartida) {
    if (mostrarRetry === false) {
      return sendText(
        sender,
        'Fala, ' + nome + '! \u26bd\n\nNenhuma partida aberta no momento. Aguarde o adm criar!'
      );
    }
    return sendButtons(
      sender,
      'Fala, ' + nome + '! \u26bd\n\nNenhuma partida aberta no momento. Aguarde o adm criar!',
      [{ id: 'buscar_partida', title: '\u26bd Buscar partida' }]
    );
  }

  return sendButtons(
    sender,
    'Fala, ' + nome + '! \u26bd\n\n' + corpo,
    [
      { id: 'confirmar', title: '\u2705 Confirmar'  },
      { id: 'cancelar',  title: '\u274c Cancelar'   },
      { id: 'avulso',    title: '\ud83d\udd38 Sou avulso' }
    ]
  );
}

// ─── Menu Admin ──────────────────────────────────────────────────────────────

async function enviarMenuAdmin(client, sender) {
  return sendList(
    sender,
    '\u26bd AppFut \u2014 Admin',
    'Painel do administrador',
    'Ver op\u00e7\u00f5es',
    [
      {
        title: 'Partida',
        rows: [
          { id: 'admin_status',     title: '\ud83d\udcca Status',         description: 'Ver status da partida atual' },
          { id: 'admin_fechar',     title: '\ud83d\udd12 Fechar partida', description: 'Encerrar a partida aberta' },
          { id: 'admin_criar_ajuda',title: '\u2795 Criar partida',        description: 'Criar nova partida rapidamente' },
          { id: 'admin_link',       title: '\ud83d\udd17 Link convite',    description: 'Reenviar link de cadastro do grupo' },
          { id: 'admin_sortear',    title: '\ud83c\udfb2 Sortear times',   description: 'Sortear dois times com confirmados' }
        ]
      },
      {
        title: 'Jogadores',
        rows: [
          { id: 'admin_participantes',   title: '\ud83d\udc65 Participantes',  description: 'Listar jogadores do grupo' },
          { id: 'admin_ativar_todos',    title: '\u2705 Ativar todos',   description: 'Marcar todos como ativos' },
          { id: 'admin_desativar_todos', title: '\u274c Desativar todos', description: 'Marcar todos como inativos' }
        ]
      }
    ]
  );
}

// ─── Criar Partida (botoes rapidos) ──────────────────────────────────────────

async function enviarCriarPartida(client, sender) {
  var hoje   = new Date();
  var amanha = new Date(hoje.getTime() + 24 * 60 * 60 * 1000);
  var dHoje   = dataParaDDMM(hoje);
  var dAmanha = dataParaDDMM(amanha);

  return sendButtons(
    sender,
    '\u2795 *Criar nova partida*\n\n' +
    'Escolha uma data r\u00e1pida ou use o comando manual:\n' +
    'admin criar DD/MM [HH:MM] [vagas]',
    [
      { id: 'admin_criar_hoje',   title: '\ud83d\udcc5 Hoje (' + dHoje + ')'    },
      { id: 'admin_criar_amanha', title: '\ud83d\udcc5 Amanh\u00e3 (' + dAmanha + ')' },
      { id: 'admin_criar_manual', title: '\u270f\ufe0f Ver sintaxe' }
    ]
  );
}

module.exports = { enviarMenuJogador, enviarMenuAdmin, enviarCriarPartida };
