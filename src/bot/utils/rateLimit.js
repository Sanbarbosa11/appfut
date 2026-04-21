// ============================================================
// RATE LIMIT + DELAY + DEDUPLICACAO
// Protecoes contra spam, burst e bloqueio do WhatsApp.
// Armazenado em memoria (reseta se o bot reiniciar).
// ============================================================

// --- Rate Limit ---
// Limita execucoes de um comando por identificador (grupo ou pessoa).

const rateLimitMap = new Map();
const LIMITE_POR_HORA = 3;
const JANELA_MS = 60 * 60 * 1000; // 1 hora

/**
 * Verifica se o identificador pode executar o comando.
 * @param {string} id - whatsapp_id do grupo ou do jogador
 * @param {string} comando - nome do comando (ex: 'lista')
 * @returns {{ permitido: boolean, restante?: number, minutosRestantes?: number }}
 */
function verificarRateLimit(id, comando) {
  const chave = `${id}:${comando}`;
  const agora = Date.now();
  const registro = rateLimitMap.get(chave);

  if (!registro || (agora - registro.inicio) >= JANELA_MS) {
    rateLimitMap.set(chave, { inicio: agora, contagem: 1 });
    return { permitido: true, restante: LIMITE_POR_HORA - 1 };
  }

  if (registro.contagem >= LIMITE_POR_HORA) {
    const tempoRestante = Math.ceil((JANELA_MS - (agora - registro.inicio)) / 60000);
    return { permitido: false, minutosRestantes: tempoRestante };
  }

  registro.contagem++;
  return { permitido: true, restante: LIMITE_POR_HORA - registro.contagem };
}

// --- Delay ---
// Atraso artificial antes de responder. Simula comportamento humano.
// Evita que o WhatsApp identifique o bot como automatizado.

/**
 * Aguarda entre 1 e 3 segundos (aleatorio).
 * @returns {Promise<void>}
 */
function delay() {
  const ms = 1000 + Math.random() * 2000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Deduplicacao ---
// Se o mesmo comando for enviado no mesmo grupo dentro de 10 segundos,
// o bot ignora as repeticoes. Evita burst quando varios jogadores
// mandam !lista ao mesmo tempo.

const deduplicacaoMap = new Map();
const JANELA_DEDUP_MS = 10 * 1000; // 10 segundos

/**
 * Verifica se o comando ja foi processado recentemente neste contexto.
 * @param {string} id - whatsapp_id do grupo
 * @param {string} comando - nome do comando
 * @returns {boolean} true se e duplicado (deve ignorar), false se pode processar
 */
function isDuplicado(id, comando) {
  const chave = `${id}:${comando}`;
  const agora = Date.now();
  const ultimo = deduplicacaoMap.get(chave);

  if (ultimo && (agora - ultimo) < JANELA_DEDUP_MS) {
    return true;
  }

  deduplicacaoMap.set(chave, agora);
  return false;
}

module.exports = { verificarRateLimit, delay, isDuplicado };
