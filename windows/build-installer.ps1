param(
    [string]$Version = "1.2.0"
)

$ErrorActionPreference = "Stop"
$windowsRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $windowsRoot
$project = Join-Path $windowsRoot "ZaKi.Dispatcher\ZaKi.Dispatcher.csproj"
$publishDirectory = Join-Path $windowsRoot "release\ZaKi-Admin-Windows-$Version"
$installerScript = Join-Path $windowsRoot "installer\ZaKi-Admin-Windows.iss"
$innoSetup = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($null -eq $innoSetup) {
    $innoSetup = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 7\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 7\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 7\ISCC.exe")
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ($null -eq $innoSetup) {
    throw "Inno Setup не найден. Установите Inno Setup 6 и повторите команду."
}

dotnet publish $project -c Release -p:Version=$Version -o $publishDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Не удалось опубликовать приложение."
}

$innoSetupPath = if ($innoSetup -is [string]) { $innoSetup } else { $innoSetup.Source }
& $innoSetupPath "/DMyAppVersion=$Version" "/DMyAppSource=$publishDirectory" $installerScript

if ($LASTEXITCODE -ne 0) {
    throw "Не удалось создать установщик."
}
