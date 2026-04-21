const { verificarRateLimit, delay } = require('../utils/rateLimit');

// ============================================================
// AJUDA — Mensagem informativa no privado
// Rate limit: 3x/hora por pessoa.
// ============================================================

async function ajudaPrivado(client, message, sender) {
  const limite = verificarRateLimit(sender, 'ajuda');
  if (!limite.permitido) return;

  await delay();
  await client.sendText(message.from,
    '⚽ *Assistente do Rachão*\n\n' +
    'Fala! 👋 Aqui você pode:\n\n' +
    '👉 *confirmar* - Confirmar presença no próximo jogo\n' +
    '👉 *cancelar* - Cancelar sua presença\n' +
    '👉 *lista* - Ver quem confirmou\n' +
    '👉 *ajuda* - Ver estes comandos\n\n' +
    'É só digitar o comando e enviar! 😉'
  );
}

module.exports = { ajudaPrivado };
