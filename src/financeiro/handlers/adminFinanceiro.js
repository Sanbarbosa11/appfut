// =============================================================
// adminFinanceiro.js — Acoes do admin no menu financeiro (Meta)
//
// Cada funcao corresponde a um item do menuFinanceiro.js.
// Recebe o whatsapp_id do admin e devolve texto formatado.
//
// Integracao com index_meta.js:
//   case 'fin_pagos':         await finPagos(sender); break;
//   case 'fin_pendentes':     await finPendentes(sender); break;
//   case 'fin_inadimplentes': await finInadimplentes(sender); break;
//   case 'fin_avulsos':       await finAvulsos(sender); break;
//   case 'fin_resumo':        await finResumo(sender); break;
//   case 'fin_configurar':    await finConfigurar(sender); break;
//   selectedId.startsWith('fin_confirmar_') → await finConfirmarPagamento(sender, id)
//   selectedId.startsWith('fin_rejeitar_')  → await finRejeitarPagamento(sender, id)
// =============================================================

var queries       = require('../db/queries');
var { sendText }  = require('../../bot/whatsapp/metaClient');
var createEvolutionClient = require('../../../evolution/client/evolutionClient');

var instanceName = process.env.PILOT_INSTANCE_NAME || 'appfut-piloto';

// Formata data DD/MM HH:MM
function formatarDataHora(d) {
  if (!d) return '—';
  var dt = new Date(d);
  return String(dt.getDate()).padStart(2, '0') + '/' +
         String(dt.getMonth() + 1).padStart(2, '0') + ' ' +
         String(dt.getHours()).padStart(2, '0') + ':' +
         String(dt.getMinutes()).padStart(2, '0');
}

// Busca grupo do admin — admin pode estar em varios grupos,
// usa o mesmo sistema de sessao de adminSessoes do admin.js
var db = require('../../database/connection');
var { getGrupoAtivoId } = require('../../bot/commands/admin');

// Busca o grupo ativo do admin usando a sessao existente do admin.js.
// Se admin gerencia só 1 grupo, retorna ele. Se gerencia varios,
// usa o que estiver ativo na sessao (mesmo que já selecionou com "admin grupo X").
async function buscarGrupoDoAdmin(adminWid) {
  var grupoId = getGrupoAtivoId(adminWid);
  console.log('[financeiro] buscarGrupoDoAdmin — admin:', adminWid, 'grupoId sessao:', grupoId);

  if (grupoId) {
    // Valida que o admin realmente pertence a esse grupo (seguranca)
    var [rows] = await db.execute(
      'SELECT g.id, g.nome, g.valor_mensalidade, g.pix_chave ' +
      'FROM grupos g JOIN admins a ON a.grupo_id = g.id ' +
      'WHERE g.id = ? AND a.whatsapp_id = ?',
      [grupoId, adminWid]
    );
    console.log('[financeiro] grupo encontrado pela sessao:', rows.length > 0 ? rows[0].nome : 'nenhum');
    if (rows.length > 0) return rows[0];
  }

  // Fallback: admin tem so 1 grupo — retorna direto sem sessao
  var [todos] = await db.execute(
    'SELECT g.id, g.nome, g.valor_mensalidade, g.pix_chave ' +
    'FROM grupos g JOIN admins a ON a.grupo_id = g.id ' +
    'WHERE a.whatsapp_id = ?',
    [adminWid]
  );
  console.log('[financeiro] fallback — grupos encontrados:', todos.length);
  if (todos.length === 1) return todos[0];

  // Admin de multiplos grupos sem sessao ativa
  return null;
}

// ─── Pagos ───────────────────────────────────────────────────────────────────

async function finPagos(sender) {
  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) { await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.'); return; }

  var pagos = await queries.listarPagos(grupo.id);
  if (pagos.length === 0) {
    await sendText(sender, '📋 *Pagos — ' + grupo.nome + '*\n\nNenhum pagamento confirmado este mês.');
    return;
  }

  var linhas = pagos.map(function(p, i) {
    var nome = p.tipo === 'avulso' ? p.avulso_nome + ' *(avulso)*' : p.jogador_nome;
    return (i + 1) + '. ' + nome + ' — ' + formatarDataHora(p.pago_em);
  });

  await sendText(sender,
    '✅ *Pagos — ' + grupo.nome + '*\n' +
    '_Mês: ' + queries.mesAtual().substring(0, 7) + '_\n\n' +
    linhas.join('\n') + '\n\n' +
    'Total: ' + pagos.length
  );
}

// ─── Pendentes ───────────────────────────────────────────────────────────────

async function finPendentes(sender) {
  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) { await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.'); return; }

  var pendentes = await queries.listarPendentes(grupo.id);
  if (pendentes.length === 0) {
    await sendText(sender, '⏳ *Pendentes — ' + grupo.nome + '*\n\nNenhum comprovante aguardando confirmação.');
    return;
  }

  var linhas = pendentes.map(function(p, i) {
    var nome = p.tipo === 'avulso' ? p.avulso_nome + ' *(avulso)*' : p.jogador_nome;
    return (i + 1) + '. ' + nome + ' — enviado ' + formatarDataHora(p.criado_em);
  });

  await sendText(sender,
    '⏳ *Pendentes — ' + grupo.nome + '*\n' +
    '_Aguardando sua confirmação:_\n\n' +
    linhas.join('\n') + '\n\n' +
    'Para confirmar: *admin pagar Nome*\n' +
    'Para rejeitar: *admin rejeitar Nome*'
  );
}

// ─── Inadimplentes ───────────────────────────────────────────────────────────

async function finInadimplentes(sender) {
  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) { await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.'); return; }

  var lista = await queries.listarInadimplentes(grupo.id);
  if (lista.length === 0) {
    await sendText(sender, '🎉 *Inadimplentes — ' + grupo.nome + '*\n\nTodos enviaram comprovante!');
    return;
  }

  var linhas = lista.map(function(j, i) { return (i + 1) + '. ' + j.nome; });

  await sendText(sender,
    '❌ *Inadimplentes — ' + grupo.nome + '*\n' +
    '_Não enviaram nada este mês:_\n\n' +
    linhas.join('\n') + '\n\n' +
    'Total: ' + lista.length
  );
}

// ─── Avulsos ─────────────────────────────────────────────────────────────────

async function finAvulsos(sender) {
  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) { await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.'); return; }

  var pagos     = await queries.listarPagos(grupo.id);
  var pendentes = await queries.listarPendentes(grupo.id);

  var avulsosPagos     = pagos.filter(function(p)     { return p.tipo === 'avulso'; });
  var avulsosPendentes = pendentes.filter(function(p) { return p.tipo === 'avulso'; });

  if (avulsosPagos.length === 0 && avulsosPendentes.length === 0) {
    await sendText(sender, '🎯 *Avulsos — ' + grupo.nome + '*\n\nNenhum avulso externo este mês.');
    return;
  }

  var texto = '🎯 *Avulsos — ' + grupo.nome + '*\n\n';

  if (avulsosPagos.length > 0) {
    texto += '✅ *Confirmados:*\n';
    avulsosPagos.forEach(function(p, i) {
      texto += (i + 1) + '. ' + p.avulso_nome + ' — ' + formatarDataHora(p.pago_em) + '\n';
    });
    texto += '\n';
  }

  if (avulsosPendentes.length > 0) {
    texto += '⏳ *Pendentes:*\n';
    avulsosPendentes.forEach(function(p, i) {
      texto += (i + 1) + '. ' + p.avulso_nome + ' — enviado ' + formatarDataHora(p.criado_em) + '\n';
    });
  }

  await sendText(sender, texto.trim());
}

// ─── Resumo do mes ───────────────────────────────────────────────────────────

async function finResumo(sender) {
  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) { await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.'); return; }

  var r   = await queries.resumoMes(grupo.id);
  var mes = queries.mesAtual().substring(0, 7);
  var pix = grupo.pix_chave ? '\n🔑 PIX: ' + grupo.pix_chave : '';

  await sendText(sender,
    '📊 *Resumo — ' + grupo.nome + '*\n' +
    '_Mês: ' + mes + '_\n\n' +
    '👥 Membros ativos: ' + r.totalAtivos + '\n' +
    '✅ Pagos: ' + r.totalPagos + '\n' +
    '⏳ Pendentes (comprovante enviado): ' + r.totalPendentes + '\n' +
    '❌ Não enviaram nada: ' + r.totalInadimplentes + '\n\n' +
    (r.valor > 0
      ? '💵 Valor mensalidade: R$' + r.valor.toFixed(2) + '\n' +
        '💰 Esperado: R$' + r.esperado.toFixed(2) + '\n' +
        '✅ Recebido: R$' + r.recebido.toFixed(2) + '\n' +
        '⚠️ A receber: R$' + (r.esperado - r.recebido).toFixed(2)
      : '⚙️ Configure o valor: *admin financeiro valor 50*') +
    pix
  );
}

// ─── Configurar ──────────────────────────────────────────────────────────────

async function finConfigurar(sender) {
  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) {
    await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.');
    return;
  }

  var valorStr = grupo.valor_mensalidade ? 'R$' + parseFloat(grupo.valor_mensalidade).toFixed(2) : '_não configurado_';
  var pixStr   = grupo.pix_chave || '_não configurado_';

  await sendText(sender,
    '⚙️ *Config financeira — ' + grupo.nome + '*\n\n' +
    '💵 Mensalidade atual: ' + valorStr + '\n' +
    '🔑 Chave PIX atual: ' + pixStr + '\n\n' +
    'Para alterar:\n' +
    '👉 *admin financeiro valor 50* — define mensalidade R$50\n' +
    '👉 *admin financeiro pix 11999999999* — define chave PIX'
  );
}

// ─── Confirmar pagamento (botao direto da notificacao) ───────────────────────

async function finConfirmarPagamento(sender, mensalidadeId) {
  var [rows] = await db.execute(
    'SELECT m.id, m.status, m.tipo, m.avulso_nome, m.enviado_por, ' +
    '       j.nome AS jogador_nome, g.nome AS grupo_nome, g.whatsapp_id AS grupo_wid ' +
    'FROM mensalidades m ' +
    'LEFT JOIN jogadores j ON j.id = m.jogador_id ' +
    'JOIN grupos g ON g.id = m.grupo_id ' +
    'WHERE m.id = ?',
    [mensalidadeId]
  );

  if (rows.length === 0) {
    await sendText(sender, '❌ Registro não encontrado.');
    return;
  }

  var m = rows[0];

  if (m.status === 'pago') {
    await sendText(sender, '✅ Este pagamento já foi confirmado.');
    return;
  }

  await queries.confirmarPagamento(mensalidadeId, sender);

  var nomeExibir = m.tipo === 'avulso' ? m.avulso_nome + ' (avulso)' : m.jogador_nome;

  // Confirmacao para o admin
  await sendText(sender, '✅ Pagamento de *' + nomeExibir + '* confirmado!');

  // Reage ✅ na mensagem original do grupo via Evolution
  if (m.enviado_por && m.grupo_wid) {
    try {
      var client = createEvolutionClient();
      // A mensalidade armazena o msgId do comprovante em comprovante_msg_id
      var [msgRow] = await db.execute(
        'SELECT comprovante_msg_id FROM mensalidades WHERE id = ?', [mensalidadeId]
      );
      if (msgRow.length > 0 && msgRow[0].comprovante_msg_id) {
        await client.message.sendReaction(
          instanceName, m.grupo_wid, msgRow[0].comprovante_msg_id, '✅'
        );
      }
    } catch (e) {
      console.error('[financeiro] Erro ao reagir no grupo:', e.message);
    }
  }
}

// ─── Rejeitar pagamento ───────────────────────────────────────────────────────

async function finRejeitarPagamento(sender, mensalidadeId) {
  var [rows] = await db.execute(
    'SELECT m.id, m.status, m.tipo, m.avulso_nome, m.enviado_por, ' +
    '       j.nome AS jogador_nome, g.nome AS grupo_nome, g.whatsapp_id AS grupo_wid ' +
    'FROM mensalidades m ' +
    'LEFT JOIN jogadores j ON j.id = m.jogador_id ' +
    'JOIN grupos g ON g.id = m.grupo_id ' +
    'WHERE m.id = ?',
    [mensalidadeId]
  );

  if (rows.length === 0) {
    await sendText(sender, '❌ Registro não encontrado.');
    return;
  }

  var m = rows[0];
  await queries.rejeitarPagamento(mensalidadeId, sender);

  var nomeExibir = m.tipo === 'avulso' ? m.avulso_nome + ' (avulso)' : m.jogador_nome;

  await sendText(sender, '❌ Pagamento de *' + nomeExibir + '* rejeitado.');

  // Reage ❌ na mensagem original do grupo
  if (m.grupo_wid) {
    try {
      var client = createEvolutionClient();
      var [msgRow] = await db.execute(
        'SELECT comprovante_msg_id FROM mensalidades WHERE id = ?', [mensalidadeId]
      );
      if (msgRow.length > 0 && msgRow[0].comprovante_msg_id) {
        await client.message.sendReaction(
          instanceName, m.grupo_wid, msgRow[0].comprovante_msg_id, '❌'
        );
      }
    } catch (e) {
      console.error('[financeiro] Erro ao reagir no grupo:', e.message);
    }
  }
}

// ─── Comandos de texto: admin financeiro valor / admin financeiro pix ─────────

async function finComandoTexto(sender, args) {
  // args = ['valor', '50'] ou ['pix', '11999999999']
  var sub = (args[0] || '').toLowerCase();

  var grupo = await buscarGrupoDoAdmin(sender);
  if (!grupo) { await sendText(sender, '❌ Você não é admin de nenhum grupo.\nSe gerencia vários grupos, use *admin grupo NOME* para selecionar o ativo.'); return; }

  if (sub === 'valor') {
    var valor = parseFloat(args[1]);
    if (isNaN(valor) || valor <= 0) {
      await sendText(sender, '❌ Informe um valor válido. Ex: *admin financeiro valor 50*');
      return;
    }
    await queries.salvarConfig(grupo.id, 'valor_mensalidade', valor);
    await sendText(sender, '✅ Mensalidade definida: R$' + valor.toFixed(2));
    return;
  }

  if (sub === 'pix') {
    var chave = (args[1] || '').trim();
    if (!chave) {
      await sendText(sender, '❌ Informe a chave PIX. Ex: *admin financeiro pix 11999999999*');
      return;
    }
    await queries.salvarConfig(grupo.id, 'pix_chave', chave);
    await sendText(sender, '✅ Chave PIX salva: ' + chave);
    return;
  }

  if (sub === 'pagar') {
    // admin financeiro pagar Nome — confirmacao manual por texto
    var nome = args.slice(1).join(' ').trim();
    if (!nome) { await sendText(sender, '❌ Informe o nome. Ex: *admin financeiro pagar João*'); return; }
    var mes = queries.mesAtual();
    var [pend] = await db.execute(
      'SELECT m.id, j.nome AS jnome, m.avulso_nome, m.tipo ' +
      'FROM mensalidades m LEFT JOIN jogadores j ON j.id = m.jogador_id ' +
      'WHERE m.grupo_id = ? AND m.mes_referencia = ? AND m.status = "pendente" ' +
      'AND (LOWER(j.nome) LIKE ? OR LOWER(m.avulso_nome) LIKE ?)',
      [grupo.id, mes, '%' + nome.toLowerCase() + '%', '%' + nome.toLowerCase() + '%']
    );
    if (pend.length === 0) {
      await sendText(sender, '❌ Nenhum pendente encontrado com o nome "' + nome + '".');
      return;
    }
    var alvo = pend[0];
    await finConfirmarPagamento(sender, alvo.id);
    return;
  }

  if (sub === 'rejeitar') {
    var nomeRej = args.slice(1).join(' ').trim();
    if (!nomeRej) { await sendText(sender, '❌ Informe o nome. Ex: *admin financeiro rejeitar João*'); return; }
    var mesRej = queries.mesAtual();
    var [pendRej] = await db.execute(
      'SELECT m.id FROM mensalidades m LEFT JOIN jogadores j ON j.id = m.jogador_id ' +
      'WHERE m.grupo_id = ? AND m.mes_referencia = ? AND m.status = "pendente" ' +
      'AND (LOWER(j.nome) LIKE ? OR LOWER(m.avulso_nome) LIKE ?)',
      [grupo.id, mesRej, '%' + nomeRej.toLowerCase() + '%', '%' + nomeRej.toLowerCase() + '%']
    );
    if (pendRej.length === 0) {
      await sendText(sender, '❌ Nenhum pendente encontrado com o nome "' + nomeRej + '".');
      return;
    }
    await finRejeitarPagamento(sender, pendRej[0].id);
    return;
  }

  // Sem subcomando valido → abre menu
  var { enviarMenuFinanceiro } = require('../menu/menuFinanceiro');
  await enviarMenuFinanceiro(sender);
}

module.exports = {
  finPagos,
  finPendentes,
  finInadimplentes,
  finAvulsos,
  finResumo,
  finConfigurar,
  finConfirmarPagamento,
  finRejeitarPagamento,
  finComandoTexto
};
