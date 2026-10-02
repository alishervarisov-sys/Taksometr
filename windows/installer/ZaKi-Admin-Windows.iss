#ifndef MyAppVersion
  #define MyAppVersion "1.3.0"
#endif

#ifndef MyAppSource
  #define MyAppSource "..\release\ZaKi-Admin-Windows-1.3.0"
#endif

[Setup]
AppId={{B1A3E5E5-4DB8-4194-B0BE-C93EF3039E61}
AppName=ZaKi Admin Windows
AppVersion={#MyAppVersion}
AppPublisher=ZaKi
DefaultDirName={autopf}\ZaKi Admin Windows
DefaultGroupName=ZaKi Admin Windows
UninstallDisplayName=ZaKi Admin Windows
OutputDir=..\release\installer
OutputBaseFilename=ZaKi-Admin-Windows-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
SetupIconFile=..\ZaKi.Dispatcher\Assets\zaki.ico

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"

[Files]
Source: "{#MyAppSource}\ZaKi-Admin-Windows.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\ZaKi Admin Windows"; Filename: "{app}\ZaKi-Admin-Windows.exe"
Name: "{autodesktop}\ZaKi Admin Windows"; Filename: "{app}\ZaKi-Admin-Windows.exe"; Tasks: desktopicon
Name: "{autostartup}\ZaKi Admin Windows"; Filename: "{app}\ZaKi-Admin-Windows.exe"; Parameters: "--background"; Tasks: autostart

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные значки:"; Flags: unchecked
Name: "autostart"; Description: "Запускать ZaKi в фоне при входе в Windows для уведомлений"; GroupDescription: "Уведомления:"

[Run]
Filename: "{app}\ZaKi-Admin-Windows.exe"; Description: "Открыть ZaKi Admin Windows"; Flags: nowait postinstall skipifsilent
