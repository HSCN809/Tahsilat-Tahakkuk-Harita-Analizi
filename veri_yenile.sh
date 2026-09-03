#!/usr/bin/env bash
YEAR=${1:-2026}
echo "================================================================="
echo " [TEK KOMUT] $YEAR Yili: Once Silme, Sonra Indirme, Sonra DB Aktarimi"
echo "================================================================="
docker compose -f docker-compose.dev.yml exec backend python scraper/scraper.py "$YEAR"
