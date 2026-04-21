# Comandos Uteis

## SSH - Acesso ao Servidor

```bash
ssh appfutadmin@31.97.94.250
```

## PM2 - Gerenciamento do Bot

```bash
pm2 status                    # Ver status
pm2 logs appfut-bot           # Logs em tempo real
pm2 logs appfut-bot --lines 30  # Ultimas N linhas
pm2 restart appfut-bot        # Reiniciar
pm2 stop appfut-bot           # Parar
pm2 start appfut-bot          # Iniciar
pm2 monit                     # CPU e memoria
pm2 save                      # Salvar config
```

### Limpar logs de erro (acumulam com o tempo)
```bash
> ~/.pm2/logs/appfut-bot-error.log
```

## MySQL - Banco de Dados

```bash
# Conectar (RECOMENDADO no Ubuntu)
sudo mysql appfut
```

### Operacoes do dia a dia

```sql
-- Ver grupos registrados
SELECT id, nome, tipo, dia_semana, horario_inicio, horario_fim FROM grupos;

-- Ver partidas abertas com contagem
SELECT p.id, g.nome, p.data_partida,
  (SELECT COUNT(*) FROM presencas WHERE partida_id = p.id) as confirmados,
  (SELECT COUNT(*) FROM avulsos WHERE partida_id = p.id) as avulsos,
  p.max_jogadores
FROM partidas p JOIN grupos g ON p.grupo_id = g.id
WHERE p.status = 'aberta';

-- Ver membros por grupo
SELECT g.nome as grupo, j.nome, gj.ativo
FROM grupo_jogadores gj
JOIN grupos g ON gj.grupo_id = g.id
JOIN jogadores j ON gj.jogador_id = j.id
ORDER BY g.nome, gj.ativo DESC, j.nome;

-- Ver lembretes enviados
SELECT le.tipo, j.nome, le.enviado_em
FROM lembretes_enviados le
JOIN jogadores j ON le.jogador_id = j.id
ORDER BY le.enviado_em DESC LIMIT 20;
```

> **Nota:** Essas operacoes agora podem ser feitas pelo WhatsApp com comandos admin.

## Comandos Admin via WhatsApp (recomendado)

Todos os comandos sao enviados **no privado do bot**.

### Menu interativo (enquetes)

```
admin                         -- Abre menu por enquetes
```

### Gestao de Grupos

```
admin grupos                  -- Lista grupos vinculados
admin vincular N              -- Vincula grupo N
```

### Gestao de Jogadores

```
admin participantes           -- Lista membros com status ativo/inativo
admin ativar N                -- Ativa jogador N
admin desativar N             -- Desativa jogador N
admin ativar todos            -- Ativa todos os jogadores do grupo
admin desativar todos         -- Desativa todos os jogadores do grupo
```

### Gestao de Partidas

```
admin criar DD/MM             -- Cria partida com 20 vagas
admin criar DD/MM VAGAS       -- Cria partida com N vagas
admin fechar                  -- Fecha a partida aberta
admin status                  -- Visao geral do grupo
```

### Comandos do Jogador

```
oi                            -- Enquete de confirmacao
corrigir presenca             -- Enquete de cancelamento
confirmar                     -- Confirma por texto
cancelar                      -- Cancela por texto
lista                         -- Lista completa
ajuda                         -- Ajuda
avulso Nome                   -- Adiciona jogador convidado
remover avulso Nome           -- Remove jogador convidado
```

### Exemplo de Fluxo Semanal

```
1. Adicionar bot ao grupo (auto-setup de membros e admins)
2. admin criar 05/04 20       -- Cria partida do sabado (20 vagas)
3. (jogadores confirmam via enquete durante a semana)
4. (2 dias antes: bot envia lembrete automatico as 9h)
5. (1 dia antes: bot envia ultimo lembrete as 9h)
6. (1h antes: bot envia lembrete urgente)
7. (1h apos horario_fim: partida fecha automaticamente)
8. (para grupos fixos: proxima partida criada automaticamente)
```

## Deploy - Atualizar Codigo no Servidor

### Via SCP (do PC local para o servidor)

```bash
# Copiar arquivo de deploy para o servidor (rodar no PC LOCAL, nao no servidor)
scp deploy_NOME.js appfutadmin@31.97.94.250:/home/appfutadmin/appfut/

# No servidor: rodar o script de deploy
cd ~/appfut && node deploy_NOME.js

# Reiniciar o bot
pm2 restart appfut-bot
```

### Scripts de deploy existentes

| Script | O que faz |
|--------|-----------|
| `deploy_autosetup.js` | index.js com auto-setup/cleanup completo |
| `deploy_final.js` | listaHelper.js + lista.js + grupo.js + index.js |
| `deploy_cleanup.js` | Patch: cleanup ao remover bot + ativar/desativar todos |
| `deploy_v3_lembretes.js` | scheduler.js com 3 fases de lembretes |
| `deploy_adminpoll.js` | adminPoll.js (menu admin por enquetes) |
| `fix_participantes.js` | Fix: adminPoll.js com grupo_jogadores |

## Reconectar Sessao do WhatsApp

```bash
# 1. Parar o bot
pm2 stop appfut-bot

# 2. Rodar manualmente para ver o QR Code
cd ~/appfut && node src/bot/index.js

# 3. Escanear QR Code (WhatsApp > Dispositivos conectados)

# 4. Apos "Bot iniciado com sucesso!", Ctrl+C

# 5. Reiniciar via PM2
pm2 start appfut-bot
```

## Limpar Sessao do Zero

```bash
pm2 stop appfut-bot
rm -rf ~/appfut/tokens/appfut-bot
cd ~/appfut && node src/bot/index.js
# Escanear QR Code, Ctrl+C, pm2 start
```

## Reset Completo do Banco

```bash
cd ~/appfut && node -e "
var db = require('./src/database/connection');
async function limpar() {
  await db.execute('DELETE FROM lembretes_enviados');
  await db.execute('DELETE FROM avulsos');
  await db.execute('DELETE FROM presencas');
  await db.execute('DELETE FROM partidas');
  await db.execute('DELETE FROM grupo_jogadores');
  await db.execute('DELETE FROM admins');
  await db.execute('DELETE FROM jogadores');
  await db.execute('DELETE FROM grupos');
  console.log('Banco limpo!');
  process.exit();
}
limpar();
"
```

## Firewall

```bash
sudo ufw status          # Ver regras
sudo ufw allow PORTA/tcp # Liberar porta
```

## Sistema

```bash
sudo apt update && sudo apt upgrade -y   # Atualizar
df -h                                      # Disco
free -h                                    # Memoria
sudo reboot                                # Reiniciar
```
