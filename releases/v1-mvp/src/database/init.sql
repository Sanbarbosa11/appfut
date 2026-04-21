CREATE TABLE IF NOT EXISTS grupos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_id VARCHAR(50) UNIQUE NOT NULL,
  nome VARCHAR(100),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tipo ENUM('fixo', 'variavel') DEFAULT 'variavel',
  dia_semana INT,
  horario_inicio TIME,
  horario_fim TIME,
  max_jogadores INT DEFAULT 20
);

CREATE TABLE IF NOT EXISTS jogadores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_id VARCHAR(50) UNIQUE NOT NULL,
  nome VARCHAR(100),
  telefone VARCHAR(20),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grupo_jogadores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  jogador_id INT NOT NULL,
  ativo BOOLEAN DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_grupo_jogador (grupo_id, jogador_id),
  FOREIGN KEY (grupo_id) REFERENCES grupos(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
);

CREATE TABLE IF NOT EXISTS partidas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  data_partida DATE NOT NULL,
  status ENUM('aberta', 'fechada') DEFAULT 'aberta',
  max_jogadores INT DEFAULT 20,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id)
);

CREATE TABLE IF NOT EXISTS presencas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NOT NULL,
  confirmado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_presenca (partida_id, jogador_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
);

CREATE TABLE IF NOT EXISTS ausentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ausente (partida_id, jogador_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE,
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS duvidas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  jogador_id INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_duvida (partida_id, jogador_id),
  FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE,
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS avulsos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partida_id INT NOT NULL,
  nome VARCHAR(100) NOT NULL,
  adicionado_por INT NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (partida_id) REFERENCES partidas(id),
  FOREIGN KEY (adicionado_por) REFERENCES jogadores(id)
);

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id INT NOT NULL,
  whatsapp_id VARCHAR(50) NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id)
);

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
