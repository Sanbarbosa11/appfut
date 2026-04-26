# AppFut - Evolution API (bot WhatsApp)

Bot de gestão de rachão rodando sobre Evolution API v2.3.5 (Baileys).
Substitui o stack anterior (WPPConnect + Puppeteer) com uma arquitetura mais leve e estável.

---

## Arquitetura

```
evolution/
├── webhook_server.js              Ponto de entrada (Express 3002) + scheduler
├── scheduler.js                   Lembretes + auto-close + auto-renew (node-cron)
├── package.json
├── .env.evolution.example         Template de variaveis de ambiente
├── .env.evolution                 Segredos reais (NAO commitar)
├── .gitignore
│
├── client/
│   └── evolutionClient.js         Wrapper HTTP para Evolution API (fetch nativo)
│
├── handlers/
│   ├── autoSetup.js               GROUPS_UPSERT / GROUP_PARTICIPANTS_UPDATE
│   ├── commands.js                Roteador de comandos (grupo + privado)
│   ├── avulso.js                  adicionarAvulso / removerAvulso
│   ├── confirmar.js               Confirmacao de presenca
│   ├── cancelar.js                Cancelamento de presenca
│   └── admin.js                   Painel admin texto
│
├── utils/
│   ├── listaHelper.js             montarListaCompleta() — lista formatada
│   └── rateLimit.js               Rate limit 3x/hora + delay 1-3s + dedup 10s
│
├── database/
│   ├── connection.js              Pool MySQL (mysql2/promise) — banco appfut
│   └── schema.sql                 Referencia das 8 tabelas
│
└── (scripts utilitarios)
    ├── smoke_test.js
    ├── set_webhook.js
    ├── create_instance.js
    ├── connect_instance.js
    ├── status_instance.js
    └── init_grupos.js
```

---

## Banco de dados

Usa o mesmo banco MySQL `appfut` que o bot WPP. Isso significa que membros
cadastrados por qualquer um dos bots ficam visíveis nos dois.

**8 tabelas:**
| Tabela | Função |
|---|---|
| `grupos` | whatsapp_id, nome, tipo, dia_semana, horario_inicio/fim, max_jogadores |
| `jogadores` | whatsapp_id, nome |
| `grupo_jogadores` | N:N grupos x jogadores (campo `ativo`) |
| `partidas` | grupo_id, data_partida, status (aberta/fechada), max_jogadores |
| `presencas` | partida_id, jogador_id (UNIQUE) |
| `ausentes` | partida_id, jogador_id |
| `avulsos` | partida_id, nome, jogador_id (opcional), adicionado_por |
| `lembretes_enviados` | partida_id, jogador_id, tipo (dedup) |

---

## Variáveis de ambiente

Copie `.env.evolution.example` para `.env.evolution` e preencha:

| Variável | Descrição |
|---|---|
| `WEBHOOK_PORT` | Porta do Express (padrão 3002) |
| `PILOT_INSTANCE_NAME` | Nome da instância no Evolution (ex: `appfut-piloto`) |
| `META_BOT_NUMBER` | Número do bot WPP no formato `55DDDNNNNNNNNN` (usado no link `entrar`) |
| `APP_DB_HOST/USER/PASSWORD/NAME` | Conexão MySQL banco `appfut` |
| `AUTHENTICATION_API_KEY` | Chave mestre do Evolution API |
| `SCHEDULER_MODO_TESTE` | `true` = crons a cada 3min, `false` = horários reais |

---

## Como rodar

```bash
# Instalar dependencias
cd ~/appfut/evolution
npm install

# Subir (foreground)
node webhook_server.js

# Subir com PM2
pm2 start webhook_server.js --name evolution-webhook
pm2 logs evolution-webhook --lines 50

# Recarregar com novas vars de ambiente
pm2 restart evolution-webhook --update-env
```

### Health check

```bash
curl http://localhost:3002/health
```

Retorna uptime, estabilidade (🔴 <6h / 🟠 6h+ / 🟡 12h+ / ✅ 24h+) e contagem de eventos.

---

## Fluxo de uma nova mensagem

```
WhatsApp -> Evolution API (Baileys)
         -> POST /evolution (webhook_server.js)
            -> GROUPS_UPSERT       -> autoSetup.handleGroupsUpsert()
            -> GROUP_PARTICIPANTS_UPDATE -> autoSetup.handleGroupParticipantsUpdate()
            -> MESSAGES_UPSERT
               -> grupo  -> commands.processarComandoGrupo()   (!lista, !ajuda)
               -> privado -> commands.processarMensagemPrivada()
                             (confirmar / cancelar / duvida / lista / avulso / admin / menu)
```

---

## Comandos disponíveis

### No grupo
| Comando | Ação |
|---|---|
| `!ajuda` | Explica que comandos são no privado |
| `!lista` | Lista completa (confirmados + ausentes + dúvida + avulsos) |

### No privado
| Comando | Ação |
|---|---|
| `confirmar` / `sim` / `vou` | Confirma presença na partida aberta |
| `cancelar` / `nao` / `não` | Cancela presença |
| `duvida` / `talvez` | Marca como dúvida |
| `lista` | Lista completa no privado |
| `avulso Nome` | Adiciona convidado avulso |
| `remover avulso Nome` | Remove avulso |
| `ajuda` | Lista de comandos |
| _(qualquer outra coisa)_ | Menu contextual com status da partida aberta |

### Admin (privado)
| Comando | Ação |
|---|---|
| `admin` | Painel de administração |
| `admin criar YYYY-MM-DD` | Cria partida |
| `admin fechar` | Fecha partida aberta |
| `admin status` | Status do grupo/partida |
| `admin ativar` / `admin desativar` | Ativa/desativa membros |

---

## Auto-setup de grupos

Quando o bot é adicionado a um grupo (`GROUPS_UPSERT`):
1. Registra o grupo na tabela `grupos` (com `ativo = TRUE`)
2. Registra membros que tenham JID `@s.whatsapp.net` (ignora `@lid`)
3. Registra admins do grupo
4. Envia mensagem de boas-vindas com link `https://wa.me/[META_BOT_NUMBER]?text=entrar%20[grupoId]`

**Nota sobre `@lid`:** WhatsApp usa JIDs de privacidade (`@lid`) para alguns membros.
Esses membros não podem ser mapeados para número de telefone — eles se cadastram
ao clicar no link de boas-vindas.

---

## Scheduler (lembretes automáticos)

Inicia junto com `webhook_server.js`. Comportamento:

| Evento | Horário (produção) | Horário (MODO_TESTE) |
|---|---|---|
| Lembrete 2 dias | 9h | a cada 3min |
| Lembrete 1 dia | 9h | a cada 3min |
| Lembrete 1 hora antes | a cada 5min | a cada 3min |
| Auto-close | a cada 5min | a cada 3min |

**Auto-close:** fecha a partida 1h após `horario_fim`. Para grupos `tipo='fixo'`,
cria automaticamente a próxima partida na mesma semana.

Deduplicação via tabela `lembretes_enviados` — cada tipo é enviado apenas uma vez por partida.

---

## Diferenças em relação ao bot WPP (src/)

| Aspecto | WPP (src/) | Evolution (evolution/) |
|---|---|---|
| Protocolo | WPP Web (Puppeteer) | Evolution API (Baileys HTTP) |
| Enquetes | Nativas WPP (`sendPollMessage`) | Não usadas — menu texto |
| Comandos privado | Texto + enquetes | Texto |
| Comandos grupo | `!lista` `!ajuda` | Igual |
| Auto-setup | Via WPP events | Via webhook GROUPS_UPSERT |
| Scheduler | `src/bot/scheduler.js` | `evolution/scheduler.js` |
| Banco | `appfut` | `appfut` (mesmo) |
| Processo | PM2 appfut-grupo/meta | PM2 evolution-webhook |
| Porta webhook | — | 3002 |

---

## Deploy inicial no servidor

```bash
# 1. Do PC local — copiar pasta
scp -r evolution appfutadmin@31.97.94.250:/home/appfutadmin/appfut/

# 2. No servidor
ssh appfutadmin@31.97.94.250
cd ~/appfut/evolution
npm install
cp .env.evolution.example .env.evolution
nano .env.evolution    # preencher credenciais

# 3. Subir
pm2 start webhook_server.js --name evolution-webhook
pm2 save

# 4. Verificar
curl http://localhost:3002/health
```

## Atualizar código no servidor

```bash
# Do PC local
scp evolution/handlers/commands.js appfutadmin@31.97.94.250:/home/appfutadmin/appfut/evolution/handlers/

# No servidor
pm2 restart evolution-webhook
```
