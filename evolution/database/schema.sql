-- AppFut Evolution — schema isolado em evolution_db

CREATE TABLE IF NOT EXISTS grupos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_id   VARCHAR(100) UNIQUE NOT NULL,
  nome          VARCHAR(255) NOT NULL,
  max_jogadores INT DEFAULT 14,
  horario_inicio TIME DEFAULT NULL,
  horario_fim    TIME DEFAULT NULL,
  criado_em     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jogadores (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_id  VARCHAR(100) UNIQUE NOT NULL,
  nome         VARCHAR(255) NOT NULL,
  criado_em    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grupo_jogadores (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id    INT NOT NULL,
  jogador_id  INT NOT NULL,
  ativo       BOOLEAN DEFAULT TRUE,
  UNIQUE KEY uk_grupo_jogador (grupo_id, jogador_id),
  FOREIGN KEY (grupo_id)   REFERENCES grupos(id)   ON DELETE CASCADE,
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admins (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id    INT NOT NULL,
  whatsapp_id VARCHAR(100) NOT NULL,
  UNIQUE KEY uk_grupo_admin (grupo_id, whatsapp_id),
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS partidas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id      INT NOT NULL,
  data_partida  DATE NOT NULL,
  status        ENUM('aberta','fechada') DEFAULT 'aberta',
  max_jogadores INT DEFAULT 14,
  criado_em     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presencas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  partida_id    INT NOT NULL,
  jogador_id    INT NOT NULL,
  confirmado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_presenca (partida_id, jogador_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id)  ON DELETE CASCADE,
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ausentes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NOT NULL,
  criado_em  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ausente (partida_id, jogador_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id)  ON DELETE CASCADE,
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS avulsos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  partida_id    INT NOT NULL,
  nome          VARCHAR(255) NOT NULL,
  jogador_id    INT DEFAULT NULL,
  adicionado_por INT NOT NULL,
  criado_em     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (partida_id)     REFERENCES partidas(id)  ON DELETE CASCADE,
  FOREIGN KEY (jogador_id)     REFERENCES jogadores(id) ON DELETE SET NULL,
  FOREIGN KEY (adicionado_por) REFERENCES jogadores(id) ON DELETE CASCADE
);
