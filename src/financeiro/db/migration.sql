-- =============================================================
-- FINANCEIRO — Migration v1
-- Roda uma vez no servidor: sudo mysql appfut < migration.sql
--
-- O que faz:
--   1. Adiciona colunas financeiras na tabela grupos
--   2. Cria tabela mensalidades (controle mensal por jogador)
--
-- Nao altera nenhuma tabela existente de forma destrutiva.
-- Todas as colunas novas sao opcionais (DEFAULT NULL / DEFAULT).
-- =============================================================

-- 1. Config financeira por grupo
ALTER TABLE grupos
  ADD COLUMN IF NOT EXISTS valor_mensalidade DECIMAL(6,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pix_chave         VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dia_vencimento    TINYINT      DEFAULT 10;

-- 2. Controle de mensalidades
--    tipo = 'mensalista' → jogador do grupo usou !paguei
--    tipo = 'avulso'     → membro enviou !avulso NOME (externo ao grupo)
--    avulso_nome         → preenchido apenas quando tipo = 'avulso'
--    comprovante_msg_id  → message ID da mensagem original no grupo (Evolution)
--    enviado_por         → whatsapp_id de quem mandou o !paguei / !avulso

CREATE TABLE IF NOT EXISTS mensalidades (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  grupo_id            INT          NOT NULL,
  jogador_id          INT          DEFAULT NULL,
  tipo                ENUM('mensalista','avulso') NOT NULL DEFAULT 'mensalista',
  avulso_nome         VARCHAR(100) DEFAULT NULL,
  enviado_por         VARCHAR(50)  NOT NULL,
  mes_referencia      DATE         NOT NULL,
  status              ENUM('pendente','pago','rejeitado','dispensado') DEFAULT 'pendente',
  comprovante_msg_id  VARCHAR(100) DEFAULT NULL,
  aprovado_por        VARCHAR(50)  DEFAULT NULL,
  pago_em             DATETIME     DEFAULT NULL,
  criado_em           DATETIME     DEFAULT NOW(),
  UNIQUE KEY uk_mensalista (grupo_id, jogador_id, mes_referencia),
  FOREIGN KEY (grupo_id)   REFERENCES grupos(id),
  FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
);
