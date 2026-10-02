param(
    [string]$Version = "1.3.0"
)

$ErrorActionPreference = "Stop"
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Версия должна иметь вид 1.3.0." }
$windowsRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $windowsRoot
$project = Join-Path $windowsRoot "ZaKi.Dispatcher\ZaKi.Dispatcher.csproj"
$publishDirectory = Join-Path $windowsRoot "release\ZaKi-Admin-Windows-$Version"
$installerScript = Join-Path $windowsRoot "installer\ZaKi-Admin-Windows.iss"
$innoSetup = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($null -eq $innoSetup) {
    $innoSetup = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 7\ISCC.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 7\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 7\ISCC.exe")
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($null -eq $innoSetup) {
    throw "Inno Setup не найден. Установите Inno Setup 6 и повторите команду."
}

# Always bundle current sources, not an older archive left by another release.
$webStage = Join-Path $windowsRoot "release\webadmin-$Version"
Push-Location (Join-Path $repositoryRoot "admin-panel")
try {
    npm run build -- --outDir "../windows/release/webadmin-$Version" --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw "Не удалось собрать встроенную панель." }
} finally { Pop-Location }
$archive = Join-Path $windowsRoot "ZaKi.Dispatcher\Assets\webadmin.zip"
$temporaryArchive = "$archive.tmp"
if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive }
[System.IO.Compression.ZipFile]::CreateFromDirectory($webStage, $temporaryArchive)
Move-Item -LiteralPath $temporaryArchive -Destination $archive -Force

dotnet publish $project -c Release -p:Version=$Version -p:FileVersion="$Version.0" -p:AssemblyVersion="$Version.0" -o $publishDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Не удалось опубликовать приложение."
}

$innoSetupPath = if ($innoSetup -is [string]) { $innoSetup } else { $innoSetup.Source }
& $innoSetupPath "/DMyAppVersion=$Version" "/DMyAppSource=$publishDirectory" $installerScript

if ($LASTEXITCODE -ne 0) {
    throw "Не удалось создать установщик."
}
