# AppFut — Arquitetura Completa do Sistema

> Documento de referência gerado em Abril/2026.
> Descreve o estado atual em produção e os próximos passos planejados.

---

## 1. Visão Geral

AppFut é um SaaS de gestão de rachão (futebol amador) via WhatsApp.
Jogadores confirmam presença, admins gerenciam partidas, e tudo é automatizado por bots.

O sistema roda em **dois bots em paralelo**:

| | WPP Bot (legado) | Evolution Bot (novo) |
|---|---|---|
| Pasta | `src/` | `evolution/` |
| Protocolo | WPPConnect (Puppeteer/Chrome) | Evolution API v2.3.5 (Baileys HTTP) |
| Processo PM2 | `appfut-grupo` + `appfut-meta` | `evolution-webhook` |
| Porta | 3000 (meta), 3001 (wpp) | 3002 (webhook) |
| Banco | MySQL `appfut` | MySQL `appfut` (mesmo banco) |
| Status | Produção estável | Piloto em validação |

**Infraestrutura:**
- Servidor: Ubuntu 22.04, Hostinger VPS, IP `31.97.94.250`
- User: `appfutadmin`
- Projeto: `/home/appfutadmin/appfut`
- Node.js 20.20.1, MySQL 8.0.45, PM2, Docker

---

## 2. Banco de Dados (MySQL `appfut`)

Schema compartilhado entre o bot WPP e o bot Evolution.

```
grupos
├── id (PK)
├── whatsapp_id (UNIQUE) — JID do grupo: 12345@g.us
├── nome
├── tipo (fixo | variavel)
├── dia_semana (0=dom … 6=sab, para grupos fixos)
├── horario_inicio (TIME)
├── horario_fim    (TIME)
├── max_jogadores  (default 14)
├── ativo (BOOLEAN)
└── boas_vindas_at (DATETIME, null = ainda não enviou)

jogadores
├── id (PK)
├── whatsapp_id (UNIQUE) — JID: 5511999@s.whatsapp.net
└── nome

grupo_jogadores  [N:N grupos × jogadores]
├── grupo_id (FK)
├── jogador_id (FK)
└── ativo (TRUE = membro atual, FALSE = saiu do grupo)

admins
├── grupo_id (FK)
└── whatsapp_id

partidas
├── id (PK)
├── grupo_id (FK)
├── data_partida (DATE)
├── status (aberta | fechada)
└── max_jogadores

presencas       [confirmados]
├── partida_id (FK)
├── jogador_id (FK)
└── confirmado_em

ausentes        [cancelados]
├── partida_id (FK)
└── jogador_id (FK)

avulsos         [convidados externos]
├── partida_id (FK)
├── nome (texto livre)
├── jogador_id (FK, opcional — preenchido em self-add)
└── adicionado_por (FK → jogadores)

lembretes_enviados  [deduplicação de alertas]
├── partida_id (FK)
├── jogador_id (FK)
└── tipo (2_dias | 1_dia | 1_hora)
```

**Relação principal:**
```
grupos → partidas → presencas/ausentes/avulsos/lembretes_enviados
grupos → grupo_jogadores → jogadores
grupos → admins
```

---

## 3. Bot WPP — Stack Legado (`src/`)

Usa **WPPConnect** (emula WhatsApp Web via Puppeteer/Chromium).
Dois processos PM2 por design (cada chip = um processo).

### 3.1 Processos

```
PM2: appfut-grupo   →  src/bot/index_wpp.js   (chip do grupo)
PM2: appfut-meta    →  src/bot/index_meta.js  (chip secundário — cadastro)
```

### 3.2 Fluxo de mensagem (WPP)

```
WhatsApp (membro)
  │
  ▼
WPPConnect (Puppeteer)
  │
  ├─ onMessage (grupo)   → commands/grupo.js   → !lista, !ajuda
  ├─ onMessage (privado) → commands/confirmar.js
  │                       commands/cancelar.js
  │                       commands/lista.js
  │                       commands/avulso.js
  │                       commands/ajuda.js
  │                       commands/admin.js
  │                       commands/adminPoll.js
  │
  ├─ onPollResponse      → confirmar/cancelar via enquete nativa
  │
  └─ onParticipantsChanged → auto-setup/cleanup de membros
```

### 3.3 Scheduler WPP (`src/bot/scheduler.js`)

```
node-cron (dentro do mesmo processo)

Produção:
  09h diário        → lembrete 2_dias e 1_dia (com enquete)
  */5min            → lembrete 1_hora antes + auto-close

MODO_TESTE=true:
  */3min            → todos os eventos acima
```

### 3.4 Arquivos principais

| Arquivo | Função |
|---|---|
| `src/bot/index_wpp.js` | Orquestrador WPP: listeners + auto-setup |
| `src/bot/index_meta.js` | Bot Meta: recebe link `entrar X` → cadastra membro |
| `src/bot/scheduler.js` | Cron jobs de lembretes e auto-close |
| `src/bot/commands/admin.js` | Painel admin texto |
| `src/bot/commands/adminPoll.js` | Painel admin via enquetes (state machine) |
| `src/bot/commands/confirmar.js` | Confirma presença |
| `src/bot/commands/cancelar.js` | Cancela presença |
| `src/bot/commands/lista.js` | Lista privada |
| `src/bot/commands/avulso.js` | Adicionar/remover convidados |
| `src/bot/utils/listaHelper.js` | `montarListaCompleta()` |
| `src/bot/utils/rateLimit.js` | Rate limit 3x/hora + delay 1-3s + dedup 10s |
| `src/database/connection.js` | Pool MySQL |
| `src/database/init.sql` | Schema completo |

---

## 4. Bot Evolution — Stack Novo (`evolution/`)

Usa **Evolution API v2.3.5** (Baileys — sem browser).
Arquitetura baseada em webhook HTTP: Evolution recebe mensagens do WhatsApp
e faz POST no servidor Node local.

### 4.1 Processo

```
PM2: evolution-webhook  →  evolution/webhook_server.js  (porta 3002)
```

### 4.2 Fluxo completo de mensagem

```
WhatsApp (membro)
  │
  ▼
Evolution API (Baileys — porta 8080)
  │ POST /evolution
  ▼
webhook_server.js (Express — porta 3002)
  │
  ├─ GROUPS_UPSERT             → autoSetup.handleGroupsUpsert()
  │    ├─ registra grupo no MySQL
  │    ├─ registra membros (@lid ignorados)
  │    ├─ registra admins
  │    └─ envia boas-vindas com link wa.me/[META_BOT_NUMBER]?text=entrar [grupoId]
  │
  ├─ GROUP_PARTICIPANTS_UPDATE → autoSetup.handleGroupParticipantsUpdate()
  │    ├─ add:     registra novo membro
  │    ├─ remove:  marca ativo=FALSE
  │    ├─ promote: registra admin
  │    └─ demote:  remove admin
  │
  └─ MESSAGES_UPSERT
       ├─ grupo (isGroup=true)
       │    └─ commands.processarComandoGrupo()
       │         ├─ !ajuda  → orienta usar privado
       │         └─ !lista  → lista completa no grupo (rate limit 3x/h)
       │
       └─ privado (isGroup=false)
            └─ commands.processarMensagemPrivada()
                 ├─ "entrar X"    → informa usar o link
                 ├─ "admin..."    → admin.processarComandoAdmin()
                 ├─ "confirmar"   → confirmar.confirmar()
                 ├─ "cancelar"    → cancelar.cancelar()
                 ├─ "duvida"      → registrarDuvida()
                 ├─ "lista"       → listaPrivada()
                 ├─ "avulso Nome" → avulso.adicionarAvulso()
                 ├─ "remover avulso Nome" → avulso.removerAvulso()
                 ├─ "ajuda"       → lista de comandos
                 └─ (qualquer coisa) → enviarMenuJogador()
                      (menu contextual com status da partida aberta)
```

### 4.3 Auto-setup de grupos

Quando o bot é adicionado a um novo grupo:

```
GROUPS_UPSERT recebido
  ↓
INSERT grupos ON DUPLICATE KEY UPDATE nome
  ↓
Para cada participante:
  ├─ JID termina em @lid? → SKIP (WhatsApp privacy ID, sem número real)
  └─ INSERT jogadores + grupo_jogadores
     └─ é admin? → INSERT admins
  ↓
boas_vindas_at IS NULL? (nunca enviou)
  ↓ sim
Envia mensagem com link:
  https://wa.me/[META_BOT_NUMBER]?text=entrar%20[grupoId]
  ↓
UPDATE grupos SET boas_vindas_at = NOW()
```

**Nota sobre `@lid`:** JIDs de privacidade introduzidos pelo WhatsApp.
Esses membros clicam no link de boas-vindas → bot Meta processa `entrar X`
→ membro é cadastrado corretamente no banco com número real.

### 4.4 Scheduler Evolution (`evolution/scheduler.js`)

```
Inicia junto com webhook_server.js (dentro do mesmo processo)

Produção (SCHEDULER_MODO_TESTE=false):
  0 9 * * *     → verificarLembretes()     (2_dias e 1_dia às 9h)
  */5 * * * *   → verificarLembrete1hAntes() (1h antes do horario_inicio)
  */5 * * * *   → verificarAutoClose()     (fecha partida 1h após horario_fim)

Teste (SCHEDULER_MODO_TESTE=true):
  */3 * * * *   → tudo acima a cada 3min
```

**Auto-close + Auto-renew:**
```
Verifica partidas abertas onde agora > horario_fim + 1h
  ↓
UPDATE partidas SET status='fechada'
  ↓
Envia mensagem de encerramento no grupo
  ↓
grupo.tipo = 'fixo'?
  ├─ sim → calcula próximo dia_semana
  │         INSERT nova partida
  │         Envia aviso de próxima partida
  └─ não → sem auto-renew
```

**Deduplicação de lembretes:**
```
lembretes_enviados (partida_id, tipo) UNIQUE
→ cada tipo (2_dias / 1_dia / 1_hora) é enviado uma única vez por partida
```

### 4.5 Construção da lista (`evolution/utils/listaHelper.js`)

```
montarListaCompleta(partidaId, grupoId, ...)
  │
  ├─ SELECT presencas ORDER BY confirmado_em   → Confirmados
  ├─ SELECT ausentes ORDER BY criado_em        → Ausentes
  ├─ SELECT avulsos (LEFT JOIN jogadores)      → Avulsos (com "por X")
  └─ SELECT grupo_jogadores WHERE ativo=TRUE
       AND NOT IN presencas
       AND NOT IN ausentes
       AND NOT IN avulsos (jogador_id não nulo)  → Dúvida (ainda não responderam)

Saída formatada:
  ⚽ Nome do Grupo
  📅 quinta-feira, 01/05
  ⏰ 20 - 22
  👥 8/14 confirmados

  ✅ Confirmados (8):
  1. João
  ...

  ❌ Ausentes (3):
  1. Pedro
  ...

  ❓ Dúvida (5):
  · Carlos
  ...

  🔸 Avulsos (2):
  9. Marcos _(por João)_
  10. Felipe _(por João)_

  📲 Clique no WhatsApp: https://wa.me/[META_BOT_NUMBER]
```

### 4.6 Rate limit e proteções

Implementado em `evolution/utils/rateLimit.js`:

| Proteção | Regra |
|---|---|
| Rate limit | 3 chamadas por hora por (JID + comando) |
| Deduplicação | Ignora mesmo evento dentro de 10s |
| Delay anti-ban | 1-3s aleatório antes de cada envio |

### 4.7 Health check

```
GET http://localhost:3002/health

Resposta:
{
  "ok": true,
  "iniciadoEm": "2026-04-26T14:00:00.000Z",
  "uptime": "14h 32min 11s",
  "uptimeSec": 52331,
  "estabilidade": "✅ 24h+",
  "marcos": { "6h": true, "12h": true, "24h": true },
  "eventos": 847,
  "porEvento": { "MESSAGES_UPSERT": 412, ... },
  "porInstancia": { "appfut-piloto": 847 }
}
```

### 4.8 Arquivos principais

| Arquivo | Função |
|---|---|
| `evolution/webhook_server.js` | Express 3002 — ponto de entrada + healthcheck |
| `evolution/scheduler.js` | Cron jobs de lembretes + auto-close + auto-renew |
| `evolution/handlers/autoSetup.js` | Setup automático de grupos e membros |
| `evolution/handlers/commands.js` | Roteador de todos os comandos |
| `evolution/handlers/avulso.js` | Gestão de convidados avulsos |
| `evolution/handlers/confirmar.js` | Confirmação de presença |
| `evolution/handlers/cancelar.js` | Cancelamento de presença |
| `evolution/handlers/admin.js` | Painel admin texto |
| `evolution/utils/listaHelper.js` | Monta lista formatada |
| `evolution/utils/rateLimit.js` | Rate limit + delay + dedup |
| `evolution/client/evolutionClient.js` | Wrapper HTTP para Evolution API |
| `evolution/database/connection.js` | Pool MySQL → banco `appfut` |

---

## 5. Comunicação entre os dois bots

Os bots **não se comunicam diretamente**. O elo é o banco de dados compartilhado:

```
Bot WPP (src/)          Bot Evolution (evolution/)
     │                          │
     └──────────────────────────┘
                  │
           MySQL appfut
       (grupos, jogadores, partidas...)

Bot Meta (index_meta.js):
  Recebe "entrar [grupoId]" via WhatsApp
     ↓
  INSERT jogadores / grupo_jogadores no MySQL appfut
     ↓
  Dados ficam disponíveis para ambos os bots
```

---

## 6. Variáveis de Ambiente

### WPP Bot (`.env` na raiz)

| Variável | Descrição |
|---|---|
| `DB_HOST/USER/PASSWORD/NAME` | Conexão MySQL banco `appfut` |
| `META_BOT_NUMBER` | Número do chip Meta para link de cadastro |
| `SCHEDULER_MODO_TESTE` | true = crons a cada 3min |

### Evolution Bot (`evolution/.env.evolution`)

| Variável | Descrição |
|---|---|
| `WEBHOOK_PORT` | Porta Express (3002) |
| `PILOT_INSTANCE_NAME` | Nome da instância no Evolution |
| `META_BOT_NUMBER` | Mesmo número do WPP para link de boas-vindas |
| `APP_DB_HOST/USER/PASSWORD/NAME` | Conexão MySQL → banco `appfut` |
| `AUTHENTICATION_API_KEY` | Chave mestre do Evolution API |
| `SCHEDULER_MODO_TESTE` | true = crons a cada 3min |

---

## 7. Deploy e Operação

### Verificar serviços rodando

```bash
ssh appfutadmin@31.97.94.250
pm2 list
```

### Logs em tempo real

```bash
pm2 logs evolution-webhook --lines 50   # Evolution
pm2 logs appfut-bot --lines 50          # WPP
```

### Health check do Evolution

```bash
# No servidor
curl -s http://localhost:3002/health

# Do seu PC local
ssh appfutadmin@31.97.94.250 "curl -s http://localhost:3002/health"

# Verificar se passou 12h contínuas
ssh appfutadmin@31.97.94.250 "curl -s http://localhost:3002/health | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d['estabilidade'], '— uptime:', d['uptime'])\""
```

### Atualizar código no servidor

```bash
# Copiar arquivo modificado
scp evolution/handlers/commands.js appfutadmin@31.97.94.250:/home/appfutadmin/appfut/evolution/handlers/

# Reiniciar processo
ssh appfutadmin@31.97.94.250 "pm2 restart evolution-webhook"
```

### Mudar para produção (desligar MODO_TESTE)

```bash
ssh appfutadmin@31.97.94.250
nano ~/appfut/evolution/.env.evolution
# Alterar: SCHEDULER_MODO_TESTE=false
pm2 restart evolution-webhook --update-env
```

---

## 8. Comparativo WPP vs Evolution

| Funcionalidade | WPP (src/) | Evolution (evolution/) |
|---|---|---|
| Enquetes nativas | ✅ Sim | ❌ Não — usa menu texto |
| Comandos no grupo | ✅ !lista, !ajuda | ✅ Igual |
| Comandos no privado | ✅ Texto + enquetes | ✅ Só texto |
| Confirmar/Cancelar | ✅ Texto + poll | ✅ Texto |
| Dúvida | ✅ Poll | ✅ Texto |
| Avulso | ✅ Texto | ✅ Texto |
| Admin texto | ✅ | ✅ |
| Admin poll (state machine) | ✅ | ❌ Não implementado ainda |
| Auto-setup de grupo | ✅ | ✅ |
| Lembretes automáticos | ✅ 3 fases | ✅ 3 fases |
| Auto-close | ✅ | ✅ |
| Auto-renew grupos fixos | ✅ | ✅ |
| Health check | ❌ | ✅ Com uptime e marcos |
| Estabilidade | Depende do Chrome | Mais estável (sem browser) |
| Consumo de RAM | ~400-600MB (Chrome) | ~80-120MB (Baileys) |

---

## 9. Próximos Passos

### Curto prazo — Validação e estabilização

- [ ] **Validar 24h contínuas** do bot Evolution sem restart acidental
  (`curl health` deve mostrar `✅ 24h+`)
- [ ] **Testar fluxo completo** com grupo real:
  bot adicionado → boas-vindas → membro clica link → confirma → lista → lembrete → auto-close
- [ ] **Mudar `SCHEDULER_MODO_TESTE=false`** após validação dos lembretes
- [ ] **Implementar Admin Poll** no Evolution (state machine igual ao WPP — `adminPoll.js`)
- [ ] **Monitorar estabilidade** do WPP vs Evolution em paralelo por 1-2 semanas

### Médio prazo — Multi-grupo e SaaS

- [ ] **Painel web de onboarding** — admin cria conta, configura grupo, gera link
  (hoje é tudo via comando texto no WhatsApp)
- [ ] **Suporte a múltiplos grupos por instância** — hoje funciona, mas sem isolamento de alertas
- [ ] **Sistema financeiro/pagamentos** — controle de mensalidade por jogador
  (deadline estimado: Maio/2026)
  - Registro de pagamento por partida ou mês
  - Relatório de inadimplentes
  - Cobrança automática via WhatsApp
- [ ] **Dashboard de métricas** — partidas por grupo, taxa de confirmação, histórico

### Longo prazo — Produto comercial

- [ ] **Planos e billing** — free (1 grupo) / pro (N grupos) / enterprise
- [ ] **API pública** — integrações com apps de futebol amador (Golaço, Fut7, etc.)
- [ ] **Migração completa do chip real para Evolution** — quando Evolution validado 24h+
  e com paridade total de funcionalidades (especialmente Admin Poll)
- [ ] **App mobile lite** — visualização da lista sem precisar do WhatsApp

---

*Documento gerado em: Abril/2026 — AppFut v1 MVP*
