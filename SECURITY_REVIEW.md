# AppFut — Revisão de Segurança para Produção Pública

## CONTEXTO PARA O MODELO LER PRIMEIRO

Você está analisando o projeto **AppFut**, um SaaS de gestão de rachão (futebol amador) via WhatsApp.
O sistema tem dois bots em paralelo:
- **WPP Bot** (`src/`) — usa WPPConnect (Puppeteer/Chrome), legado, em produção
- **Evolution Bot** (`evolution/`) — usa Evolution API v2.3.5 (Baileys HTTP), novo, em validação

**Servidor:** Ubuntu 22.04, Hostinger VPS, IP `31.97.94.250`, user `appfutadmin`
**Projeto:** `/home/appfutadmin/appfut`
**Banco:** MySQL 8.0.45, banco `appfut`, compartilhado entre os dois bots
**Processo:** PM2 gerencia `appfut-grupo`, `appfut-meta`, `evolution-webhook`
**GitHub:** github.com/Sanbarbosa11/appfut (branch master)

O objetivo deste documento é: **listar todos os problemas de segurança encontrados, classificados por severidade, com o trecho de código responsável e a correção exata a implementar.**

---

## ARQUIVOS RELEVANTES (estrutura atual)

```
evolution/
├── webhook_server.js        ← ponto de entrada HTTP (Express porta 3002)
├── scheduler.js             ← cron jobs
├── handlers/
│   ├── autoSetup.js         ← registra grupos/membros
│   ├── commands.js          ← roteador de comandos
│   ├── avulso.js
│   ├── confirmar.js
│   ├── cancelar.js
│   └── admin.js             ← painel admin + estado em memória
├── utils/
│   ├── rateLimit.js         ← rate limit em memória
│   └── listaHelper.js
├── client/evolutionClient.js
└── database/connection.js
```

---

## PROBLEMA 1 — CRÍTICO: Webhook sem autenticação

**Arquivo:** `evolution/webhook_server.js`, linhas 136–191

**Código atual:**
```js
function handle(req, res) {
  var body = req.body || {};
  var event = body.event || req.params[0] || 'desconhecido';
  // ... processa sem verificar origem
}
app.post('/evolution', handle);
app.post('/evolution/*', handle);
```

**Problema:** Qualquer pessoa que descubra o IP e porta 3002 pode fazer POST para `/evolution` com um payload falso e injetar eventos no sistema. Exemplo de ataque:
```bash
curl -X POST http://31.97.94.250:3002/evolution \
  -H 'Content-Type: application/json' \
  -d '{"event":"MESSAGES_UPSERT","instance":"appfut-piloto","data":{"key":{"remoteJid":"5511999999999@s.whatsapp.net","fromMe":false},"message":{"conversation":"admin criar 01/01 20:00 - 22:00 14"},"pushName":"Hacker"}}'
```
Isso faria o bot processar um comando `admin criar` como se viesse de um usuário legítimo.

**Correção:** Evolution API suporta envio de um header secreto (`apikey`) em cada POST. Verificar esse header antes de processar qualquer evento.

```js
// No webhook_server.js, antes do handler:
var WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function verificarAssinatura(req, res, next) {
  if (!WEBHOOK_SECRET) return next(); // sem secret configurado, passa (dev)
  var chave = req.headers['apikey'] || req.headers['x-api-key'] || '';
  if (chave !== WEBHOOK_SECRET) {
    console.warn('[webhook] Requisicao rejeitada — apikey invalida de:', req.ip);
    return res.status(401).json({ error: 'nao autorizado' });
  }
  next();
}

app.post('/evolution',   verificarAssinatura, handle);
app.post('/evolution/*', verificarAssinatura, handle);
```

Adicionar no `.env.evolution`:
```
WEBHOOK_SECRET=mesma_chave_configurada_no_evolution_api_para_essa_instancia
```

No Evolution API, ao registrar o webhook via `set_webhook.js`, passar o header:
```js
client.webhook.set(instanceName, {
  enabled: true,
  url: WEBHOOK_URL,
  webhook_by_events: false,
  events: WEBHOOK_EVENTS.split(','),
  headers: { apikey: WEBHOOK_SECRET }  // Evolution envia esse header em cada POST
});
```

---

## PROBLEMA 2 — CRÍTICO: Rate limiting em memória (zera no restart)

**Arquivo:** `evolution/utils/rateLimit.js`, linhas 1–37

**Código atual:**
```js
var limites = {};  // objeto em memória — zera quando processo reinicia
var dedup   = {};

function verificarRateLimit(chaveBase, acao) {
  var chave  = chaveBase + ':' + acao;
  var agora  = Date.now();
  // ...
}
```

**Problema:** Se o processo reiniciar (crash, deploy, restart manual), todos os contadores de rate limit zeram. Um atacante pode forçar um restart e em seguida disparar spam em massa. Também: em caso de múltiplos processos (escala horizontal futura), o rate limit não funciona entre processos.

**Correção opção A (simples — MySQL):** Criar tabela `rate_limits` e persistir contadores lá.

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  chave       VARCHAR(200) PRIMARY KEY,
  chamadas    JSON NOT NULL DEFAULT '[]',
  atualizado  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

```js
// rateLimit.js com MySQL
var db = require('../database/connection');

async function verificarRateLimitDB(chaveBase, acao, max, janelaMs) {
  var chave = chaveBase + ':' + acao;
  var agora = Date.now();
  max = max || 3;
  janelaMs = janelaMs || 3600000;

  var [rows] = await db.execute('SELECT chamadas FROM rate_limits WHERE chave = ?', [chave]);
  var chamadas = rows.length > 0 ? JSON.parse(rows[0].chamadas) : [];
  chamadas = chamadas.filter(function(t) { return agora - t < janelaMs; });

  if (chamadas.length >= max) {
    var minutosRestantes = Math.ceil((chamadas[0] + janelaMs - agora) / 60000);
    return { permitido: false, minutosRestantes: minutosRestantes };
  }

  chamadas.push(agora);
  await db.execute(
    'INSERT INTO rate_limits (chave, chamadas) VALUES (?, ?) ON DUPLICATE KEY UPDATE chamadas = VALUES(chamadas)',
    [chave, JSON.stringify(chamadas)]
  );
  return { permitido: true, restante: max - chamadas.length };
}
```

**Correção opção B (recomendada para produção futura — Redis):** Usar Redis com TTL nativo. Mais performático, mas requer novo serviço.

---

## PROBLEMA 3 — CRÍTICO: Sem backup do banco de dados

**Situação atual:** Não há script de backup automatizado para o MySQL `appfut`.
Se o servidor tiver um problema de disco, corrupção, ou o admin rodar `DROP TABLE` por acidente, todos os dados são perdidos permanentemente (grupos, jogadores, histórico de partidas, presenças).

**Correção:** Script de backup diário com retenção.

```bash
# /home/appfutadmin/backup_mysql.sh
#!/bin/bash
BACKUP_DIR="/home/appfutadmin/backups"
DATE=$(date +%Y%m%d_%H%M)
mkdir -p "$BACKUP_DIR"

mysqldump appfut > "$BACKUP_DIR/appfut_$DATE.sql"
gzip "$BACKUP_DIR/appfut_$DATE.sql"

# Manter apenas 7 dias
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "[$DATE] Backup concluido: appfut_$DATE.sql.gz"
```

```bash
chmod +x /home/appfutadmin/backup_mysql.sh
# Cron às 3h diariamente
(crontab -l; echo "0 3 * * * /home/appfutadmin/backup_mysql.sh >> /home/appfutadmin/backup.log 2>&1") | crontab -
```

Idealmente enviar o `.sql.gz` para um storage externo (S3, Google Drive, Backblaze).

---

## PROBLEMA 4 — ALTO: Porta 3002 exposta sem firewall

**Situação atual:** O Evolution webhook server escuta em `0.0.0.0:3002` (todas as interfaces).
O Evolution API está no mesmo servidor (localhost), então o webhook poderia escutar só em `127.0.0.1:3002`.

**Código atual em `webhook_server.js`:**
```js
app.listen(PORT, '0.0.0.0', function() { ... });  // exposto externamente
```

**Correção 1 — Bind só em localhost** (se Evolution e webhook estão no mesmo servidor):
```js
app.listen(PORT, '127.0.0.1', function() { ... });
```

**Correção 2 — Firewall (ufw)** — bloquear porta 3002 externamente:
```bash
sudo ufw deny 3002
sudo ufw allow from 127.0.0.1 to any port 3002
sudo ufw status
```

**Nota:** A porta 8080 do Evolution API também deve estar bloqueada externamente se não for usada por clientes diretos.

---

## PROBLEMA 5 — ALTO: `entrar X` sem token de verificação

**Arquivo:** `src/bot/index_meta.js`, função `entrarGrupo`

**Problema:** O link de boas-vindas enviado pelo Evolution é:
```
https://wa.me/[META_BOT_NUMBER]?text=entrar%20[grupoId]
```

O `grupoId` é um inteiro sequencial (1, 2, 3...). Alguém pode tentar:
```
entrar 1
entrar 2
entrar 3
...
```
e se cadastrar em grupos dos quais não é membro real, ganhando acesso para confirmar presença e manipular listas de outros clientes.

**Correção:** Gerar um token aleatório por grupo e validar no cadastro.

```sql
ALTER TABLE grupos ADD COLUMN invite_token VARCHAR(64) UNIQUE DEFAULT NULL;
```

```js
// Ao registrar grupo (autoSetup.js), gerar token:
var crypto = require('crypto');
var token = crypto.randomBytes(16).toString('hex');
await db.execute('UPDATE grupos SET invite_token = ? WHERE id = ?', [token, grupoId]);

// Link com token:
var link = 'https://wa.me/' + metaNumber + '?text=entrar%20' + token;
```

```js
// No index_meta.js, entrarGrupo(sender, senderName, token):
var [grupo] = await db.execute(
  'SELECT id, nome, whatsapp_id FROM grupos WHERE invite_token = ? AND ativo = TRUE', [token]
);
if (grupo.length === 0) {
  await metaSendText(sender, '⚠️ Link inválido ou expirado.');
  return;
}
```

---

## PROBLEMA 6 — ALTO: Sem rate limiting no nível HTTP

**Arquivo:** `evolution/webhook_server.js`

**Problema:** O Express não tem nenhum limite de requisições por IP. Um atacante pode enviar milhares de POSTs por segundo para `/evolution`, sobrecarregando o Node.js e o MySQL mesmo sem autenticação.

**Correção:** Usar `express-rate-limit` no nível do Express antes de qualquer handler:

```bash
npm install express-rate-limit
```

```js
var rateLimit = require('express-rate-limit');

var limiterWebhook = rateLimit({
  windowMs: 60 * 1000,    // 1 minuto
  max: 300,               // máximo 300 req/min por IP (Evolution é local, não conta)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'muitas requisicoes' }
});

app.use('/evolution', limiterWebhook);
```

---

## PROBLEMA 7 — MÉDIO: Estado admin em memória (perda em restart)

**Arquivo:** `evolution/handlers/admin.js`, linhas 8–11

**Código atual:**
```js
var adminSessoes = {}; // sessão ativa do admin — zera no restart
var _ultimaLista = {}; // cache da lista de participantes — zera no restart
```

**Problema:** Se o processo reiniciar enquanto o admin está no meio de uma operação (ex: rodou `admin participantes`, está prestes a rodar `admin desativar 3`), o contexto some. O admin recebe erro ou comportamento inesperado.

Adicionalmente: `_ultimaLista` guarda o estado da lista de jogadores em memória. Se reiniciar entre `admin participantes` e `admin desativar 3`, o índice 3 pode não corresponder mais ao jogador correto.

**Correção:** Persistir sessões no MySQL com TTL.

```sql
CREATE TABLE IF NOT EXISTS admin_sessoes (
  whatsapp_id  VARCHAR(100) PRIMARY KEY,
  grupo_id     INT NOT NULL,
  grupo_nome   VARCHAR(255),
  criado_em    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
);
```

---

## PROBLEMA 8 — MÉDIO: Sem sanitização em campos de texto livre

**Arquivo:** `evolution/handlers/commands.js`, linha 204
**Arquivo:** `evolution/handlers/avulso.js`

**Código atual:**
```js
var nomeAvulso = (text || '').trim().slice(7).trim();
if (nomeAvulso) return adicionarAvulso(remoteJid, nomeAvulso);
```

**Problema:** O nome do avulso vai direto para o banco sem validação de tamanho ou caracteres especiais. Alguém pode tentar:
- Nome com 10.000 caracteres (não quebra por causa do `VARCHAR(255)` no MySQL, mas trava a mensagem de resposta)
- Caracteres de controle ou formatação WhatsApp (`*`, `_`, `~`) que podem distorcer a lista

**Correção:**
```js
function sanitizarNome(input) {
  return (input || '')
    .trim()
    .replace(/[\r\n\t]/g, ' ')  // remove quebras de linha
    .slice(0, 50);              // máximo 50 chars
}

var nomeAvulso = sanitizarNome((text || '').slice(7));
if (!nomeAvulso) {
  await client.message.sendText(instanceName, remoteJid, 'Informe um nome. Ex: *avulso João Silva*');
  return;
}
```

---

## PROBLEMA 9 — MÉDIO: Permissões do usuário MySQL provavelmente amplas

**Situação atual:** O usuário `appfutadmin` (ou equivalente configurado no `.env`) possivelmente tem permissões de `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`, além das DML normais.

**Risco:** Se o código tiver uma falha de injeção de SQL (improvável com mysql2 parameterizado, mas possível via bug futuro), ou se um atacante conseguir execução remota de código, o dano pode ser total.

**Verificação no servidor:**
```bash
sudo mysql
SHOW GRANTS FOR 'appfutadmin'@'localhost';
```

**Correção:** Criar usuário dedicado com mínimo de permissões para o bot:
```sql
CREATE USER 'appfut_bot'@'localhost' IDENTIFIED BY 'SENHA_FORTE_AQUI';
GRANT SELECT, INSERT, UPDATE, DELETE ON appfut.* TO 'appfut_bot'@'localhost';
-- Sem: CREATE, DROP, ALTER, INDEX, REFERENCES
FLUSH PRIVILEGES;
```

---

## PROBLEMA 10 — MÉDIO: Sem monitoramento externo

**Situação atual:** O health check (`GET /health`) é interno — só funciona se o processo já estiver rodando. Se o servidor cair completamente, ninguém sabe.

**Correção:** Script externo que bate no health check e alerta via WhatsApp se falhar.

```bash
#!/bin/bash
# /home/appfutadmin/monitor_health.sh
HEALTH=$(curl -s --max-time 10 http://localhost:3002/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','false'))" 2>/dev/null)

if [ "$HEALTH" != "True" ]; then
  # Reiniciar e alertar (via Evolution API ou Telegram Bot)
  pm2 restart evolution-webhook
  echo "[$(date)] evolution-webhook reiniciado por falha no health check" >> /home/appfutadmin/monitor.log
fi
```

```bash
# Cron a cada 5 minutos
(crontab -l; echo "*/5 * * * * /home/appfutadmin/monitor_health.sh") | crontab -
```

Ou usar serviço externo gratuito como **UptimeRobot** apontando para `http://31.97.94.250:3002/health` (requer abrir a porta para o IP do UptimeRobot — melhor que abrir para todos).

---

## PROBLEMA 11 — MÉDIO: Sem auto-cleanup quando bot é removido do grupo

**Arquivo:** `evolution/handlers/autoSetup.js`

**Situação atual:** `handleGroupParticipantsUpdate` trata `action='remove'` para membros normais (marca `ativo=FALSE`). Mas quando o **bot em si** é removido do grupo, isso não é detectado — o grupo continua ativo no banco, recebendo lembretes e tentando enviar mensagens para um grupo do qual o bot não faz mais parte. Isso causa erros silenciosos no scheduler.

**Detecção:** No evento `GROUP_PARTICIPANTS_UPDATE`, se um dos JIDs removidos for o JID da própria instância:
```js
var BOT_JID = process.env.BOT_JID || ''; // ex: 5511999999999@s.whatsapp.net

} else if (action === 'remove') {
  var botRemovido = participants.some(function(jid) {
    return String(jid) === BOT_JID || String(jid).startsWith(BOT_JID.split('@')[0]);
  });

  if (botRemovido) {
    await db.execute('UPDATE grupos SET ativo = FALSE WHERE whatsapp_id = ?', [groupId]);
    console.log('[autoSetup] Bot removido do grupo, desativado:', groupId);
    return;
  }
  // ... tratamento normal de remoção de membro
}
```

Adicionar `BOT_JID` no `.env.evolution`.

---

## PROBLEMA 12 — BAIXO: Logs expõem informações sensíveis

**Arquivos:** vários handlers

**Situação atual:** Os logs no console incluem JIDs completos de usuários, nomes, e detalhes de partidas. Em produção com PM2, esses logs ficam em disco indefinidamente em `~/.pm2/logs/`.

**Correção:**
```bash
# Limitar tamanho dos logs do PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

E ofuscar JIDs nos logs (mostrar apenas últimos 4 dígitos):
```js
function logJid(jid) {
  if (!jid) return '?';
  return '***' + String(jid).slice(-10);
}
```

---

## PROBLEMA 13 — BAIXO: `evolutionClient.js` muta variáveis globais

**Arquivo:** `evolution/client/evolutionClient.js`, linhas 251–258

**Código atual:**
```js
module.exports = function createClient(override) {
  if (override) {
    if (override.serverUrl) SERVER_URL = override.serverUrl; // muta variável do módulo
    if (override.apiKey)    API_KEY    = override.apiKey;
    if (override.timeoutMs) TIMEOUT_MS = override.timeoutMs;
  }
  // ...
};
```

**Problema:** `SERVER_URL`, `API_KEY` e `TIMEOUT_MS` são variáveis no escopo do módulo. Se `createClient({apiKey: 'outra'})` for chamado de qualquer parte do código, muda a configuração globalmente para todas as chamadas subsequentes. Em ambiente single-tenant isso não quebra, mas é uma bomba para quando houver múltiplos clientes com instâncias diferentes.

**Correção:** O cliente deve encapsular o estado por instância, não mutar o módulo:
```js
module.exports = function createClient(override) {
  var serverUrl = (override && override.serverUrl) || process.env.SERVER_URL || 'http://localhost:8080';
  var apiKey    = (override && override.apiKey)    || process.env.AUTHENTICATION_API_KEY || '';
  var timeoutMs = (override && override.timeoutMs) || Number(process.env.EVOLUTION_HTTP_TIMEOUT_MS || 15000);
  // usar serverUrl/apiKey/timeoutMs locais em vez das variáveis do módulo
};
```

---

## RESUMO PRIORIZADO

| # | Severidade | Problema | Esforço |
|---|---|---|---|
| 1 | 🔴 CRÍTICO | Webhook sem autenticação (injeção de eventos) | 2h |
| 2 | 🔴 CRÍTICO | Rate limit em memória (zera no restart) | 4h |
| 3 | 🔴 CRÍTICO | Sem backup do MySQL | 1h |
| 4 | 🟠 ALTO | Porta 3002 exposta externamente | 30min |
| 5 | 🟠 ALTO | `entrar X` sem token (acesso indevido a grupos) | 3h |
| 6 | 🟠 ALTO | Sem rate limit HTTP (DDoS no Express) | 1h |
| 7 | 🟡 MÉDIO | Estado admin em memória (perda em restart) | 3h |
| 8 | 🟡 MÉDIO | Sem sanitização de campos de texto livre | 1h |
| 9 | 🟡 MÉDIO | Permissões MySQL provavelmente amplas | 30min |
| 10 | 🟡 MÉDIO | Sem monitoramento externo | 1h |
| 11 | 🟡 MÉDIO | Sem auto-cleanup quando bot é removido | 2h |
| 12 | 🟢 BAIXO | Logs expõem JIDs completos | 1h |
| 13 | 🟢 BAIXO | evolutionClient muta variáveis globais | 1h |

**Total estimado de correção:** ~21h de trabalho focado.

---

## ORDEM DE IMPLEMENTAÇÃO SUGERIDA

**Sprint 1 — Antes de qualquer cliente pagar (itens 1, 3, 4, 9):**
1. Autenticação do webhook (header secret)
2. Backup diário automático do MySQL
3. Fechar porta 3002 no firewall
4. Verificar e restringir permissões do usuário MySQL

**Sprint 2 — Antes de divulgar publicamente (itens 2, 5, 6, 8):**
5. Rate limit persistente (MySQL ou Redis)
6. Token de convite no link `entrar`
7. Rate limit HTTP com express-rate-limit
8. Sanitização de campos de texto

**Sprint 3 — Qualidade operacional (itens 7, 10, 11, 12, 13):**
9. Persistir sessões admin no MySQL
10. Monitoramento externo (UptimeRobot ou script cron)
11. Auto-cleanup quando bot é removido do grupo
12. Log rotation + ofuscar JIDs
13. Refatorar evolutionClient para não mutar globais

---

*Análise gerada em: Abril/2026 — base de código em github.com/Sanbarbosa11/appfut branch master*
