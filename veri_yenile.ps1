param(
    [string]$Year = "2026"
)

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " [TEK KOMUT] $Year Yili: Once Silme, Sonra Indirme, Sonra DB Aktarimi" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

docker compose -f docker-compose.dev.yml exec backend python scraper/scraper.py $Year
