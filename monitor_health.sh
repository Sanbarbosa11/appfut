#!/bin/bash
# monitor_health.sh — Verifica se evolution-webhook esta respondendo.
# Reinicia o processo e registra log se o health check falhar.
#
# Instalar no servidor:
#   chmod +x /home/appfutadmin/appfut/monitor_health.sh
#
# Adicionar ao cron (crontab -e do usuario appfutadmin):
#   */5 * * * * /home/appfutadmin/appfut/monitor_health.sh >> /home/appfutadmin/monitor.log 2>&1

PORT="${WEBHOOK_PORT:-3002}"
LOG_FILE="/home/appfutadmin/monitor.log"
NOW=$(date '+%Y-%m-%d %H:%M:%S')

HEALTH=$(curl -s --max-time 10 "http://127.0.0.1:$PORT/health" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok',False))" 2>/dev/null)

if [ "$HEALTH" != "True" ]; then
  echo "[$NOW] ALERTA: health check falhou (got: '$HEALTH'). Reiniciando evolution-webhook..."
  pm2 restart evolution-webhook
  echo "[$NOW] evolution-webhook reiniciado."
else
  : # ok — sem log para nao poluir
fi
