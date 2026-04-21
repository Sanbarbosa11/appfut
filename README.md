# AppFut - Bot de Gestao de Rachao via WhatsApp

SaaS de gestao de futebol amador (rachoes) com automacao via WhatsApp.

## Visao Geral

O bot permite que jogadores confirmem presenca, cancelem e consultem a lista de confirmados para partidas de futebol amador, tudo via WhatsApp. A interacao principal e feita por **enquetes (polls)** no privado, minimizando digitacao.

### Funcionalidades

| Funcionalidade | Onde | Descricao |
|----------------|------|-----------|
| Enquete de confirmacao | Privado | Jogador manda `oi`, recebe enquete pra confirmar |
| Enquete de cancelamento | Privado | Comando `corrigir presenca` envia enquete pra cancelar |
| Confirmar/Cancelar texto | Privado | `confirmar` / `cancelar` como fallback |
| Lista completa | Privado/Grupo | Confirmados + Ausentes + Avulsos |
| Jogadores avulsos | Privado | `avulso Nome` / `remover avulso Nome` |
| Lembretes automaticos | Privado | 3 fases: 2 dias, 1 dia e 1h antes do jogo |
| Auto-close | Automatico | Fecha partida 1h apos horario_fim |
| Auto-renew | Automatico | Cria proxima partida para grupos fixos |
| Auto-setup | Automatico | Bot adicionado ao grupo = registra tudo |
| Auto-cleanup | Automatico | Bot removido do grupo = limpa todos os dados |
| Menu admin (poll) | Privado | `admin` abre menu interativo por enquetes |
| Comandos admin (texto) | Privado | `admin criar`, `admin status`, etc. |
| `!ajuda` / `!lista` | Grupo | Unicos comandos que funcionam no grupo |

### Modelo de Interacao

- **No grupo:** apenas `!ajuda` e `!lista` funcionam (evita poluicao). Silencio total para msgs nao reconhecidas
- **No privado (jogador):** `oi` envia enquete de confirmacao. Comandos por texto tambem funcionam
- **No privado (admin):** `admin` abre menu por enquetes, ou `admin <comando>` para texto
- **Enquetes:** 1 clique por enquete, sem repeticao. Para corrigir, digita `corrigir presenca`
- **Listas:** mostradas automaticamente apos cada confirmacao/cancelamento

### Protecoes Anti-Spam

| Protecao | Descricao |
|----------|-----------|
| Rate limit | 3x/hora por comando |
| Delay | 1-3s aleatorio antes de cada resposta |
| Deduplicacao | 10s de janela no grupo (evita burst de !lista) |
| Silencio | Mensagens nao reconhecidas sao ignoradas |
| Filtro ativo | Apenas jogadores ativos (por grupo) interagem com o bot |
| Poll dedup | Set em memoria impede processamento duplicado de cliques na enquete |

### Auto-Setup (como funciona)

1. Adicione o bot ao grupo do WhatsApp
2. O bot detecta a entrada via `onParticipantsChanged`
3. Automaticamente: registra o grupo, cadastra todos os membros, identifica admins do WhatsApp
4. Se o bot reiniciar, verifica todos os grupos onde esta e registra os que faltam
5. Se receber mensagem de grupo nao registrado, faz o setup automatico

### Auto-Cleanup

- Bot removido do grupo = cascading delete de todos os dados (grupo, jogadores, partidas, presencas, avulsos, lembretes, admins)
- Nenhuma acao manual necessaria

## Stack Tecnologica

| Componente | Tecnologia | Versao |
|------------|-----------|--------|
| Runtime | Node.js | 20.20.1 |
| Bot WhatsApp | @wppconnect-team/wppconnect | latest |
| Banco de Dados | MySQL | 8.0.45 |
| Process Manager | PM2 | latest |
| Scheduler | node-cron | latest |
| SO Servidor | Ubuntu | 22.04 LTS |

## Estrutura do Projeto

```
appfut/
├── .env                        # Variaveis de ambiente (apenas no servidor)
├── .env.example                # Template do .env
├── .gitignore                  # node_modules, .env, tokens/, *.log
├── package.json                # Dependencias (apenas no servidor)
├── tokens/                     # Sessao do WhatsApp (gerado automaticamente)
├── deploy_*.js                 # Scripts de deploy (rodar no servidor)
├── fix_*.js                    # Scripts de correcao (rodar no servidor)
├── docs/                       # Documentacao detalhada
│   ├── BANCO_DE_DADOS.md       # Schema, tabelas, queries
│   ├── BOT.md                  # Arquitetura, comandos, fluxos
│   ├── COMANDOS.md             # Comandos uteis (SSH, PM2, MySQL)
│   ├── INFRAESTRUTURA.md       # Servidor, firewall, software
│   └── PROXIMOS_PASSOS.md      # Roadmap e prioridades
├── site/
│   └── index.html              # Dashboard web (futuro)
└── src/
    ├── bot/
    │   ├── index.js            # Orquestrador principal (4 listeners + auto-setup)
    │   ├── scheduler.js        # Cron jobs: lembretes + auto-close + auto-renew
    │   ├── commands/
    │   │   ├── admin.js        # Comandos admin por texto
    │   │   ├── adminPoll.js    # Menu admin por enquetes (state machine)
    │   │   ├── ajuda.js        # Ajuda no privado
    │   │   ├── confirmar.js    # Confirmar presenca (texto)
    │   │   ├── cancelar.js     # Cancelar presenca (texto)
    │   │   ├── grupo.js        # Comandos do grupo (!ajuda, !lista)
    │   │   └── lista.js        # Lista no privado
    │   └── utils/
    │       ├── listaHelper.js  # Monta lista completa (Confirmados/Ausentes/Avulsos)
    │       ├── rateLimit.js    # Rate limit, delay e deduplicacao
    │       └── verificarJogador.js  # Verifica jogador ativo
    └── database/
        ├── connection.js       # Pool de conexoes MySQL
        └── init.sql            # Script de criacao das tabelas
```

## Documentacao Detalhada

- [Banco de Dados](docs/BANCO_DE_DADOS.md) - Schema completo, relacionamentos, queries uteis
- [Bot WhatsApp](docs/BOT.md) - Arquitetura, comandos, fluxos, scheduler
- [Comandos Uteis](docs/COMANDOS.md) - SSH, PM2, MySQL, deploy
- [Infraestrutura](docs/INFRAESTRUTURA.md) - Servidor, firewall, software instalado
- [Proximos Passos](docs/PROXIMOS_PASSOS.md) - Roadmap e prioridades

## Quick Start

### Primeiro uso (servidor novo)

1. Configurar servidor (ver [INFRAESTRUTURA.md](docs/INFRAESTRUTURA.md))
2. Clonar repo e instalar dependencias: `npm install`
3. Copiar `.env.example` para `.env` e configurar credenciais
4. Criar tabelas: `sudo mysql appfut < src/database/init.sql`
5. Iniciar bot: `pm2 start src/bot/index.js --name appfut-bot`
6. Escanear QR Code no celular (primeira vez)
7. Adicionar o bot a um grupo do WhatsApp - setup automatico!

### Uso diario

1. Adicionar bot ao grupo (auto-setup de membros e admins)
2. Admin cria partida: `admin criar DD/MM` ou via menu `admin`
3. Jogadores confirmam via enquete no privado
4. Bot envia lembretes automaticos (2 dias, 1 dia, 1h antes)
5. Partida fecha automaticamente 1h apos horario_fim
6. Para grupos fixos, proxima partida e criada automaticamente
