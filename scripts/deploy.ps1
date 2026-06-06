# FitSquad deploy (Windows / локальная сборка перед VPS)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "[deploy] building..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "[deploy] docker compose up..."
    docker compose up -d --build
    Start-Sleep -Seconds 3
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health"
        Write-Host "[deploy] health:" ($r | ConvertTo-Json -Compress)
    } catch {
        Write-Warning "[deploy] health check failed — проверьте логи: docker compose logs -f"
    }
} else {
    Write-Host "[deploy] Docker не найден. Запуск без контейнера:"
    Write-Host "  npm start"
}

Write-Host "[deploy] done"
