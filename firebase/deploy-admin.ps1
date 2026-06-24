param(
    [switch]$NoOpen
)

# Скрипт для деплоя admin-panel
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Деплой Admin Panel на Firebase" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Вычисляем директорию скрипта (независимо от текущей рабочей директории)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $ScriptDir) { $ScriptDir = Get-Location }

$AdminDir = Join-Path $ScriptDir "..\admin-panel" | Resolve-Path -ErrorAction SilentlyContinue
if ($AdminDir) { $AdminDir = $AdminDir.Path } else { $AdminDir = Join-Path $ScriptDir "..\admin-panel" }

$HostingDir = Join-Path $ScriptDir "hosting"

# Шаг 1: Сборка admin-panel
Write-Host "[1/4] Сборка admin-panel..." -ForegroundColor Cyan
if (-not (Test-Path $AdminDir)) {
    Write-Host "Не найдена папка admin-panel: $AdminDir" -ForegroundColor Red
    exit 1
}
Push-Location $AdminDir
if (-not (Test-Path "node_modules")) {
    Write-Host "node_modules не обнаружен, запускаю npm ci..." -ForegroundColor Yellow
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Host "npm ci завершился с ошибкой" -ForegroundColor Red
        exit 1
    }
}

npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Ошибка сборки!" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host "✓ Сборка завершена" -ForegroundColor Green
Write-Host ""

# Шаг 2: Очистка hosting
Write-Host "[2/4] Очистка папки hosting..." -ForegroundColor Cyan
if (-not (Test-Path $HostingDir)) { New-Item -ItemType Directory -Path $HostingDir | Out-Null }
Get-ChildItem -Path $HostingDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "✓ Папка очищена" -ForegroundColor Green
Write-Host ""

# Шаг 3: Копирование файлов
Write-Host "[3/4] Копирование файлов..." -ForegroundColor Cyan
$DistDir = Join-Path $AdminDir "dist"
if (-not (Test-Path $DistDir)) {
    Write-Host "Папка dist не найдена: $DistDir" -ForegroundColor Red
    exit 1
}

Copy-Item -Path (Join-Path $DistDir "index.html") -Destination (Join-Path $HostingDir "index.html") -Force

$SrcAssets = Join-Path $DistDir "assets"
$DstAssets = Join-Path $HostingDir "assets"
if (Test-Path $DstAssets) { Remove-Item -Path $DstAssets -Recurse -Force -ErrorAction SilentlyContinue }
Copy-Item -Path $SrcAssets -Destination $DstAssets -Recurse -Force

Copy-Item -Path (Join-Path $DistDir "favicon.png") -Destination (Join-Path $HostingDir "favicon.png") -Force -ErrorAction SilentlyContinue
Write-Host "✓ Файлы скопированы" -ForegroundColor Green
Write-Host ""

# Шаг 4: Деплой
Write-Host "[4/4] Деплой на Firebase Hosting..." -ForegroundColor Cyan
Push-Location $ScriptDir
firebase deploy --only hosting
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host "Ошибка деплоя!" -ForegroundColor Red
    exit 1
}
Pop-Location
Write-Host ""

# Готово
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✓ Деплой завершен успешно!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "URL: https://zakitaksometr.web.app" -ForegroundColor Yellow
Write-Host ""
if (-not $NoOpen) {
    $response = Read-Host 'Открыть сайт? (y/n)'
    if ($response -eq 'y' -or $response -eq 'Y') {
        Start-Process 'https://zakitaksometr.web.app'
    }
}
