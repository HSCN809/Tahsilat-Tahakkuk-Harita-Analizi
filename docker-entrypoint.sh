#!/bin/sh
set -e

# Railway volume'u root:root mount eder. appuser'in yazabilmesi icin chown.
[ -d /app/veriler ] && chown -R appuser:appuser /app/veriler 2>/dev/null || true
[ -n "$BACKUP_DIR" ] && mkdir -p "$BACKUP_DIR" && chown -R appuser:appuser "$BACKUP_DIR" 2>/dev/null || true

# Chromium'un temp dosyalari icin appuser'a writable HOME
export HOME=/home/appuser

# gosu: root'tan appuser'a gec, sinyal iletimini koru
cd "/app/Tahsilat Tahakkuk Harita Analizi"
exec gosu appuser /usr/bin/tini -- uvicorn api:app \
    --host "${HOST:-0.0.0.0}" \
    --port "${PORT:-8080}" \
    --workers "${WORKERS:-1}" \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --no-access-log \
    --timeout-graceful-shutdown 30
