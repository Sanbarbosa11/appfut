var db = require('../../database/connection');

// ============================================================
// VERIFICAR JOGADOR ATIVO
// Verifica se o jogador esta ativo em pelo menos um grupo.
// Se grupoId fornecido, verifica naquele grupo especifico.
// ============================================================

async function verificarJogadorAtivo(sender, grupoId) {
  var [rows] = await db.execute(
    'SELECT id, nome FROM jogadores WHERE whatsapp_id = ?', [sender]
  );
  if (rows.length === 0) return null;

  var jogador = rows[0];

  // Verifica se esta ativo no grupo especifico ou em qualquer grupo
  var query, params;
  if (grupoId) {
    query = 'SELECT ativo FROM grupo_jogadores WHERE jogador_id = ? AND grupo_id = ?';
    params = [jogador.id, grupoId];
  } else {
    query = 'SELECT ativo FROM grupo_jogadores WHERE jogador_id = ? AND ativo = TRUE LIMIT 1';
    params = [jogador.id];
  }

  var [gj] = await db.execute(query, params);
  if (gj.length === 0) return null;
  if (grupoId && !gj[0].ativo) return null;

  return jogador;
}

module.exports = { verificarJogadorAtivo };
