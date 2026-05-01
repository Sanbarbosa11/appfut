/**
 * index_meta.js — Entry point do AppFut usando Meta WhatsApp Business API
 *
 * Substitui index.js (WPPConnect) sem mudar a logica de negocios.
 *
 * Variaveis de ambiente (.env):
 *   META_PHONE_NUMBER_ID        — ex: 123456789012345
 *   META_ACCESS_TOKEN           — token permanente do System User
 *   META_WEBHOOK_VERIFY_TOKEN   — segredo definido no Meta Dashboard
 *   DB_HOST, DB_USER, DB_PASS, DB_NAME
 *   PORT                        — porta do servidor (default 3000)
 */

require('dotenv').config();

var express = require('express');
var db    = require('../database/connection');

var { client, sendText: metaSendText, sendButtons: metaSendButtons } = require('./whatsapp/metaClient');
var { router: webhookRouter, setHandlers } = require('./whatsapp/webhook');

var { processarComandoGrupo } = require('./commands/grupo');
var { processarComandoAdmin, getGrupoAtivoId, setGrupoAtivo } = require('./commands/admin');
var { confirmar }              = require('./commands/confirmar');
var { cancelar }               = require('./commands/cancelar');
var { lista }                  = require('./commands/lista');
var { enviarMenuJogador, enviarMenuAdmin, enviarCriarPartida } = require('./commands/menu');
var { alertar, agora } = require('./utils/alertar');
var { adicionarAvulso, removerAvulso } = require('./commands/avulso');
var { enviarMenuFinanceiro } = require('../financeiro/menu/menuFinanceiro');
var {
  finPagos, finPendentes, finInadimplentes, finAvulsos,
  finResumo, finConfigurar, finConfirmarPagamento, finRejeitarPagamento, finComandoTexto
} = require('../financeiro/handlers/adminFinanceiro');

// ---------- rate limit para botao "Buscar partida" ----------
var buscarTentativas = {};          // { sender: { count, windowStart } }
var BUSCAR_MAX    = 2;              // respostas antes de bloquear
var BUSCAR_JANELA = 10 * 60 * 1000; // janela de 10 minutos

function usarBuscarPartida(sender) {
  var agora = Date.now();
  var t     = buscarTentativas[sender];
  if (!t || (agora - t.windowStart) >= BUSCAR_JANELA) {
    buscarTentativas[sender] = { count: 1, windowStart: agora };
    return { permitido: true, restante: BUSCAR_MAX - 1 };
  }
  if (t.count >= BUSCAR_MAX) {
    var min = Math.ceil((BUSCAR_JANELA - (agora - t.windowStart)) / 60000);
    return { permitido: false, minutosRestantes: min };
  }
  t.count++;
  return { permitido: true, restante: BUSCAR_MAX - t.count };
}

function resetarBuscarPartida(sender) {
  delete buscarTentativas[sender];
}

// ---------- dedup de mensagens (evita processar duplicatas) ----------
var processadas = new Set();
function dedup(msgId) {
  if (processadas.has(msgId)) return false;
  processadas.add(msgId);
  setTimeout(function() { processadas.delete(msgId); }, 30 * 60 * 1000);
  return true;
}

// ---------- helper: monta fake message para comandos que precisam de message.from ----------
function fakeMensagem(sender, senderName) {
  return {
    id:         'fake_' + Date.now(),
    from:       sender,
    isGroupMsg: false,
    body:       '',
    sender:     { id: sender, pushname: senderName || 'Jogador' }
  };
}

// ---------- registro minimo: salva nome, sem vincular a grupo ----------
async function autoRegistrar(sender, senderName) {
  try {
    await db.execute(
      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)',
      [sender, senderName]
    );
  } catch(e) {
    console.error('[autoRegistrar] Erro:', e);
  }
}

// ---------- verifica vinculo e orienta caso nao esteja cadastrado ----------
var META_NUMERO = process.env.META_BOT_NUMBER || '5511995421741';

async function verificarVinculoOuOrientar(sender, senderName) {
  var [jog] = await db.execute(
    'SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]
  );
  if (jog.length === 0) return false;

  var [vinculo] = await db.execute(
    'SELECT id FROM grupo_jogadores WHERE jogador_id = ? AND ativo = TRUE LIMIT 1',
    [jog[0].id]
  );
  if (vinculo.length > 0) return true; // ja vinculado, pode prosseguir

  // Sem vinculo — busca grupos com partida aberta para mostrar links
  var [grupos] = await db.execute(
    'SELECT g.id, g.nome, g.invite_token FROM grupos g ' +
    'JOIN partidas p ON p.grupo_id = g.id ' +
    'WHERE p.status = "aberta" AND g.ativo = TRUE ' +
    'ORDER BY g.nome ASC'
  );

  var msg = '\ud83d\udc4b Ol\u00e1, ' + senderName + '!\n\n' +
    'Para usar o bot voc\u00ea precisa se cadastrar no seu grupo.\n' +
    'Clique no link do seu grupo abaixo:\n\n';

  if (grupos.length > 0) {
    for (var i = 0; i < grupos.length; i++) {
      // Problema 5: usar invite_token no link \u2014 nao o ID sequencial
      var token = grupos[i].invite_token || grupos[i].id;
      var link = 'https://wa.me/' + META_NUMERO + '?text=entrar%20' + token;
      msg += '\u26bd *' + grupos[i].nome + '*\n' + link + '\n\n';
    }
  } else {
    msg += '_Nenhum grupo com partida aberta no momento._\n\n';
  }

  msg += '_N\u00e3o encontrou seu grupo? Pe\u00e7a o link para o administrador._';

  await metaSendText(sender, msg);
  return false; // bloqueia prosseguimento
}

// ---------- entrar no grupo via link ----------

async function verificarAdminViaWpp(groupWppId, senderCus) {
  return new Promise(function(resolve) {
    var http = require('http');
    var url = 'http://localhost:3001/isAdmin?groupId=' + encodeURIComponent(groupWppId) + '&userId=' + encodeURIComponent(senderCus);
    http.get(url, function(res) {
      var data = '';
      res.on('data', function(d) { data += d; });
      res.on('end', function() {
        try { resolve(JSON.parse(data).isAdmin === true); } catch(e) { resolve(false); }
      });
    }).on('error', function() { resolve(false); });
  });
}

// Problema 5: recebe token aleatorio (hex 32 chars) em vez de ID sequencial.
// Isso impede enumeracao de grupos (entrar 1, entrar 2, entrar 3...).
async function entrarGrupo(sender, senderName, token) {
  try {
    var [grupo] = await db.execute(
      'SELECT id, nome, whatsapp_id FROM grupos WHERE invite_token = ? AND ativo = TRUE', [token]
    );
    if (grupo.length === 0) {
      await metaSendText(sender, '⚠️ Link inválido ou expirado. Peça um novo link ao administrador do grupo.');
      return;
    }

    await db.execute(
      'INSERT IGNORE INTO jogadores (whatsapp_id, nome) VALUES (?, ?)', [sender, senderName]
    );
    var [jog] = await db.execute('SELECT id FROM jogadores WHERE whatsapp_id = ?', [sender]);
    if (jog.length === 0) return;

    await db.execute(
      'INSERT IGNORE INTO grupo_jogadores (grupo_id, jogador_id, ativo) VALUES (?, ?, TRUE)',
      [grupo[0].id, jog[0].id]
    );

    var isAdmin = await verificarAdminViaWpp(grupo[0].whatsapp_id, sender);
    if (!isAdmin) {
      var [adminsCus] = await db.execute(
        'SELECT id FROM admins WHERE grupo_id = ? AND whatsapp_id NOT LIKE "%@lid" LIMIT 1',
        [grupo[0].id]
      );
      if (adminsCus.length === 0) {
        isAdmin = true;
        console.log('[entrarGrupo] Admin por fallback:', sender, 'grupo', grupo[0].id);
      }
    }

    if (isAdmin) {
      await db.execute('DELETE FROM admins WHERE grupo_id = ? AND whatsapp_id LIKE "%@lid"', [grupo[0].id]);
      await db.execute('INSERT IGNORE INTO admins (grupo_id, whatsapp_id) VALUES (?, ?)', [grupo[0].id, sender]);
      console.log('[entrarGrupo] Admin registrado:', sender, 'grupo', grupo[0].id);
    }

    console.log('[entrarGrupo]', sender, '→ grupo', grupo[0].id, grupo[0].nome, isAdmin ? '(admin)' : '');

    // Define grupo ativo na sessão em memória e persiste no banco
    setGrupoAtivo(sender, grupo[0].id, grupo[0].nome);
    await db.execute('UPDATE jogadores SET grupo_preferido_id = ? WHERE whatsapp_id = ?', [grupo[0].id, sender]);

    await metaSendButtons(sender,
      '✅ *Pronto, ' + senderName + '!*\n\n' +
      'Você está cadastrado no grupo *' + grupo[0].nome + '*. ⚽\n\n' +
      'Clique abaixo para ver o status do jogo:',
      [{ id: 'buscar_partida', title: '⚽ Buscar partida' }]
    );
  } catch(e) {
    console.error('[entrarGrupo] Erro:', e);
  }
}

// ---------- handlers ----------

async function onMessage(message) {
  try {
    if (!message.sender) return;
    if (!dedup(message.id)) return;

    var isGroup    = message.isGroupMsg;
    var text       = (message.body || '').trim().toLowerCase();
    var sender     = message.sender.id;
    var senderName = message.sender.pushname || 'Jogador';

    if (isGroup) {
      await processarComandoGrupo(client, message);
      return;
    }

    // Problema 5: vínculo via token hex (ex: "entrar a3f9...") — não mais ID sequencial
    if (text.startsWith('entrar ')) {
      var entrarToken = text.split(' ').slice(1).join(' ').trim();
      if (entrarToken) {
        await entrarGrupo(sender, senderName, entrarToken);
        return;
      }
    }

    // Registra nome e verifica vinculo ao grupo — bloqueia se nao cadastrado
    await autoRegistrar(sender, senderName);
    var vinculado = await verificarVinculoOuOrientar(sender, senderName);
    if (!vinculado) return;

    // Restaura grupo preferido do jogador se a sessao em memoria expirou (ex: reinicio)
    if (!getGrupoAtivoId(sender)) {
      try {
        var [jPref] = await db.execute(
          'SELECT j.grupo_preferido_id, g.nome AS grupo_nome ' +
          'FROM jogadores j LEFT JOIN grupos g ON g.id = j.grupo_preferido_id ' +
          'WHERE j.whatsapp_id = ? AND j.grupo_preferido_id IS NOT NULL AND (g.ativo = TRUE OR g.ativo IS NULL)',
          [sender]
        );
        if (jPref.length > 0 && jPref[0].grupo_preferido_id) {
          setGrupoAtivo(sender, jPref[0].grupo_preferido_id, jPref[0].grupo_nome || '');
        }
      } catch(e) { /* nao bloquear fluxo principal */ }
    }

    // Admin financeiro — menu ou subcomando
    if (text === 'admin financeiro') {
      await enviarMenuFinanceiro(sender);
      return;
    }
    if (text.startsWith('admin financeiro ')) {
      var finArgs = text.slice('admin financeiro '.length).trim().split(/\s+/);
      await finComandoTexto(sender, finArgs);
      return;
    }

    // Admin com argumentos → processar comando direto
    if (text.startsWith('admin ')) {
      await processarComandoAdmin(client, message, sender, text);
      return;
    }

    // Admin sozinho → menu admin interativo
    if (text === 'admin') {
      await enviarMenuAdmin(client, sender);
      return;
    }

    // Avulsos
    if (text.startsWith('avulso ')) {
      var nomeAvulso = (message.body || '').trim().slice(7).trim();
      if (nomeAvulso) await adicionarAvulso(client, message, sender, nomeAvulso);
      return;
    }
    if (text.startsWith('remover avulso ')) {
      var nomeRemover = (message.body || '').trim().slice(15).trim();
      if (nomeRemover) await removerAvulso(client, message, sender, nomeRemover);
      return;
    }

    // Comandos de texto (backward compat)
    if (text === 'confirmar') {
      await confirmar(client, message, sender, senderName);
      return;
    }
    if (text === 'cancelar') {
      await cancelar(client, message, sender);
      return;
    }
    if (text === 'lista') {
      await lista(client, message, sender);
      return;
    }

    // Qualquer outra mensagem → menu jogador (reseta contador de busca)
    resetarBuscarPartida(sender);
    await enviarMenuJogador(client, sender, senderName);

  } catch(e) {
    console.error('[onMessage] Erro:', e);
  }
}

async function onPollResponse(response, sender, opcao) {
  try {
    var chave = sender + (response.id || '') + opcao;
    if (!dedup(chave)) return;

    var selectedId = (response.selectedOptions && response.selectedOptions[0] && response.selectedOptions[0].id) || '';
    var senderName = response.senderName || 'Jogador';
    var msg        = fakeMensagem(sender, senderName);

    if (selectedId === 'buscar_partida') {
      var buscarLimite = usarBuscarPartida(sender);
      if (!buscarLimite.permitido) {
        await metaSendText(sender,
          '⏳ Você já verificou 2x recentemente.\n\n' +
          'Tente em ~' + buscarLimite.minutosRestantes + ' min ou aguarde o adm criar a partida!'
        );
      } else {
        // mostrarRetry=true se ainda tem tentativa sobrando; false na ultima
        await enviarMenuJogador(client, sender, senderName, buscarLimite.restante > 0);
      }

    } else if (selectedId === 'confirmar') {
      await confirmar(client, msg, sender, senderName);

    } else if (selectedId === 'cancelar') {
      await cancelar(client, msg, sender);

    } else if (selectedId === 'avulso') {
      await adicionarAvulso(client, msg, sender, senderName);

    } else if (selectedId === 'lista') {
      await lista(client, msg, sender);

    } else if (selectedId === 'admin_status') {
      await processarComandoAdmin(client, msg, sender, 'admin status');

    } else if (selectedId === 'admin_fechar') {
      await processarComandoAdmin(client, msg, sender, 'admin fechar');

    } else if (selectedId === 'admin_participantes') {
      await processarComandoAdmin(client, msg, sender, 'admin participantes');

    } else if (selectedId === 'admin_ativar_todos') {
      await processarComandoAdmin(client, msg, sender, 'admin ativar todos');

    } else if (selectedId === 'admin_desativar_todos') {
      await processarComandoAdmin(client, msg, sender, 'admin desativar todos');

    } else if (selectedId === 'admin_link') {
      await processarComandoAdmin(client, msg, sender, 'admin link');

    } else if (selectedId === 'admin_sortear') {
      await processarComandoAdmin(client, msg, sender, 'admin sortear');

    } else if (selectedId === 'admin_criar_ajuda') {
      await metaSendText(sender,
        '\u2795 *Como criar uma partida*\n\n' +
        'Digite no privado:\n' +
        'admin criar DD/MM [HH:MM] [vagas]\n\n' +
        'Exemplos:\n' +
        '\u2022 admin criar 25/04\n' +
        '\u2022 admin criar 25/04 20:00 14\n\n' +
        'Somente administradores do grupo podem criar partidas.'
      );

    } else if (selectedId === 'fin_pagos') {
      await finPagos(sender);

    } else if (selectedId === 'fin_pendentes') {
      await finPendentes(sender);

    } else if (selectedId === 'fin_inadimplentes') {
      await finInadimplentes(sender);

    } else if (selectedId === 'fin_avulsos') {
      await finAvulsos(sender);

    } else if (selectedId === 'fin_resumo') {
      await finResumo(sender);

    } else if (selectedId === 'fin_configurar') {
      await finConfigurar(sender);

    } else if (selectedId.startsWith('fin_confirmar_')) {
      var finConfId = parseInt(selectedId.replace('fin_confirmar_', ''), 10);
      await finConfirmarPagamento(sender, finConfId);

    } else if (selectedId.startsWith('fin_rejeitar_')) {
      var finRejId = parseInt(selectedId.replace('fin_rejeitar_', ''), 10);
      await finRejeitarPagamento(sender, finRejId);

    } else {
      // ID desconhecido → volta pro menu
      await enviarMenuJogador(client, sender, senderName);
    }

  } catch(e) {
    console.error('[onPollResponse] Erro:', e);
  }
}

// Meta API nao envia eventos de participantes diretamente
// Usamos registro progressivo: ao receber mensagem de numero desconhecido,
// o bot cadastra o jogador automaticamente (ver onMessage).
async function onParticipantsChanged(event) {
  try {
    console.log('[Participants] Evento:', JSON.stringify(event));
  } catch(e) {
    console.error('[onParticipantsChanged] Erro:', e);
  }
}

// ── Monitor de saude do Evolution (fallback quando canal principal de alertas cai) ──
var EVOLUTION_HEALTH_URL       = process.env.EVOLUTION_HEALTH_URL || 'http://127.0.0.1:3002/health';
var ALERT_ADMIN_FALLBACK        = process.env.ALERT_ADMIN_NUMBER || '';
var _evoFalhas = 0;
var _evoEstado = null; // null | 'ok' | 'falhou'

async function _checarEvolution() {
  try {
    var ctrl = new AbortController();
    var tid  = setTimeout(function() { ctrl.abort(); }, 5000);
    var res  = await fetch(EVOLUTION_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error('status ' + res.status);
    if (_evoEstado === 'falhou') {
      alertar('🟢 *AppFut Evolution Bot voltou!*\n⏰ ' + agora() + '\n✅ Canal de alertas normalizado.').catch(function(){});
    }
    _evoFalhas = 0;
    _evoEstado = 'ok';
  } catch(e) {
    _evoFalhas++;
    if (_evoFalhas >= 2 && _evoEstado !== 'falhou') {
      _evoEstado = 'falhou';
      if (ALERT_ADMIN_FALLBACK) {
        metaSendText(ALERT_ADMIN_FALLBACK,
          '🔴 *AppFut Evolution Bot — Fora do ar!*\n⏰ ' + agora() + '\n⚠️ Canal principal de alertas indisponível.\n💡 pm2 logs evolution-webhook'
        ).catch(function(){});
      }
    }
  }
}

// ---------- servidor Express ----------

function start() {
  var app  = express();
  var PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Injeta handlers no webhook
  setHandlers({
    onMessage:             onMessage,
    onPollResponse:        onPollResponse,
    onParticipantsChanged: onParticipantsChanged
  });

  // Rotas do webhook
  app.use('/', webhookRouter);

  // Health check
  app.get('/health', function(req, res) {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // QR Code do WPPConnect — protegido por token
  app.get('/wpp-qr', function(req, res) {
    var token = process.env.QR_SECRET_TOKEN || 'appfut_qr';
    if (req.query.token !== token) {
      return res.status(403).send('Acesso negado');
    }
    var fs = require('fs');
    var qrPath = '/tmp/wpp_qr.png';
    if (!fs.existsSync(qrPath)) {
      return res.status(404).send('QR nao disponivel no momento. Bot pode ja estar conectado.');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(qrPath);
  });

  app.listen(PORT, function() {
    console.log('AppFut Bot (Meta API) rodando na porta ' + PORT);
    console.log('Webhook: http://SEU_DOMINIO/webhook');
    console.log('Phone Number ID:', process.env.META_PHONE_NUMBER_ID || '(nao configurado)');
    setInterval(_checarEvolution, 2 * 60 * 1000);
  });

  process.on('uncaughtException', function(err) {
    console.error('[crash] uncaughtException:', err);
    var timeout = setTimeout(function() { process.exit(1); }, 5000);
    alertar('🔴 *AppFut Meta Bot — Erro crítico!*\n⏰ ' + agora() + '\n⚠️ ' + err.message + '\nO PM2 irá reiniciar automaticamente.')
      .catch(function(){})
      .finally(function() { clearTimeout(timeout); process.exit(1); });
  });

  process.on('unhandledRejection', function(reason) {
    console.error('[crash] unhandledRejection:', reason);
  });

  console.log('AppFut Meta Bot pronto.');
}

start();
