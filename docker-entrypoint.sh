#!/bin/sh
set -e

# Railway volume'u root:root mount eder. appuser'in yazabilmesi icin chown.
[ -d /app/veriler ] && chown -R appuser:appuser /app/veriler 2>/dev/null || true
[ -n "$BACKUP_DIR" ] && mkdir -p "$BACKUP_DIR" && chown -R appuser:appuser "$BACKUP_DIR" 2>/dev/null || true

# Chromium'un temp dosyalari icin appuser'a writable HOME
export HOME=/home/appuser

# gosu: root'tan appuser'a gec, sinyal iletimini koru
if command -v gosu >/dev/null 2>&1; then
    exec gosu appuser /usr/bin/tini -- /usr/local/bin/backend
else
    exec /usr/bin/tini -- /usr/local/bin/backend
fi
