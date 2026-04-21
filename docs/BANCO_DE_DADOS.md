# Banco de Dados

## Acesso ao MySQL

```bash
# Conectar como root (via sudo, sem senha) - RECOMENDADO no Ubuntu
sudo mysql appfut

# Conectar como usuario do projeto
mysql -u appfutadmin -p appfut
```

### Credenciais

| Item | Valor |
|------|-------|
| Host | localhost |
| Database | appfut |
| Usuario | appfutadmin |
| Senha | (definida no .env do servidor) |

> O root do MySQL usa autenticacao por socket (sem senha, apenas via sudo)

## Estrutura das Tabelas (8 tabelas)

### grupos

Grupos de WhatsApp registrados automaticamente quando o bot entra.

```sql
CREATE TABLE IF NOT EXISTS grupos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_id VARCHAR(50) UNIQUE NOT NULL,  -- ID do grupo (ex: 120363...@g.us)
  nome VARCHAR(100),                         -- Nome do grupo (auto-detectado)
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tipo ENUM('fixo', 'variavel') DEFAULT 'variavel',
  dia_semana INT,                            -- Dia fixo da semana (0=dom, 6=sab)
  horario_inicio TIME,                       -- Horario de inicio do jogo
  horario_fim TIME,                          -- Horario de fim (usado pelo auto-close)
  max_jogadores INT DEFAULT 20
);
```

### jogadores

Cadastro automatico dos jogadores ao entrar no grupo ou interagir com o bot.

```sql
CREATE TABLE IF NOT EXISTS jogadores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_id VARCHAR(50) UNIQUE NOT NULL,  -- ID do jogador (ex: ...@lid)
  nome VARCHAR(100),                         -- pushname do WhatsApp (atualizado automaticamente)
  telefone VARCHAR(20),                      -- (reservado para uso futuro)
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### grupo_jogadores

Relacionamento N:N entre jogadores e grupos. Controla status ativo/inativo **por grupo**.

```sql
CREATE TABLE IF NOT EXISTS grupo_jogadores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  jogador_id INT NOT NULL,
  ativo BOOLEAN DEFAULT TRUE,               -- Ativo neste grupo especifico
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_grupo_jogador (grupo_id, jogador_id),
  FOREIGN KEY (grupo_id) REFERENCES grupos(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
);
```

> Um mesmo jogador pode estar ativo no Grupo A e inativo no Grupo B.

### partidas

Registra as partidas/jogos de cada grupo. Apenas uma partida aberta por grupo.

```sql
CREATE TABLE IF NOT EXISTS partidas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  data_partida DATE NOT NULL,
  status ENUM('aberta', 'fechada') DEFAULT 'aberta',
  max_jogadores INT DEFAULT 20,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id)
);
```

### presencas

Controle de quem confirmou presenca em cada partida.

```sql
CREATE TABLE IF NOT EXISTS presencas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NOT NULL,
  confirmado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_presenca (partida_id, jogador_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
);
```

### avulsos

Jogadores convidados que nao fazem parte do grupo (adicionados por membros).

```sql
CREATE TABLE IF NOT EXISTS avulsos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  nome VARCHAR(100) NOT NULL,               -- Nome do avulso (texto livre)
  adicionado_por INT NOT NULL,              -- FK para jogadores (quem adicionou)
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (partida_id) REFERENCES partidas(id),
  FOREIGN KEY (adicionado_por) REFERENCES jogadores(id)
);
```

### admins

Admins de cada grupo (detectados automaticamente do WhatsApp no setup).

```sql
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  whatsapp_id VARCHAR(50) NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id)
);
```

### lembretes_enviados

Rastreia lembretes ja enviados para evitar duplicidade.

```sql
CREATE TABLE IF NOT EXISTS lembretes_enviados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NOT NULL,
  tipo ENUM('2_dias', '1_dia', '1_hora') NOT NULL,
  enviado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_lembrete (partida_id, jogador_id, tipo),
  FOREIGN KEY (partida_id) REFERENCES partidas(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
);
```

## Diagrama de Relacionamento

```
grupos (1) ──── (N) partidas (1) ──── (N) presencas (N) ──── (1) jogadores
  │                    │                                          │
  │                    ├──── (N) avulsos                          │
  │                    │                                          │
  │                    └──── (N) lembretes_enviados ──── (1) ─────┘
  │
  ├──── (N) grupo_jogadores (N) ──── (1) jogadores
  │
  └──── (N) admins
```

- **grupo_jogadores**: tabela central que define quem pertence a cada grupo e se esta ativo
- Um jogador pode estar em varios grupos com status diferente em cada um
- Avulsos sao por partida (nao pertencem ao grupo)
- Lembretes rastreados por (partida, jogador, tipo) para evitar repeticao

## Fluxo de Dados

### Auto-Setup (bot adicionado ao grupo)
1. `INSERT INTO grupos` (whatsapp_id, nome)
2. Para cada membro: `INSERT IGNORE INTO jogadores` + `INSERT IGNORE INTO grupo_jogadores`
3. Para admins do WhatsApp: `INSERT IGNORE INTO admins`

### Auto-Cleanup (bot removido do grupo)
1. `DELETE FROM avulsos` (via partidas do grupo)
2. `DELETE FROM lembretes_enviados` (via partidas do grupo)
3. `DELETE FROM presencas` (via partidas do grupo)
4. `DELETE FROM partidas` (do grupo)
5. `DELETE FROM grupo_jogadores` (do grupo)
6. `DELETE FROM admins` (do grupo)
7. `DELETE FROM grupos` (o grupo em si)

## Formato de IDs do WhatsApp

| Tipo | Formato | Exemplo |
|------|---------|---------|
| Pessoa | `numero@lid` | `228805943816445@lid` |
| Grupo | `numero@g.us` | `120363022718408646@g.us` |

> O formato `@lid` e o mais recente do WhatsApp. Versoes anteriores usavam `@c.us`.

## Queries Uteis

### Ver grupos cadastrados
```sql
SELECT id, nome, tipo, dia_semana, horario_inicio, horario_fim, max_jogadores FROM grupos;
```

### Ver membros por grupo
```sql
SELECT g.nome as grupo, j.nome as jogador, gj.ativo
FROM grupo_jogadores gj
JOIN grupos g ON gj.grupo_id = g.id
JOIN jogadores j ON gj.jogador_id = j.id
ORDER BY g.nome, gj.ativo DESC, j.nome;
```

### Ver partidas abertas com contagem
```sql
SELECT p.id, g.nome, p.data_partida,
  (SELECT COUNT(*) FROM presencas WHERE partida_id = p.id) as confirmados,
  (SELECT COUNT(*) FROM avulsos WHERE partida_id = p.id) as avulsos,
  p.max_jogadores
FROM partidas p
JOIN grupos g ON p.grupo_id = g.id
WHERE p.status = 'aberta';
```

### Ver confirmados de uma partida
```sql
SELECT j.nome, pr.confirmado_em
FROM presencas pr
JOIN jogadores j ON pr.jogador_id = j.id
WHERE pr.partida_id = ?
ORDER BY pr.confirmado_em;
```

### Ver avulsos de uma partida
```sql
SELECT a.nome, j.nome as adicionado_por, a.criado_em
FROM avulsos a
JOIN jogadores j ON a.adicionado_por = j.id
WHERE a.partida_id = ?;
```

### Ver lembretes enviados
```sql
SELECT le.tipo, j.nome, le.enviado_em, g.nome as grupo
FROM lembretes_enviados le
JOIN jogadores j ON le.jogador_id = j.id
JOIN partidas p ON le.partida_id = p.id
JOIN grupos g ON p.grupo_id = g.id
ORDER BY le.enviado_em DESC;
```

### Limpar dados de teste (reset completo)
```sql
DELETE FROM lembretes_enviados;
DELETE FROM avulsos;
DELETE FROM presencas;
DELETE FROM partidas;
DELETE FROM grupo_jogadores;
DELETE FROM admins;
DELETE FROM jogadores;
DELETE FROM grupos;
```
