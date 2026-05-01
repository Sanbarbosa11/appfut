// =============================================================
// menuFinanceiro.js — Monta e envia o menu financeiro via Meta
//
// Abre com: admin financeiro (texto) no privado do admin
// Usa sendList igual ao menu admin existente em src/bot/commands/menu.js
// =============================================================

var { sendList } = require('../../bot/whatsapp/metaClient');

async function enviarMenuFinanceiro(sender) {
  return sendList(
    sender,
    '💰 AppFut — Financeiro',
    'Gestão de mensalidades',
    'Ver opções',
    [
      {
        title: 'Pagamentos',
        rows: [
          { id: 'fin_pagos',         title: '✅ Pagos',              description: 'Quem confirmou mensalidade este mês' },
          { id: 'fin_pendentes',     title: '⏳ Pendentes',          description: 'Enviaram comprovante, aguardando confirmação' },
          { id: 'fin_inadimplentes', title: '❌ Inadimplentes',      description: 'Não enviaram nada ainda' },
          { id: 'fin_avulsos',       title: '🎯 Avulsos',      description: 'Avulsos externos que pagaram' }
        ]
      },
      {
        title: 'Caixa',
        rows: [
          { id: 'fin_resumo',        title: '📊 Resumo do mês', description: 'Total arrecadado, pagos e pendentes' },
          { id: 'fin_configurar',    title: '⚙️ Configurar',   description: 'Valor mensalidade e chave PIX do grupo' }
        ]
      }
    ]
  );
}

module.exports = { enviarMenuFinanceiro };
