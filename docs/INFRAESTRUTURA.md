# Infraestrutura e Servidor

## Dados do Servidor (Hostinger VPS)

| Item | Valor |
|------|-------|
| Provedor | Hostinger |
| Plano | KVM 2 |
| IP | 31.97.94.250 |
| Hostname | srv1076320.hstgr.cloud |
| SO | Ubuntu 22.04 LTS |
| CPU | 2 nucleos |
| RAM | 8 GB |
| Disco | 100 GB |
| Localizacao | Brazil - Sao Paulo |
| Timezone | America/Sao_Paulo |
| Validade | 2026-10-20 |

## Acesso SSH

```bash
# Acesso com usuario admin (recomendado)
ssh appfutadmin@31.97.94.250

# Acesso root (apenas quando necessario)
ssh root@31.97.94.250
```

### Usuarios do Sistema

| Usuario | Funcao | Acesso sudo |
|---------|--------|-------------|
| root | Administrador do sistema | sim |
| appfutadmin | Usuario do projeto/aplicacao | sim |

## Firewall (UFW)

| Porta | Servico | Status |
|-------|---------|--------|
| 22 | SSH (OpenSSH) | Liberada |
| 80 | HTTP | Liberada |
| 443 | HTTPS | Liberada |

## Software Instalado

| Software | Versao | Finalidade |
|----------|--------|-----------|
| Node.js | 20.20.1 | Runtime do bot |
| npm | 10.8.2 | Gerenciador de pacotes |
| PM2 | latest | Process manager (24/7) |
| MySQL | 8.0.45 | Banco de dados |
| Chromium | 146.x (snap) | Navegador headless para WPPConnect |

### Dependencias do Projeto (npm)

| Pacote | Finalidade |
|--------|-----------|
| @wppconnect-team/wppconnect | Automacao WhatsApp Web |
| mysql2 | Driver MySQL com promises |
| dotenv | Variaveis de ambiente |
| node-cron | Agendamento de tarefas (lembretes, auto-close) |

## PM2 - Process Manager

| Item | Valor |
|------|-------|
| Nome | appfut-bot |
| Script | src/bot/index.js |
| CWD | /home/appfutadmin/appfut |
| Mode | fork |
| Auto-restart | sim |
| Startup | configurado (reinicia com o servidor) |

## Dependencias de Sistema (Chromium)

```bash
sudo apt install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libnspr4 libnss3 \
  libxss1 libxtst6 xdg-utils libdrm2 libx11-xcb1
```

## Historico de Configuracao

### 2026-03-24 - Setup inicial
1. Reinstalacao limpa do Ubuntu 22.04 LTS
2. Atualizacao completa do sistema
3. Firewall (UFW) - portas 22, 80, 443
4. Usuario appfutadmin com sudo
5. Node.js 20 via NodeSource
6. PM2 global + startup automatico
7. Chromium + dependencias graficas
8. MySQL 8 + banco appfut
9. Deploy inicial do projeto

### 2026-03-27 - MVP
10. Deploy MVP completo (enquetes, admin, multi-grupo)
11. Primeiro grupo real vinculado (Futebol Arena Sesc, 39 membros)
12. Rate limit customizavel

### 2026-03-29 - Evolucao
13. Tabela grupo_jogadores (N:N jogador-grupo com status por grupo)
14. Tabela avulsos (jogadores convidados)
15. Tabela lembretes_enviados (rastreamento de notificacoes)
16. listaHelper.js compartilhado (Confirmados + Ausentes + Avulsos)
17. Scheduler com 3 fases de lembretes + auto-close + auto-renew
18. Auto-setup (bot adicionado ao grupo = registra tudo)
19. Auto-cleanup (bot removido = deleta dados em cascata)
20. Menu admin por enquetes (adminPoll.js)
21. Comandos admin ativar/desativar todos
