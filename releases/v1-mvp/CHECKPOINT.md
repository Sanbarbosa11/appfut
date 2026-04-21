# AppFut — v1 MVP Checkpoint
**Data:** 21/04/2026
**Status:** Produção — funcional e estável

---

## O que é esse marco

Primeiro momento estável do AppFut com o fluxo de presença/ausência fechado e disponível para uso real. Base de referência para evoluções futuras — qualquer nova versão parte daqui.

---

## Arquitetura

```
WhatsApp (grupo)
    ↓ mensagens do grupo (!lista, !ajuda, eventos)
index_wpp.js  →  WPPConnect (Puppeteer)
    ↓ lembretes, auto-close, auto-setup
scheduler.js

WhatsApp (privado)
    ↓ mensagens privadas (confirmar, cancelar, admin)
index_meta.js  →  Meta WhatsApp Business API
    ↓ webhook HTTP
src/bot/whatsapp/webhook.js

Ambos compartilham:
  src/bot/commands/   — lógica de negócio
  src/database/       — MySQL via mysql2
```

---

## Stack

| Componente | Tecnologia |
|-----------|-----------|
| Runtime | Node.js 20.20.1 |
| WhatsApp Grupo | WPPConnect 1.41.2 |
| WhatsApp Privado | Meta WhatsApp Business API |
| Banco de dados | MySQL 8.0.45 |
| Processo | PM2 (2 processos: appfut-grupo + appfut-meta) |
| Scheduler | node-cron |
| Servidor | Ubuntu 22.04 — Hostinger VPS — 31.97.94.250 |

---

## Processos PM2

| Nome | Arquivo | Responsabilidade |
|------|---------|-----------------|
| `appfut-grupo` | `index_wpp.js` | Grupo: !lista, !ajuda, auto-setup, lembretes |
| `appfut-meta` | `index_meta.js` | Privado: confirmar, cancelar, lista, admin, menu |

---

## Banco de Dados (11 tabelas)

| Tabela | Função |
|--------|--------|
| `grupos` | Grupos WhatsApp registrados |
| `jogadores` | Membros (whatsapp_id único) |
| `grupo_jogadores` | Vínculo N:N jogador↔grupo com `ativo` por grupo |
| `admins` | Admins por grupo |
| `partidas` | Partidas com status aberta/fechada |
| `presencas` | Confirmações por partida |
| `ausentes` | Cancelamentos explícitos |
| `duvidas` | Jogadores que não responderam |
| `avulsos` | Jogadores externos adicionados manualmente |
| `lembretes_enviados` | Controle de lembretes por partida e tipo |
| `config_financeiro` | Reservado para módulo financeiro (v2) |

---

## Funcionalidades implementadas

### Grupo (via WPPConnect)
- `!lista` — exibe lista completa no grupo com footer de link
- `!ajuda` — exibe comandos disponíveis
- Auto-setup ao adicionar bot: registra grupo + membros + admins
- Auto-cleanup ao remover bot: soft delete (grupo, partidas, vínculos)
- Boas-vindas com link `entrar X` (delay 25s para estabilizar)
- Lembretes automáticos: 2 dias antes (9h), 1 dia antes (9h), 1h antes

### Privado (via Meta API)
- Menu interativo com botões (Confirmar / Cancelar)
- `confirmar` — registra presença, exibe lista atualizada
- `cancelar` — registra ausência explícita, exibe lista atualizada
- `lista` — exibe lista da partida ativa
- `avulso Nome` — adiciona jogador externo
- `remover avulso Nome` — remove avulso
- `admin grupos` — lista grupos com ID real
- `admin grupo ativar ID` — ativa sessão de 4h para grupo específico
- `admin criar DD/MM HH:MM - HH:MM vagas` — cria partida
- `admin fechar` — fecha partida ativa
- `admin status` — status do grupo ativo
- `admin participantes` — lista jogadores ativos/inativos
- `admin ativar todos / desativar todos`
- `entrar X` — vincula jogador ao grupo correto

### Segurança e controle
- Deduplicação de mensagens (30 min por ID)
- Rate limit: 3x/hora por comando por sender
- Sessão de admin: 4h TTL, seleção explícita em multi-grupo
- Bloqueio de jogadores sem vínculo: orienta com links dos grupos ativos
- Auto-registro de admin via fallback @lid quando bot entra em grupo novo
- Keepalive WPP a cada 2 min com watchdog: alerta após 3 falhas (~6 min)
- Alerta Meta API quando WPP perde conexão
- Alerta em `!lista` e `!ajuda` se sendText falhar no grupo

---

## Fluxo completo de um grupo novo

```
1. Admin cria grupo WhatsApp e adiciona o bot
2. WPP detecta → registra grupo + membros no banco
3. Boas-vindas enviada no grupo com link entrar X (após 25s)
4. Admin clica entrar X no privado → vinculado ao grupo como admin
5. Membros clicam entrar X → vinculados ao grupo correto
6. Admin cria partida: admin criar DD/MM HH:MM - HH:MM vagas
7. Membros confirmam/cancelam no privado via botões
8. !lista no grupo mostra lista em tempo real
9. Lembretes automáticos disparam nos marcos configurados
10. Partida fecha automaticamente 1h após horário_fim
11. Para grupo fixo: nova partida criada automaticamente
```

---

## Gaps conhecidos (aceitos no v1)

| Gap | Impacto | Resolução futura |
|-----|---------|-----------------|
| @lid no WPPConnect — membros não reconhecidos até interagir | Baixo — entrar X resolve | Migração para Evolution API |
| Avulso aberto a todos (sem restrição de admin) | Baixo | Flag admin_only por grupo |
| Alerta WPP só funciona dentro da janela 24h da Meta API | Baixo | Template aprovado Meta |
| Auto Close WPPConnect 180s (versão 2.3000.10305x não suportada) | Médio — keepalive mitiga | Migração para Evolution API |
| Link entrar X pode ser encaminhado para fora do grupo | Baixo — aparece em Dúvida | Aprovação manual de admin |

---

## Próximas versões planejadas

### v1.1 — Estabilidade
- Migração WPPConnect → Evolution API (elimina @lid e Auto Close)
- Controle de avulso por admin

### v2 — Financeiro
- Módulo de pagamentos/mensalidades
- Tabela `config_financeiro` já existe no banco

---

## Arquivos deste checkpoint

```
releases/v1-mvp/
├── CHECKPOINT.md               ← este arquivo
└── src/
    ├── bot/
    │   ├── index_meta.js       ← orquestrador Meta API (privado)
    │   ├── index_wpp.js        ← orquestrador WPPConnect (grupo)
    │   ├── scheduler.js        ← lembretes + auto-close + auto-renew
    │   ├── commands/
    │   │   ├── admin.js        ← comandos admin + sessão multi-grupo
    │   │   ├── avulso.js       ← adicionar/remover avulsos
    │   │   ├── ajuda.js        ← ajuda no privado
    │   │   ├── cancelar.js     ← cancelar presença
    │   │   ├── confirmar.js    ← confirmar presença
    │   │   ├── duvida.js       ← controle de dúvidas
    │   │   ├── grupo.js        ← !lista e !ajuda no grupo
    │   │   ├── lista.js        ← lista no privado
    │   │   └── menu.js         ← menus interativos (botões/listas)
    │   ├── utils/
    │   │   ├── listaHelper.js  ← monta lista completa (confirmados/ausentes/dúvida/avulsos)
    │   │   └── rateLimit.js    ← rate limit 3x/hora + delay + dedup
    │   └── whatsapp/
    │       ├── metaClient.js   ← wrapper Meta API (sendText, sendButtons, sendList)
    │       └── webhook.js      ← recebe eventos do Meta webhook
    └── database/
        ├── connection.js       ← pool MySQL (mysql2/promise)
        └── init.sql            ← schema completo (11 tabelas)
```

---

## Como restaurar este checkpoint

```bash
# Copiar arquivos do checkpoint para src/
cp -r releases/v1-mvp/src/* src/

# Deploy no servidor
scp -r src/bot appfutadmin@31.97.94.250:/home/appfutadmin/appfut/src/
ssh appfutadmin@31.97.94.250 "pm2 restart all"
```
