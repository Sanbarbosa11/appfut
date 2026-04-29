-- Adiciona grupo_preferido_id em jogadores para isolamento multi-grupo
-- Compatível com MySQL 8.0 (sem ADD COLUMN IF NOT EXISTS)

DROP PROCEDURE IF EXISTS _appfut_add_grupo_preferido;

DELIMITER //
CREATE PROCEDURE _appfut_add_grupo_preferido()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'jogadores'
      AND COLUMN_NAME  = 'grupo_preferido_id'
  ) THEN
    ALTER TABLE jogadores
      ADD COLUMN grupo_preferido_id INT NULL,
      ADD CONSTRAINT fk_jogadores_grupo_preferido
        FOREIGN KEY (grupo_preferido_id) REFERENCES grupos(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'avulsos'
      AND COLUMN_NAME  = 'jogador_id'
  ) THEN
    ALTER TABLE avulsos ADD COLUMN jogador_id INT NULL;
  END IF;
END //
DELIMITER ;

CALL _appfut_add_grupo_preferido();
DROP PROCEDURE IF EXISTS _appfut_add_grupo_preferido;
