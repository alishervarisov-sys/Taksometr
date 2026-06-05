# Скрипт для деплоя admin-panel

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Деплой Admin Panel на Firebase" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Шаг 1: Сборка admin-panel
Write-Host "[1/4] Сборка admin-panel..." -ForegroundColor Cyan
Set-Location "../admin-panel"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Ошибка сборки!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Сборка завершена" -ForegroundColor Green
Write-Host ""

# Шаг 2: Очистка hosting
Write-Host "[2/4] Очистка папки hosting..." -ForegroundColor Cyan
Set-Location "../firebase"
Remove-Item -Path "./hosting/*" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "✓ Папка очищена" -ForegroundColor Green
Write-Host ""

# Шаг 3: Копирование файлов
Write-Host "[3/4] Копирование файлов..." -ForegroundColor Cyan
Copy-Item -Path "../admin-panel/dist/index.html" -Destination "./hosting/index.html" -Force
Copy-Item -Path "../admin-panel/dist/assets" -Destination "./hosting/assets" -Recurse -Force
Copy-Item -Path "../admin-panel/dist/favicon.png" -Destination "./hosting/favicon.png" -Force -ErrorAction SilentlyContinue
Write-Host "✓ Файлы скопированы" -ForegroundColor Green
Write-Host ""

# Шаг 4: Деплой
Write-Host "[4/4] Деплой на Firebase Hosting..." -ForegroundColor Cyan
firebase deploy --only hosting
if ($LASTEXITCODE -ne 0) {
    Write-Host "Ошибка деплоя!" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Готово
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✓ Деплой завершен успешно!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "URL: https://zakitaksometr.web.app" -ForegroundColor Yellow
Write-Host ""
Write-Host "Открыть сайт? (y/n): " -NoNewline -ForegroundColor Cyan
$response = Read-Host
if ($response -eq "y" -or $response -eq "Y") {
    Start-Process "https://zakitaksometr.web.app"
}
