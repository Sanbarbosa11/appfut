// =============================================================
// queries.js — Todas as queries SQL do módulo financeiro
//
// Centraliza o acesso ao banco para facilitar manutenção:
// se precisar mudar uma query, muda aqui e afeta tudo.
// =============================================================

var db = require('../../database/connection');

// Retorna o mes_referencia do mes atual como DATE (ex: 2026-05-01)
function mesAtual() {
  var d = new Date();
  var mes = String(d.getMonth() + 1).padStart(2, '0');
  return d.getFullYear() + '-' + mes + '-01';
}

// Busca jogador pelo whatsapp_id
async function buscarJogador(whatsappId) {
  var [rows] = await db.execute(
    'SELECT id, nome FROM jogadores WHERE whatsapp_id = ?',
    [whatsappId]
  );
  return rows[0] || null;
}

// Busca grupo pelo whatsapp_id (grupo do Evolution)
async function buscarGrupo(whatsappId) {
  var [rows] = await db.execute(
    'SELECT id, nome, valor_mensalidade, pix_chave, dia_vencimento FROM grupos WHERE whatsapp_id = ?',
    [whatsappId]
  );
  return rows[0] || null;
}

// Verifica se jogador ja tem mensalidade pendente/paga no mes
async function buscarMensalidadeExistente(grupoId, jogadorId, mes) {
  var [rows] = await db.execute(
    'SELECT id, status FROM mensalidades WHERE grupo_id = ? AND jogador_id = ? AND mes_referencia = ?',
    [grupoId, jogadorId, mes]
  );
  return rows[0] || null;
}

// Registra comprovante de mensalista (!paguei)
async function registrarPaguei(grupoId, jogadorId, enviado_por, msgId) {
  var mes = mesAtual();
  await db.execute(
    'INSERT INTO mensalidades (grupo_id, jogador_id, tipo, enviado_por, mes_referencia, status, comprovante_msg_id) ' +
    'VALUES (?, ?, "mensalista", ?, ?, "pendente", ?) ' +
    'ON DUPLICATE KEY UPDATE status = "pendente", comprovante_msg_id = ?, enviado_por = ?',
    [grupoId, jogadorId, enviado_por, mes, msgId, msgId, enviado_por]
  );
}

// Registra comprovante de avulso externo (!avulso NOME)
async function registrarAvulso(grupoId, jogadorId, avulsoNome, enviado_por, msgId) {
  var mes = mesAtual();
  await db.execute(
    'INSERT INTO mensalidades (grupo_id, jogador_id, tipo, avulso_nome, enviado_por, mes_referencia, status, comprovante_msg_id) ' +
    'VALUES (?, ?, "avulso", ?, ?, ?, "pendente", ?)',
    [grupoId, jogadorId, avulsoNome, enviado_por, mes, msgId]
  );
}

// Confirma pagamento — atualiza status e quem aprovou
async function confirmarPagamento(mensalidadeId, aprovadoPor) {
  await db.execute(
    'UPDATE mensalidades SET status = "pago", aprovado_por = ?, pago_em = NOW() WHERE id = ?',
    [aprovadoPor, mensalidadeId]
  );
}

// Rejeita pagamento
async function rejeitarPagamento(mensalidadeId, aprovadoPor) {
  await db.execute(
    'UPDATE mensalidades SET status = "rejeitado", aprovado_por = ? WHERE id = ?',
    [aprovadoPor, mensalidadeId]
  );
}

// Lista pagos do mes para um grupo
async function listarPagos(grupoId) {
  var mes = mesAtual();
  var [rows] = await db.execute(
    'SELECT m.id, m.tipo, m.avulso_nome, j.nome AS jogador_nome, m.pago_em ' +
    'FROM mensalidades m ' +
    'LEFT JOIN jogadores j ON j.id = m.jogador_id ' +
    'WHERE m.grupo_id = ? AND m.mes_referencia = ? AND m.status = "pago" ' +
    'ORDER BY m.pago_em ASC',
    [grupoId, mes]
  );
  return rows;
}

// Lista pendentes do mes (enviaram !paguei, admin ainda nao confirmou)
async function listarPendentes(grupoId) {
  var mes = mesAtual();
  var [rows] = await db.execute(
    'SELECT m.id, m.tipo, m.avulso_nome, j.nome AS jogador_nome, m.enviado_por, m.criado_em ' +
    'FROM mensalidades m ' +
    'LEFT JOIN jogadores j ON j.id = m.jogador_id ' +
    'WHERE m.grupo_id = ? AND m.mes_referencia = ? AND m.status = "pendente" ' +
    'ORDER BY m.criado_em ASC',
    [grupoId, mes]
  );
  return rows;
}

// Lista inadimplentes: membros ativos sem nenhum registro no mes
async function listarInadimplentes(grupoId) {
  var mes = mesAtual();
  var [rows] = await db.execute(
    'SELECT j.id, j.nome, j.whatsapp_id ' +
    'FROM jogadores j ' +
    'JOIN grupo_jogadores gj ON gj.jogador_id = j.id ' +
    'WHERE gj.grupo_id = ? AND gj.ativo = TRUE ' +
    'AND j.id NOT IN (' +
    '  SELECT jogador_id FROM mensalidades ' +
    '  WHERE grupo_id = ? AND mes_referencia = ? AND jogador_id IS NOT NULL' +
    ') ' +
    'ORDER BY j.nome ASC',
    [grupoId, grupoId, mes]
  );
  return rows;
}

// Resumo do mes: total esperado, recebido, pendente
async function resumoMes(grupoId) {
  var mes = mesAtual();
  var [config] = await db.execute(
    'SELECT valor_mensalidade FROM grupos WHERE id = ?',
    [grupoId]
  );
  var valor = parseFloat((config[0] && config[0].valor_mensalidade) || 0);

  var [totalAtivos] = await db.execute(
    'SELECT COUNT(*) AS total FROM grupo_jogadores WHERE grupo_id = ? AND ativo = TRUE',
    [grupoId]
  );

  var [pagos] = await db.execute(
    'SELECT COUNT(*) AS total FROM mensalidades WHERE grupo_id = ? AND mes_referencia = ? AND status = "pago"',
    [grupoId, mes]
  );

  var [pendentes] = await db.execute(
    'SELECT COUNT(*) AS total FROM mensalidades WHERE grupo_id = ? AND mes_referencia = ? AND status = "pendente"',
    [grupoId, mes]
  );

  return {
    valor: valor,
    totalAtivos: totalAtivos[0].total,
    totalPagos: pagos[0].total,
    totalPendentes: pendentes[0].total,
    totalInadimplentes: totalAtivos[0].total - pagos[0].total - pendentes[0].total,
    esperado: valor * totalAtivos[0].total,
    recebido: valor * pagos[0].total
  };
}

// Busca admins do grupo para notificacao
async function buscarAdminsDoGrupo(grupoId) {
  var [rows] = await db.execute(
    'SELECT whatsapp_id FROM admins WHERE grupo_id = ?',
    [grupoId]
  );
  return rows.map(function(r) { return r.whatsapp_id; });
}

// Salva config financeira do grupo
async function salvarConfig(grupoId, campo, valor) {
  await db.execute(
    'UPDATE grupos SET ' + campo + ' = ? WHERE id = ?',
    [valor, grupoId]
  );
}

module.exports = {
  mesAtual,
  buscarJogador,
  buscarGrupo,
  buscarMensalidadeExistente,
  registrarPaguei,
  registrarAvulso,
  confirmarPagamento,
  rejeitarPagamento,
  listarPagos,
  listarPendentes,
  listarInadimplentes,
  resumoMes,
  buscarAdminsDoGrupo,
  salvarConfig
};
