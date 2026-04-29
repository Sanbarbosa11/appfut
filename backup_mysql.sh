#!/bin/bash
# backup_mysql.sh — Backup diario do banco appfut com retencao de 7 dias.
#
# Instalar no servidor:
#   chmod +x /home/appfutadmin/appfut/backup_mysql.sh
#
# Adicionar ao cron (sudo crontab -e ou crontab -e do usuario appfutadmin):
#   0 3 * * * /home/appfutadmin/appfut/backup_mysql.sh >> /home/appfutadmin/backup.log 2>&1

BACKUP_DIR="/home/appfutadmin/backups"
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$BACKUP_DIR"

mysqldump appfut > "$BACKUP_DIR/appfut_$DATE.sql"
if [ $? -ne 0 ]; then
  echo "[$DATE] ERRO: mysqldump falhou." >&2
  exit 1
fi

gzip "$BACKUP_DIR/appfut_$DATE.sql"

# Remover backups com mais de 7 dias
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "[$DATE] Backup concluido: appfut_$DATE.sql.gz"
