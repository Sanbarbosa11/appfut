# Bot WhatsApp (WPPConnect)

## Como Funciona

O bot utiliza a biblioteca WPPConnect para se conectar ao WhatsApp Web via Puppeteer (Chromium headless). Ele funciona como um "dispositivo conectado" a um numero de WhatsApp.

### Fluxo de Funcionamento

1. Bot inicia e abre o Chromium headless
2. Na primeira execucao, gera um QR Code para vincular ao WhatsApp
3. Apos escanear, a sessao fica salva em `tokens/appfut-bot/`
4. Nas proximas inicializacoes, reconecta automaticamente
5. No startup: `autoRegistrarGrupos()` verifica todos os grupos e registra os que faltam
6. Inicia o scheduler (lembretes + auto-close)
7. Escuta 4 tipos de evento: onMessage, onPollResponse, onParticipantsChanged

### Sessao do WhatsApp

- Armazenada em: `tokens/appfut-bot/`
- Se expirar: parar o bot, rodar manualmente, escanear QR Code, reiniciar via PM2
- Para limpar sessao: `rm -rf ~/appfut/tokens/appfut-bot`

## Arquitetura do Bot (index.js)

### Startup

```
start()
  ├── wppconnect.create()           -> Inicia sessao WhatsApp
  ├── iniciarScheduler(client)      -> Ativa cron jobs
  ├── autoRegistrarGrupos(client)   -> Registra grupos existentes no banco
  │
  ├── onMessage()                   -> Roteia mensagens
  ├── onPollResponse()              -> Processa cliques em enquetes
  └── onParticipantsChanged()       -> Auto-setup/cleanup + membros
```

### onMessage (mensagens)

```
onMessage(message)
  ├── Atualiza nome do jogador (se diferente de "Jogador")
  │
  ├── isGroup?
  │   ├── autoRegistrarSeNecessario()   -> Registra grupo se nao existe
  │   └── processarComandoGrupo()       -> !ajuda, !lista
  │
  ├── "admin" (exato)        -> iniciarMenuAdmin() (menu por enquetes)
  ├── "admin ..."            -> processarComandoAdmin() (texto)
  │
  ├── "avulso Nome"          -> adicionarAvulso()
  ├── "remover avulso Nome"  -> removerAvulso()
  │
  ├── "oi"                   -> enviarEnqueteConfirmar()
  ├── "corrigir"             -> enviarEnqueteCancelar()
  ├── "confirmar"            -> confirmar() + enviarListaApos()
  ├── "cancelar"             -> cancelar() + enviarListaApos()
  ├── "lista"                -> lista()
  ├── "ajuda"                -> ajudaPrivado()
  └── default                -> silencio
```

### onPollResponse (enquetes)

```
onPollResponse(response)
  ├── Dedup: sender + msgId + opcao (1 processamento por clique)
  │
  ├── Admin session ativa?   -> processarAdminPoll()
  │
  ├── "Confirmar presenca"   -> confirmar() + enviarListaApos()
  └── "Cancelar presenca"    -> cancelar() + enviarListaApos()
```

### onParticipantsChanged (membros)

```
onParticipantsChanged(event)
  ├── Bot adicionado?        -> setupGrupo() (registra grupo + membros + admins)
  ├── Bot removido?          -> Cascading delete (limpa todos os dados do grupo)
  │
  ├── Membro adicionado      -> INSERT jogador + grupo_jogadores
  └── Membro removido        -> UPDATE grupo_jogadores SET ativo = FALSE
```

### Funcoes Principais do index.js

| Funcao | Descricao |
|--------|-----------|
| `start()` | Inicializa bot, scheduler e listeners |
| `autoRegistrarGrupos(client)` | No startup, registra todos os grupos do bot |
| `autoRegistrarSeNecessario(client, grupoId)` | Fallback: registra grupo ao receber mensagem |
| `setupGrupo(client, grupoId, addedBy)` | Registra grupo, membros e admins (usa `getChatById` + `getGroupMembers`) |
| `enviarEnqueteConfirmar(client, chatId)` | Envia poll: "Confirmar presenca" / "Agora nao" |
| `enviarEnqueteCancelar(client, chatId)` | Envia poll: "Cancelar presenca" / "Manter presenca" |
| `enviarListaApos(client, chatId)` | Mostra lista completa apos confirmacao/cancelamento |
| `adicionarAvulso(client, message, sender, nome)` | Adiciona jogador avulso a partida |
| `removerAvulso(client, message, sender, nome)` | Remove jogador avulso da partida |

## Comandos do Bot

### No Grupo

| Comando | Resposta | Rate Limit |
|---------|----------|------------|
| `!ajuda` | Orientacoes de uso + link pro privado | Nao |
| `!lista` | Lista completa (Confirmados + Ausentes + Avulsos) | 3x/hora + dedup 10s |

> Qualquer outra mensagem no grupo e ignorada (silencio total)

### No Privado (Jogador)

| Comando/Acao | Descricao |
|-------------|-----------|
| `oi` | Envia enquete de confirmacao |
| Clique "Confirmar presenca" | Confirma + mostra lista |
| `corrigir` / `corrigir presenca` | Envia enquete de cancelamento |
| Clique "Cancelar presenca" | Cancela + mostra lista |
| `confirmar` | Confirma por texto + mostra lista |
| `cancelar` | Cancela por texto + mostra lista |
| `lista` | Mostra lista completa |
| `ajuda` | Mostra comandos disponiveis |
| `avulso Nome` | Adiciona jogador convidado |
| `remover avulso Nome` | Remove jogador convidado |

### No Privado (Admin) - Menu por Enquetes

Digitando `admin` no privado, o bot inicia um menu interativo por enquetes:

```
admin
  └── Selecionar grupo (enquete com grupos vinculados)
      └── Menu principal (enquete):
          ├── Criar partida variavel
          │   └── Data? -> Horario inicio? -> Horario fim? -> Vagas?
          ├── Criar rachao fixo
          │   └── Dia? -> Horario inicio? -> Horario fim? -> Vagas?
          ├── Participantes
          │   └── Lista com status ativo/inativo
          ├── Status do grupo
          └── Fechar partida aberta
```

### No Privado (Admin) - Comandos por Texto

| Comando | Descricao |
|---------|-----------|
| `admin ajuda` | Lista todos os comandos |
| `admin grupos` | Lista grupos vinculados |
| `admin vincular N` | Vincula grupo N e cadastra membros |
| `admin participantes` | Lista membros com status ativo/inativo |
| `admin ativar N` | Ativa jogador N no grupo |
| `admin desativar N` | Desativa jogador N no grupo |
| `admin ativar todos` | Ativa todos os jogadores do grupo |
| `admin desativar todos` | Desativa todos os jogadores do grupo |
| `admin criar DD/MM [VAGAS]` | Cria partida (fecha anterior automaticamente) |
| `admin fechar` | Fecha partida aberta |
| `admin status` | Visao geral do grupo e partida |

## Scheduler (scheduler.js)

O scheduler usa `node-cron` para tarefas automaticas.

### Tarefas Agendadas

| Tarefa | Frequencia (producao) | Descricao |
|--------|----------------------|-----------|
| Auto-close | A cada 5 min | Fecha partidas 1h apos horario_fim |
| Lembretes 2 dias / 1 dia | 9h da manha | Envia lembrete + enquete para quem nao confirmou |
| Lembrete 1h antes | A cada 5 min | Verifica se falta 1h para o jogo |

### Auto-Close

1. Busca partidas abertas com `horario_fim` definido
2. Se passou 1h apos o horario de fim, fecha a partida
3. Envia mensagem no grupo: "Partida encerrada automaticamente"
4. Para grupos `fixo`: cria automaticamente a partida da semana seguinte

### Lembretes (3 fases)

Cada lembrete envia uma mensagem personalizada + enquete de confirmacao no privado.

| Fase | Quando | Mensagem |
|------|--------|----------|
| `2_dias` | 2 dias antes (9h) | "Tem jogo chegando..." |
| `1_dia` | 1 dia antes (9h) | "E amanha!" |
| `1_hora` | 1h antes do jogo | "Falta 1 hora!" |

- So envia para jogadores ativos que **nao confirmaram** e **nao receberam** aquele tipo de lembrete
- Rastreado na tabela `lembretes_enviados` (UNIQUE por partida + jogador + tipo)
- Jogadores com `whatsapp_id` iniciando com "fake" sao ignorados (contas de teste)

### Modo Teste

O scheduler tem uma flag `MODO_TESTE`:
- `true`: lembretes a cada 3 minutos (para testar), envia todos os tipos em sequencia
- `false`: horarios reais de producao (9h + 1h antes dinamico)

## Lista Completa (listaHelper.js)

Todas as listas no bot usam o helper compartilhado `montarListaCompleta()`:

```
⚽ *Nome do Grupo*
📅 sabado, 05/04
⏰ 07:00 - 09:00
📋 5/20

✅ *Confirmados (3):*
1. Sandro
2. Leandro
3. Victor

❌ *Ausentes (15):*
- Carlos
- Pedro
- ...

🔸 *Avulsos (2):*
4. Joao (por Sandro)
5. Rafael (por Leandro)
```

- **Confirmados**: jogadores com presenca confirmada (ordenados por confirmado_em)
- **Ausentes**: jogadores ativos no grupo que NAO confirmaram
- **Avulsos**: jogadores convidados (numerados continuando dos confirmados)

## Arquivos de Comando

| Arquivo | Responsabilidade |
|---------|-----------------|
| `commands/admin.js` | Comandos admin por texto |
| `commands/adminPoll.js` | Menu admin por enquetes (state machine) |
| `commands/ajuda.js` | Ajuda no privado |
| `commands/confirmar.js` | Confirmacao por texto |
| `commands/cancelar.js` | Cancelamento por texto |
| `commands/grupo.js` | !ajuda e !lista no grupo |
| `commands/lista.js` | Lista no privado |

## Utilitarios

### utils/listaHelper.js

| Funcao | Descricao |
|--------|-----------|
| `montarListaCompleta(partidaId, grupoId, grupoNome, ...)` | Monta lista com Confirmados + Ausentes + Avulsos |
| `formatarHorario(h)` | Remove segundos do formato TIME do MySQL (07:00:00 -> 07:00) |

### utils/rateLimit.js

| Funcao | Descricao |
|--------|-----------|
| `verificarRateLimit(id, comando)` | Rate limit 3x/hora. Retorna `{permitido, restante, minutosRestantes}` |
| `delay()` | Atraso aleatorio 1-3s antes de responder |
| `isDuplicado(id, comando)` | Deduplicacao com janela de 10s |

### utils/verificarJogador.js

| Funcao | Descricao |
|--------|-----------|
| `verificarJogadorAtivo(sender, grupoId?)` | Retorna jogador se ativo (no grupo especifico ou em qualquer) |

## Comportamentos Automaticos

- **Auto-setup**: bot adicionado ao grupo = registra grupo + membros + admins automaticamente
- **Auto-cleanup**: bot removido do grupo = deleta todos os dados do grupo em cascata
- **Auto-registro**: bot reiniciado = verifica grupos existentes e registra os que faltam
- **Auto-registro fallback**: mensagem de grupo nao registrado = faz setup na hora
- **Auto-cadastro de membros**: novos membros que entram no grupo sao cadastrados via onParticipantsChanged
- **Auto-desativacao**: membro que sai do grupo e desativado naquele grupo (nao afeta outros)
- **Atualizacao de nome**: nome "Jogador" e atualizado para pushname real ao interagir
- **Controle de vagas**: ao atingir max_jogadores, novas confirmacoes sao recusadas
- **Anti-duplicidade**: INSERT IGNORE impede confirmacao duplicada
- **Silencio total**: mensagens nao reconhecidas sao ignoradas

## Configuracao do WPPConnect

```javascript
{
  session: 'appfut-bot',
  headless: true,
  useChrome: false,
  puppeteerOptions: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
}
```

## Variaveis de Ambiente (.env)

```
DB_HOST=localhost
DB_USER=appfutadmin
DB_PASSWORD=***
DB_NAME=appfut
PORT=3000
```

> O arquivo .env fica apenas no servidor. NUNCA versionar senhas no git.