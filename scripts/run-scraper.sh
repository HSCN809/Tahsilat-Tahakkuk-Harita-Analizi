#!/usr/bin/env bash
# Manuel veri çekme tetikleyici (one-shot scraper).
#
# Kullanım:
#   ./scripts/run-scraper.sh 2024-2025
#   ./scripts/run-scraper.sh hepsi
#
# Container işi bitirince otomatik silinir (--rm).
# Veriler veriler_named volume'una yazılır; backend aynı volume'u paylaşır.
set -euo pipefail

YEARS="${1:-hepsi}"

cd "$(dirname "$0")/.."

docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  -e SCRAPE_YEARS="$YEARS" \
  scraper \
  "$YEARS"
