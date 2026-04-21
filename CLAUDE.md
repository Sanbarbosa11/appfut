# AppFut - Contexto do Projeto

## O que e

Bot WhatsApp para gestao de rachao (futebol amador). Jogadores confirmam presenca via enquetes, admin gerencia partidas, tudo automatizado.

## Stack

- Node.js 20.20.1 + WPPConnect (WhatsApp Web via Puppeteer)
- MySQL 8.0.45 (8 tabelas - ver `src/database/init.sql`)
- PM2 (process manager), node-cron (scheduler)
- Servidor: Ubuntu 22.04, Hostinger VPS, IP 31.97.94.250, user: appfutadmin
- Projeto no servidor: `/home/appfutadmin/appfut`

## Arquivos Principais

### Codigo-fonte (src/)

| Arquivo | Funcao |
|---------|--------|
| `src/bot/index.js` | Orquestrador: 4 listeners (onMessage, onPollResponse, onParticipantsChanged) + auto-setup/cleanup + avulsos + enquetes |
| `src/bot/scheduler.js` | Cron jobs: lembretes 3 fases (2 dias, 1 dia, 1h antes) + auto-close + auto-renew para grupos fixos. Tem flag `MODO_TESTE` |
| `src/bot/commands/admin.js` | Comandos admin por texto (criar partida, participantes, ativar/desativar, status) |
| `src/bot/commands/adminPoll.js` | Menu admin por enquetes (state machine com sessoes) |
| `src/bot/commands/confirmar.js` | Confirmar presenca por texto |
| `src/bot/commands/cancelar.js` | Cancelar presenca por texto |
| `src/bot/commands/lista.js` | Lista no privado |
| `src/bot/commands/grupo.js` | !ajuda e !lista no grupo |
| `src/bot/commands/ajuda.js` | Ajuda no privado |
| `src/bot/utils/listaHelper.js` | `montarListaCompleta()` - lista com Confirmados + Ausentes + Avulsos |
| `src/bot/utils/rateLimit.js` | Rate limit 3x/hora, delay 1-3s, dedup 10s |
| `src/bot/utils/verificarJogador.js` | Verifica jogador ativo por grupo |
| `src/database/connection.js` | Pool MySQL (mysql2/promise) |
| `src/database/init.sql` | Schema completo (8 tabelas) |

### Deploy scripts (raiz)

Scripts Node.js que usam `fs.writeFileSync` com `.join('\n')` (array de strings) para evitar problemas de escaping com template literals. Rodam no servidor para atualizar arquivos.

| Script | O que atualiza |
|--------|---------------|
| `deploy_autosetup.js` | index.js completo (versao mais recente - auto-setup/cleanup) |
| `deploy_final.js` | listaHelper.js + index.js + lista.js + grupo.js |
| `deploy_cleanup.js` | Patch index.js (cleanup) + admin.js (ativar/desativar todos) |
| `deploy_v3_lembretes.js` | scheduler.js (3 fases de lembretes) |
| `deploy_adminpoll.js` | adminPoll.js |
| `fix_participantes.js` | adminPoll.js (fix grupo_jogadores) |

## Banco de Dados (8 tabelas)

- `grupos` - whatsapp_id, nome, tipo (fixo/variavel), dia_semana, horario_inicio, horario_fim, max_jogadores
- `jogadores` - whatsapp_id, nome
- `grupo_jogadores` - grupo_id, jogador_id, ativo (N:N com status POR GRUPO)
- `partidas` - grupo_id, data_partida, status (aberta/fechada), max_jogadores
- `presencas` - partida_id, jogador_id (UNIQUE)
- `avulsos` - partida_id, nome, adicionado_por
- `admins` - grupo_id, whatsapp_id
- `lembretes_enviados` - partida_id, jogador_id, tipo (UNIQUE por tipo)

## Funcionalidades Implementadas

- **Auto-setup**: bot adicionado ao grupo = registra grupo + membros + admins automaticamente (via `getChatById` + `getGroupMembers`)
- **Auto-cleanup**: bot removido = cascading delete de todos os dados
- **Enquetes**: confirmacao/cancelamento por poll (1 clique)
- **Lista completa**: Confirmados > Ausentes > Avulsos (mostrada apos cada acao)
- **Avulsos**: `avulso Nome` / `remover avulso Nome`
- **Lembretes**: 3 fases com enquete integrada (2 dias 9h, 1 dia 9h, 1h antes)
- **Auto-close**: fecha partida 1h apos horario_fim
- **Auto-renew**: cria proxima partida para grupos fixos
- **Admin texto**: admin criar/fechar/participantes/ativar/desativar/status/ativar todos/desativar todos
- **Admin poll**: menu interativo por enquetes (state machine)
- **Rate limit**: 3x/hora, delay 1-3s, dedup 10s
- **Poll dedup**: Set em memoria (sender+msgId+opcao)

## Como fazer deploy

```bash
# 1. No PC local: copiar script para o servidor
scp deploy_NOME.js appfutadmin@31.97.94.250:/home/appfutadmin/appfut/

# 2. No servidor: rodar e reiniciar
cd ~/appfut && node deploy_NOME.js && pm2 restart appfut-bot
```

Padrao dos scripts de deploy: array de strings com `.join('\n')` para evitar escaping.

## Estado Atual (2026-03-31)

- Banco limpo (resetado para testes)
- Bot rodando no servidor via PM2
- Scheduler em `MODO_TESTE = true` (lembretes a cada 3min) - precisa mudar para false em producao
- Aguardando: adicionar bot ao grupo do WhatsApp para testar auto-setup
- Todos os arquivos deployados no servidor via deploy scripts
- GitHub atualizado: github.com/Sanbarbosa11/appfut

## Pendencias

1. Testar auto-setup ao adicionar bot ao grupo real
2. Testar fluxo completo: criar partida > confirmar > lista > lembretes > auto-close
3. Mudar `MODO_TESTE = false` no scheduler.js apos validacao
4. Proximo feature: sistema financeiro/pagamentos (deadline ~2026-04-10)

## Convencoes

- Codigo usa `var` (nao const/let) por padrao do projeto
- Emojis via unicode escape (`\ud83d\udc4b`) nas strings
- MySQL: `sudo mysql appfut` (nao `mysql -u root -p`)
- Formatar horario: `String(h).replace(/:(\d{2})$/, '')` remove segundos do TIME
- Deploy scripts usam `.join('\n')` array pattern (NUNCA template literals para codigo grande)
- Logs PM2: `pm2 logs appfut-bot --lines 30`
- Limpar logs erro: `> ~/.pm2/logs/appfut-bot-error.log`
