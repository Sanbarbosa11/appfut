#!/bin/bash
# backup_producao.sh — Snapshot completo do ambiente de producao AppFut.
#
# O que salva:
#   1. Dump do banco MySQL (appfut)
#   2. Arquivos .env (credenciais fora do git)
#   3. Tarball comprimido de tudo acima com timestamp
#
# Uso:
#   chmod +x ~/appfut/backup_producao.sh
#   ~/appfut/backup_producao.sh
#
# Saida: ~/backups/producao/appfut_producao_YYYYMMDD_HHMM.tar.gz
# Retencao: ultimos 10 backups (os mais antigos sao apagados automaticamente)

set -e

APP_DIR="/home/appfutadmin/appfut"
BACKUP_DIR="/home/appfutadmin/backups/producao"
DATE=$(date +%Y%m%d_%H%M)
STAGING="/tmp/appfut_backup_$DATE"
FINAL="$BACKUP_DIR/appfut_producao_$DATE.tar.gz"

echo "================================================"
echo " AppFut — Backup de Producao"
echo " Data/hora: $(date '+%d/%m/%Y %H:%M')"
echo "================================================"

mkdir -p "$BACKUP_DIR"
mkdir -p "$STAGING"

# ── 1. Banco de dados ──────────────────────────────────────────────────────────
echo "[1/3] Exportando banco de dados..."
sudo mysqldump appfut > "$STAGING/appfut_banco.sql"
echo "      OK — $(wc -l < "$STAGING/appfut_banco.sql") linhas"

# ── 2. Arquivos de configuracao (.env) ────────────────────────────────────────
echo "[2/3] Copiando arquivos de configuracao..."
mkdir -p "$STAGING/config"

if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$STAGING/config/meta.env"
  echo "      OK — .env (Meta bot)"
else
  echo "      AVISO: .env nao encontrado"
fi

if [ -f "$APP_DIR/evolution/.env.evolution" ]; then
  cp "$APP_DIR/evolution/.env.evolution" "$STAGING/config/evolution.env"
  echo "      OK — evolution/.env.evolution"
else
  echo "      AVISO: .env.evolution nao encontrado"
fi

# PM2 ecosystem (se existir)
if [ -f "$APP_DIR/ecosystem.config.js" ]; then
  cp "$APP_DIR/ecosystem.config.js" "$STAGING/config/ecosystem.config.js"
  echo "      OK — ecosystem.config.js"
fi

# ── 3. Estado atual do PM2 ────────────────────────────────────────────────────
echo "[3/3] Capturando estado do PM2..."
pm2 list --no-color > "$STAGING/pm2_status.txt" 2>&1 || true
pm2 save --no-color > /dev/null 2>&1 || true
if [ -f "$HOME/.pm2/dump.pm2" ]; then
  cp "$HOME/.pm2/dump.pm2" "$STAGING/config/pm2_dump.pm2"
  echo "      OK — pm2 dump salvo"
fi

# ── Compactar tudo ────────────────────────────────────────────────────────────
echo ""
echo "Compactando backup..."
tar -czf "$FINAL" -C "/tmp" "appfut_backup_$DATE"
rm -rf "$STAGING"

SIZE=$(du -sh "$FINAL" | cut -f1)
echo "Arquivo: $FINAL ($SIZE)"

# ── Retencao: manter apenas os 10 mais recentes ───────────────────────────────
TOTAL=$(ls -1 "$BACKUP_DIR"/appfut_producao_*.tar.gz 2>/dev/null | wc -l)
if [ "$TOTAL" -gt 10 ]; then
  REMOVER=$((TOTAL - 10))
  ls -1t "$BACKUP_DIR"/appfut_producao_*.tar.gz | tail -"$REMOVER" | xargs rm -f
  echo "Retencao: $REMOVER backup(s) antigo(s) removido(s), mantendo os 10 mais recentes"
fi

echo ""
echo "================================================"
echo " Backup concluido com sucesso!"
echo " Para restaurar o banco:"
echo "   tar -xzf $FINAL -C /tmp"
echo "   sudo mysql appfut < /tmp/appfut_backup_$DATE/appfut_banco.sql"
echo "================================================"
