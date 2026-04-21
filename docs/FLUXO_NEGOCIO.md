# AppFut — Mapa de Fluxo de Negócio

> Última atualização: 2026-04-13  
> Ambiente: Ubuntu 22.04, VPS Hostinger (31.97.94.250), PM2

---

## Índice

1. [Arquitetura Geral](#1-arquitetura-geral)
2. [Infraestrutura e Pontos de Falha](#2-infraestrutura-e-pontos-de-falha)
3. [Fluxo do Jogador — Privado (Meta API)](#3-fluxo-do-jogador--privado-meta-api)
4. [Fluxo do Admin — Privado](#4-fluxo-do-admin--privado)
5. [Fluxo do Grupo (WPPConnect)](#5-fluxo-do-grupo-wppconnect)
6. [Scheduler — Lembretes e Auto-close](#6-scheduler--lembretes-e-auto-close)
7. [Banco de Dados — Relacionamentos](#7-banco-de-dados--relacionamentos)
8. [Tratamento de Erros e Casos Especiais](#8-tratamento-de-erros-e-casos-especiais)
9. [Checklist Pré-Sábado](#9-checklist-pr-sbado)

---

## 1. Arquitetura Geral

```
┌────────────────────────────────────────────────────────────────┐
│                     WHATSAPP WORLD                             │
│                                                                │
│   Jogador/Admin                    Grupo de Futebol            │
│   (privado)                        (grupo WA)                  │
│       │                                 │                      │
│       ▼ Meta Cloud API                  ▼ WPPConnect           │
└───────┼─────────────────────────────────┼────────────────────┘
        │                                 │
        ▼                                 ▼
┌───────────────────┐         ┌───────────────────────┐
│  appfut-meta      │         │  appfut-grupo          │
│  (PM2 id:1)       │         │  (PM2 id:2)            │
│  porta 3000       │         │  WPPConnect headless   │
│  index_meta.js    │         │  index_wpp.js          │
│  + webhook.js     │         │                        │
│  + metaClient.js  │         │                        │
└───────┬───────────┘         └──────────┬─────────────┘
        │                                │
        │       ┌────────────────────────┘
        ▼       ▼
┌───────────────────────────────┐
│        MySQL 8.0.45           │
│        banco: appfut          │
│                               │
│  grupos  jogadores  partidas  │
│  presencas  avulsos  admins   │
│  grupo_jogadores              │
│  lembretes_enviados           │
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│  scheduler.js (dentro meta)   │
│  - Lembretes via Meta API     │
│  - Auto-close                 │
│  - Auto-renew (grupos fixos)  │
└───────────────────────────────┘
```

**Webhook (entrada Meta API):**
```
Internet → Nginx (443 SSL) → localhost:3000 → Express /webhook
           appfutgestao.cloud                  GET: verificação
                                               POST: mensagens/respostas
```

---

## 2. Infraestrutura e Pontos de Falha

### Estado atual

| Componente | Estado | Risco |
|---|---|---|
| appfut-meta (PM2) | ✅ Rodando | Reinicia sozinho via PM2 |
| appfut-grupo (PM2) | ✅ Rodando | Reinicia sozinho via PM2 |
| MySQL | ✅ Rodando | Serviço do sistema |
| Nginx + SSL | ✅ Configurado | Cert valido ~90 dias |
| Webhook URL | ⚠️ **ngrok** | **Cai toda vez que reinicia** |
| Meta Dashboard | ⚠️ Conta | Bloqueada — aguardando resolução |

### Problema do ngrok

```
ngrok iniciado manualmente
       │
       ├── Gera URL aleatória: https://xxxx.ngrok-free.app
       │
       ├── Precisa atualizar META_WEBHOOK_URL no .env
       │   E no Meta Dashboard (Configurações > Webhooks)
       │
       └── Se cair (crash, reinício VPS, timeout 8h free plan):
               Bot para de receber mensagens do privado
               Grupos continuam funcionando (WPPConnect direto)
               Para recuperar: reiniciar ngrok + atualizar URL
```

### Solução permanente (bloqueada)

```
appfutgestao.cloud (Nginx já configurado com SSL)
       │
       └── Quando Meta liberar conta:
               1. Atualizar webhook no Meta Dashboard para
                  https://appfutgestao.cloud/webhook
               2. Remover ngrok
               3. MODO_TESTE = false no scheduler.js
```

### Como verificar se o bot está vivo

```bash
# No servidor:
pm2 status                              # ver se os 2 processos estão UP
pm2 logs appfut-meta --lines 20         # ver últimas mensagens processadas
pm2 logs appfut-grupo --lines 20        # ver logs do grupo
curl https://appfutgestao.cloud/health  # health check do servidor
```

---

## 3. Fluxo do Jogador — Privado (Meta API)

**Arquivo:** `src/bot/index_meta.js` + comandos em `src/bot/commands/`

### 3.1 Recebimento de Mensagem

```
Jogador envia mensagem privada para o bot
              │
              ▼
        webhook POST
              │
              ▼
    webhook.js — extrai sender, body, tipo
              │
              ▼
    onMessage() em index_meta.js
              │
              ├── dedup(msgId) → já processado? → IGNORA
              │
              ├── isGroupMsg? → processarComandoGrupo() → FIM
              │
              ├── texto começa com "admin"?
              │       └── processarComandoAdmin() → ver seção 4
              │
              └── switch(text) → comandos do jogador
```

### 3.2 Normalização do Sender

```
Meta API envia sender como: "5511963456139"
DB armazena como:           "5511963456139@c.us"

webhook.js normaliza:
  if (!sender.includes('@')) sender = sender + '@c.us'
```

### 3.3 Comandos do Jogador

```
text == "oi" / "olá" / "ola" / "oi!" / "olá!"
    └── tratarOi() ──────────────────────────────────────────┐
                                                              │
text == "confirmar"                                          │
    └── confirmar(client, message, sender, senderName)       │
                                                              │
text == "cancelar"                                           │
    └── cancelar(client, message, sender)                    │
                                                              │
text == "lista"                                              │
    └── lista(client, message, sender)                       │
                                                              │
text == "ajuda"                                              │
    └── ajudaPrivado(client, message, sender)                │
```

### 3.4 Fluxo tratarOi() — Comportamento Inteligente

```
Arquivo: src/bot/index_meta.js (função tratarOi)

tratarOi(sender)
    │
    ├── Garante coluna oi_exibido_em (ALTER TABLE IF NOT EXISTS)
    │
    ├── SELECT jogador WHERE whatsapp_id = sender
    │       └── não encontrado? → RETORNA SEM RESPOSTA
    │
    ├── SELECT partida aberta do grupo do jogador
    │       └── nenhuma partida? → "Não há partida aberta no momento" → FIM
    │
    ├── SELECT presenca WHERE partida_id AND jogador_id
    │       │
    │       ├── status = "confirmado"
    │       │       └── "Você já está confirmado ✅ Para cancelar, digite cancelar" → FIM
    │       │
    │       └── status = "ausente"
    │               └── "Sua ausência está registrada ❌ Se mudar, digite confirmar" → FIM
    │
    └── [sem resposta ainda — em dúvida]
            │
            ├── oi_exibido_em é HOJE?
            │       └── SIM → "Já te enviei as opções hoje! 😊 ..." → FIM
            │
            └── NÃO (primeiro oi do dia)
                    ├── UPDATE jogadores SET oi_exibido_em = NOW()
                    └── sendButtons(menu com 3 botões):
                            • "Confirmar presença"  → id: menu_confirmar
                            • "Cancelar presença"   → id: menu_cancelar
                            • "Ver lista"           → id: menu_lista
```

### 3.5 Fluxo Confirmar

```
Arquivo: src/bot/commands/confirmar.js

confirmar(sender, senderName)
    │
    ├── verificarRateLimit(sender, 'confirmar')
    │       └── > 3x/hora? → IGNORA silenciosamente
    │
    ├── INSERT IGNORE INTO jogadores (auto-cadastro)
    │
    ├── SELECT partida aberta via grupo_jogadores (jogador ativo)
    │       └── nenhuma? → "Não há jogo aberto no momento ⚠️"
    │
    ├── SELECT COUNT(*) FROM presencas WHERE partida_id
    │       └── total >= max_jogadores? → "O jogo já está lotado 😕"
    │
    ├── INSERT IGNORE INTO presencas (partida_id, jogador_id)
    │       ├── affectedRows = 0 → "Você já está confirmado! ✅"
    │       └── affectedRows = 1 → "✅ Presença confirmada! Vaga X/Y — Grupo: Nome"
    │
    └── FIM
```

### 3.6 Fluxo Cancelar

```
Arquivo: src/bot/commands/cancelar.js

cancelar(sender)
    │
    ├── verificarRateLimit(sender, 'cancelar')
    │
    ├── SELECT jogador WHERE whatsapp_id
    │       └── não encontrado? → "Você não está cadastrado ⚠️"
    │
    ├── DELETE FROM presencas
    │     JOIN partidas (status = 'aberta')
    │     JOIN grupo_jogadores (ativo = TRUE)
    │     WHERE jogador_id = ?
    │       ├── affectedRows = 0 → "Você não tinha presença confirmada 🤷"
    │       └── affectedRows > 0 → "Presença cancelada. Até a próxima! 👋"
    │
    └── FIM
```

### 3.7 Fluxo Resposta de Enquete (onPollResponse)

```
Arquivo: src/bot/index_meta.js → onPollResponse()
         src/bot/commands/adminPoll.js

Resposta de enquete chega pelo webhook
    │
    ├── Há sessão admin ativa (state machine)?
    │       └── SIM → processarAdminPoll() (ignora dedup)
    │
    └── NÃO → dedup(sender+msgId+opcao)
                    │
                    └── processarAdminPoll()
                                │
                                ├── opcao.startsWith('confirmar_ID')
                                │       └── confirmar(sender, ..., partidaId)
                                │
                                ├── opcao.startsWith('ausente_ID')
                                │       └── cancelar(sender, ...)
                                │
                                ├── opcao.startsWith('lista_ID')
                                │       └── lista(sender)
                                │
                                ├── opcao == 'menu_confirmar'
                                │       └── confirmar(sender, ...)
                                │
                                ├── opcao == 'menu_cancelar'
                                │       └── cancelar(sender, ...)
                                │
                                └── opcao == 'menu_lista'
                                        └── lista(sender) + botões ação
```

---

## 4. Fluxo do Admin — Privado

**Arquivo:** `src/bot/commands/admin.js`

### 4.1 Verificação de Admin

Todo comando `admin X` passa por:
```
buscarGrupoDoAdmin(senderId)
    └── SELECT grupos JOIN admins WHERE admins.whatsapp_id = sender
            ├── Encontrado → retorna grupo
            └── Não encontrado → "Você não é admin de nenhum grupo ⚠️"
```

### 4.2 Mapa de Comandos Admin

```
admin ajuda         → Lista todos os comandos disponíveis

admin grupos        → Lista grupos do bot no WhatsApp
                      Marca ✅ se já vinculado, ⏳ se não
                      Salva cache em adminGrupos._gruposCache

admin vincular N    → Vincula grupo pelo número da lista:
                      1. Verifica se sender é admin WA do grupo
                      2. INSERT grupos
                      3. INSERT admins
                      4. INSERT jogadores (todos os membros)
                      5. INSERT grupo_jogadores
                      6. Envia boas-vindas no grupo

admin participantes → Lista jogadores do grupo com status ativo/inativo
                      Salva cache para usar em ativar/desativar

admin ativar N      → UPDATE grupo_jogadores SET ativo = TRUE
admin desativar N   → UPDATE grupo_jogadores SET ativo = FALSE
                      (usa cache do último admin participantes)

admin criar DD/MM V → 1. Fecha partida aberta anterior
                      2. INSERT partidas (data, max_jogadores)
                      Responde: "✅ Partida criada! Data / Vagas / Grupo"

admin fechar        → UPDATE partidas SET status = 'fechada'
                      Responde com contagem de confirmados

admin status        → Mostra jogadores ativos + partida aberta + confirmados
```

### 4.3 Fluxo Completo de Setup de um Grupo Novo

```
Admin digita "admin grupos"
    ├── Bot lista grupos: 1. ⏳ Meu Grupo
    │
Admin digita "admin vincular 1"
    ├── Verifica admin WA
    ├── INSERT grupos (whatsapp_id, nome)
    ├── INSERT admins (grupo_id, whatsapp_id)
    ├── Para cada membro:
    │       ├── INSERT IGNORE jogadores
    │       └── INSERT IGNORE grupo_jogadores (ativo=TRUE por padrão)
    ├── Resposta privado: "✅ Grupo vinculado, N membros"
    └── Mensagem no grupo: "Fui configurado para ajudar..."

Admin digita "admin participantes"
    └── Lista jogadores com status

Admin digita "admin desativar 3"
    └── Marca jogador 3 como inativo (não recebe lembretes)

Admin digita "admin criar 19/04 20"
    └── Cria partida para 19/04 com 20 vagas
        └── Scheduler começa a monitorar para lembretes
```

---

## 5. Fluxo do Grupo (WPPConnect)

**Arquivo:** `src/bot/index_wpp.js`

### 5.1 Auto-setup na Inicialização

```
appfut-grupo inicia (PM2)
    │
    ├── WPPConnect.create() → sessão QR persistida
    │
    ├── iniciarScheduler(client) → lembretes via WPP (grupos)
    │
    └── setTimeout(5s) → scan de grupos existentes:
            Para cada grupo que o bot está:
                ├── SELECT grupos WHERE whatsapp_id = gid
                │       ├── Encontrado → "Grupo já cadastrado"
                │       └── Não encontrado → registrarGrupo(client, gid)
```

### 5.2 Auto-setup ao Ser Adicionado

```
onParticipantsChanged(event)
    │
    ├── action == 'add' + bot foi adicionado?
    │       └── registrarGrupo(client, groupId)
    │
    ├── action == 'add' + outro membro adicionado?
    │       └── registrarMembro(grupoId, pid, nome)
    │
    └── action == 'remove' ou 'leave'?
            └── UPDATE grupo_jogadores SET ativo = FALSE
```

### 5.3 registrarGrupo()

```
registrarGrupo(client, groupId)
    │
    ├── getChatById(groupId) → busca nome do grupo
    │
    ├── SELECT grupos WHERE whatsapp_id → existe?
    │       ├── SIM → usa grupoDbId existente
    │       └── NÃO → INSERT grupos (whatsapp_id, nome, tipo="variavel")
    │
    ├── getGroupMembers(groupId)
    │
    └── Para cada membro:
            ├── registrarMembro(grupoDbId, midStr, nome)
            └── isAdmin? → INSERT IGNORE admins (grupo_id, whatsapp_id)
```

### 5.4 Comando !lista no Grupo

```
onMessage(message) onde isGroupMsg = true
    │
text == "!lista"
    │
    └── processarListaGrupo(client, message)
                │
                ├── SELECT grupos WHERE whatsapp_id = message.from
                │       └── não encontrado → "Grupo não cadastrado ⚠️"
                │
                ├── SELECT partida aberta (JOIN grupos para horário)
                │       └── nenhuma → "Nenhuma partida aberta ⚠️"
                │
                ├── SELECT confirmados (presencas status='confirmado')
                ├── SELECT ausentes (presencas status='ausente')
                ├── SELECT dúvida (grupo_jogadores sem resposta)
                └── SELECT avulsos
                │
                └── Monta e envia mensagem:
                        ⚽ NomeGrupo — DD/MM às HH:MM
                        📋 X/Y confirmados

                        ✅ Confirmados (N):
                        1. Nome
                        ...

                        ❌ Ausentes (N):
                        1. Nome
                        ...

                        ❓ Dúvida (N):
                        · Nome
                        ...

                        🔸 Avulsos (N):
                        1. Nome
                        ...

                        📲 Para confirmar, chame +55 11 92692-2440
                           ou clique: https://wa.me/5511926922440
```

---

## 6. Scheduler — Lembretes e Auto-close

**Arquivo:** `src/bot/scheduler.js`

### 6.1 Cron Jobs

```
MODO_TESTE = true (atual):
    ┌── */3 * * * *  →  verificarLembretes() (a cada 3 min)
    └── */5 * * * *  →  verificarAutoClose()

MODO_TESTE = false (produção):
    ┌── 0 9 * * *    →  verificarLembretes() (às 9h)
    ├── */5 * * * *  →  verificarLembrete1hAntes()
    └── */5 * * * *  →  verificarAutoClose()
```

### 6.2 Fluxo de Lembretes

```
verificarLembretes()
    │
    ├── MODO_TESTE: busca TODAS as partidas abertas
    └── PRODUÇÃO: busca partidas de amanhã (INTERVAL 1 DAY)
                                                     ↑
                    [Nota: código atual ainda tem lógica de 2_dias
                     mas produção filtra só 1 dia. MODO_TESTE
                     cicla: 2_dias → 1_dia → 1_hora por partida]
    │
    Para cada partida:
        │
        ├── MODO_TESTE: qual tipo ainda não foi enviado?
        │       2_dias → 1_dia → 1_hora → todos enviados? PULA
        │
        └── PRODUÇÃO: diffDias == 1 → tipo = '1_dia'
                      (1_hora é verificado separado a cada 5min)
        │
        └── enviarLembreteTipo(partida, tipo)
```

### 6.3 enviarLembreteTipo()

```
enviarLembreteTipo(partida, tipo)
    │
    ├── SELECT jogadores NÃO confirmados NÃO com lembrete deste tipo
    │     (grupo_jogadores ativo=TRUE + NOT IN presencas + NOT IN lembretes_enviados)
    │
    ├── Para cada jogador:
    │       │
    │       ├── whatsapp_id.startsWith('fake')? → registra lembrete + PULA
    │       │
    │       ├── Monta msg conforme tipo:
    │       │       2_dias: "📢 Lembrete — jogo chegando"
    │       │       1_dia:  "⚠️ Último lembrete — é amanhã!"
    │       │       1_hora: "🚨 Falta 1 hora! — o jogo é HOJE!"
    │       │
    │       ├── sendText(jogador.whatsapp_id, msg)
    │       ├── delay 1.5s
    │       ├── sendPollMessage("Confirmar presença?", ["Confirmar presença", "Agora não"])
    │       ├── INSERT lembretes_enviados (partida_id, jogador_id, tipo) ← dedup
    │       └── delay 2s
    │
    └── FIM
```

### 6.4 Auto-close + Auto-renew

```
verificarAutoClose() — a cada 5 minutos
    │
    ├── SELECT partidas abertas com horario_fim
    │
    └── Para cada partida:
            │
            ├── agora >= (data_partida + horario_fim + 1h)?
            │       │
            │       ├── UPDATE partidas SET status = 'fechada'
            │       │
            │       ├── sendText(grupo_whatsapp_id, "🔒 Partida encerrada! N jogadores")
            │       │
            │       └── grupo.tipo == 'fixo' && dia_semana != null?
            │               ├── Calcula próxima data (mesmo dia da semana)
            │               ├── INSERT partidas (próxima semana)
            │               └── sendText(grupo, "🔄 Próxima partida criada! Data/Horário")
            │
            └── Não venceu ainda → PULA
```

---

## 7. Banco de Dados — Relacionamentos

```
grupos (1)──────────────────────(N) grupo_jogadores (N)──────(1) jogadores
   │                                                                  │
   │                                                                  │
   └──(1)─── admins ──────────────────────────────────────────(N)────┘
   │          (grupo_id, whatsapp_id)                          │
   │                                                           │
   └──(1)─── partidas (N)                                      │
                  │                                            │
                  ├──(1)── presencas (N)──────────────────(1)──┘
                  │         (partida_id, jogador_id, status)
                  │
                  ├──(1)── avulsos (N)
                  │         (partida_id, nome)
                  │
                  └──(1)── lembretes_enviados (N)
                            (partida_id, jogador_id, tipo)
                            UNIQUE: (partida_id, jogador_id, tipo)
```

### Regras importantes

| Tabela | Regra |
|---|---|
| `grupo_jogadores` | ativo=FALSE → não recebe lembretes, não aparece em "Dúvida" |
| `presencas` | UNIQUE (partida_id, jogador_id) — não há duplicata |
| `lembretes_enviados` | UNIQUE (partida_id, jogador_id, tipo) — cada tipo enviado 1x |
| `jogadores` | whatsapp_id inclui @c.us — ex: `5511963456139@c.us` |
| `grupos` | tipo pode ser "fixo" (auto-renew) ou "variavel" |

---

## 8. Tratamento de Erros e Casos Especiais

### 8.1 Duplicata de Mensagens (dedup)

```
Set em memória: processadas (msgId)
    ├── Limpa após 30 minutos
    ├── Cobre: onMessage (por msgId)
    └── Cobre: onPollResponse (por sender+msgId+opcao)

EXCEÇÃO: sessão admin ativa → processa sempre (state machine)
```

### 8.2 Rate Limit

```
src/bot/utils/rateLimit.js
    ├── 3 ações por hora por sender
    ├── delay aleatório 1-3s antes de responder
    └── Dedup de 10s para mesma ação
```

### 8.3 LID Migration (WPPConnect → Meta)

```
Problema: WPPConnect registra membros com @lid (ID interno WA)
          Meta API envia @c.us (número real)

Solução em autoRegistrarJogador():
    ├── Recebe mensagem com @c.us (Meta)
    ├── Verifica se jogador existe com @c.us
    │       └── Existe → usa normalmente
    └── Não existe → tenta migrar por nome:
            SELECT WHERE nome = senderName AND whatsapp_id LIKE '%@lid'
                └── Encontrado → UPDATE whatsapp_id para @c.us
```

### 8.4 Jogadores Fake

```
scheduler.js: pula whatsapp_id.startsWith('fake')
    └── Apenas registra lembrete como enviado sem tentar enviar
    └── Útil para testes com membros placeholder
```

### 8.5 Grupo Não Cadastrado

```
!lista no grupo → "Grupo não cadastrado ⚠️"
    └── Solução: admin vincular ou auto-setup ao adicionar bot
```

### 8.6 Partida Não Aberta

```
confirmar/cancelar/lista → "Não há jogo aberto no momento ⚠️"
    └── Solução: admin criar DD/MM VAGAS
```

---

## 9. Checklist Pré-Sábado

### Para deixar lista disponível no grupo até sábado (19/04):

- [ ] **Criar partida para sábado:**
  ```
  admin criar 19/04 20
  ```

- [ ] **Confirmar que ngrok está ativo** (jogadores precisam interagir pelo privado):
  ```bash
  # No servidor:
  pm2 logs appfut-meta --lines 5
  # Ver se há mensagens sendo processadas
  ```

- [ ] **Testar !lista no grupo** após criar a partida

- [ ] **Avisar jogadores:** manda mensagem no grupo explicando que podem:
  - Ver a lista com `!lista` no grupo
  - Confirmar mandando mensagem para o número do bot no privado

### Para produção definitiva (quando Meta liberar):

- [ ] Atualizar webhook no Meta Dashboard para `https://appfutgestao.cloud/webhook`
- [ ] Remover ngrok do .env
- [ ] Alterar `MODO_TESTE = false` em `src/bot/scheduler.js`
- [ ] Reiniciar: `pm2 restart appfut-meta`

### Monitoramento contínuo:

```bash
# Verificar status dos processos:
pm2 status

# Ver erros recentes:
pm2 logs appfut-meta --lines 50 --err
pm2 logs appfut-grupo --lines 50 --err

# Reiniciar se necessário:
pm2 restart appfut-meta
pm2 restart appfut-grupo

# Ver banco de dados:
sudo mysql appfut -e "SELECT * FROM partidas ORDER BY id DESC LIMIT 5;"
sudo mysql appfut -e "SELECT * FROM presencas WHERE partida_id = X;"
```
