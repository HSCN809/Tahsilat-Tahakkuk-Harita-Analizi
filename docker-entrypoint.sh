#!/bin/sh
set -e

# Railway volume'u root'a ait mount eder. appuser'in yazabilmesi icin chown.
[ -d /app/veriler ] && chown appuser:appuser /app/veriler 2>/dev/null || true
[ -n "$BACKUP_DIR" ] && mkdir -p "$BACKUP_DIR" 2>/dev/null && chown appuser:appuser "$BACKUP_DIR" 2>/dev/null || true

# appuser olarak uygulamayi baslat
exec su -s /bin/sh appuser -c '
    cd "/app/Tahsilat Tahakkuk Harita Analizi"
    exec /usr/bin/tini -s -- uvicorn api:app \
        --host "${HOST:-0.0.0.0}" \
        --port "${PORT:-8080}" \
        --workers "${WORKERS:-1}" \
        --proxy-headers \
        --forwarded-allow-ips="*" \
        --no-access-log \
        --timeout-graceful-shutdown 30
'
