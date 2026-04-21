# Proximos Passos

## Concluido

- [x] Comandos Admin via WhatsApp (texto + menu por enquetes)
- [x] Multi-grupo (bot funciona em varios grupos simultaneamente)
- [x] Enquetes (polls) para confirmar/cancelar presenca
- [x] Rate limit, delay e deduplicacao em todos os comandos
- [x] Silencio total para mensagens nao reconhecidas
- [x] Admin identificado via WhatsApp group metadata (auto-detectado)
- [x] Auto-setup: bot adicionado ao grupo = registra grupo + membros + admins
- [x] Auto-cleanup: bot removido do grupo = limpa todos os dados
- [x] Auto-registro no startup (verifica grupos existentes)
- [x] Auto-registro fallback (mensagem de grupo nao registrado)
- [x] Auto-cadastro de membros entrando/saindo via onParticipantsChanged
- [x] Filtro de jogador ativo por grupo (grupo_jogadores)
- [x] Atualizacao automatica de nome ao interagir
- [x] Lista completa: Confirmados + Ausentes + Avulsos (listaHelper.js)
- [x] Lista exibida apos cada confirmacao/cancelamento
- [x] Jogadores avulsos (convidados por membros)
- [x] Lembretes automaticos 3 fases (2 dias, 1 dia, 1h antes)
- [x] Lembrete com enquete de confirmacao integrada
- [x] Auto-close de partidas (1h apos horario_fim)
- [x] Auto-renew de partidas para grupos fixos
- [x] Admin ativar/desativar todos (bulk)
- [x] Deploy em producao com PM2 + startup automatico

## Prioridade Alta

### 1. Validacao em Producao
Testar fluxo completo no grupo real: auto-setup, criar partida, confirmar/cancelar, lembretes, auto-close.

### 2. Git no Servidor
Versionar o codigo no servidor para facilitar deploys via `git pull` em vez de SCP + scripts.

### 3. Scheduler em Modo Producao
Alterar `MODO_TESTE = false` no scheduler.js apos validacao dos lembretes.

## Prioridade Media

### 4. Cobranca / Financeiro (deadline: 2026-04-10)
- Controle de mensalidades por jogador
- Lembrete automatico de pagamento no privado
- Historico de pagamentos
- Comando: `admin financeiro`

### 5. Lista de Espera
Quando o jogo lota, jogadores ficam em fila. Se alguem cancelar, o proximo e notificado.

### 6. Notificacao no Grupo
Quando a lista fechar (max_jogadores), enviar mensagem no grupo: "Lista fechada! 20/20"

### 7. Relatorios
- Frequencia por jogador (quem mais joga)
- Historico de presencas por periodo
- Jogadores mais assiduos vs faltosos

## Prioridade Baixa

### 8. Painel Web (Dashboard)
Interface web para o admin gerenciar tudo sem WhatsApp.

### 9. Sorteio de Times
Bot sorteia times equilibrados com base em posicoes ou nivel.

### 10. Migracao para Spring/Kotlin
Migrar backend para Java/Kotlin + Spring Boot.
Manter WPPConnect (Node.js) como microservico de mensageria.
