-- AppFut Security Migration
-- Roda UMA VEZ no servidor:
--   sudo mysql appfut < evolution/database/migration_security.sql

-- Problema 5: coluna ativo e boas_vindas_at (caso ainda nao existam)
ALTER TABLE grupos ADD COLUMN IF NOT EXISTS ativo          BOOLEAN  DEFAULT TRUE;
ALTER TABLE grupos ADD COLUMN IF NOT EXISTS boas_vindas_at DATETIME DEFAULT NULL;

-- Problema 5: token de convite para entrar no grupo (substitui ID sequencial)
ALTER TABLE grupos ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64) UNIQUE DEFAULT NULL;

-- Preenche tokens para grupos ja existentes (executa apenas onde nulo)
UPDATE grupos
SET    invite_token = LOWER(HEX(RANDOM_BYTES(16)))
WHERE  invite_token IS NULL;

-- Problema 2: rate limit persistente (sobrevive restarts)
CREATE TABLE IF NOT EXISTS rate_limits (
  chave       VARCHAR(200) PRIMARY KEY,
  chamadas    JSON          NOT NULL,
  atualizado  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP
);

-- Problema 7: sessoes admin persistentes (sobrevive restarts)
-- ultima_lista: JSON [{id, nome, ativo}] — indice usado em "admin ativar N"
CREATE TABLE IF NOT EXISTS admin_sessoes (
  whatsapp_id   VARCHAR(100) PRIMARY KEY,
  grupo_id      INT          NOT NULL,
  grupo_nome    VARCHAR(255),
  ultima_lista  JSON         DEFAULT NULL,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
);
