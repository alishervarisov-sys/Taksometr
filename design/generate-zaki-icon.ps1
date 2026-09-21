Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

$repo = Split-Path $PSScriptRoot -Parent
$blueLight = [System.Windows.Media.Color]::FromRgb(0x43, 0x8F, 0xF8)
$blueDark = [System.Windows.Media.Color]::FromRgb(0x24, 0x69, 0xD4)

function Render-IconPng([int]$size, [bool]$round = $false) {
    $visual = [System.Windows.Media.DrawingVisual]::new()
    $drawing = $visual.RenderOpen()
    $scale = $size / 512.0
    $drawing.PushTransform([System.Windows.Media.ScaleTransform]::new($scale, $scale))

    $gradient = [System.Windows.Media.LinearGradientBrush]::new($blueLight, $blueDark, 45.0)
    if ($round) {
        $drawing.DrawEllipse($gradient, $null, [System.Windows.Point]::new(256, 256), 256, 256)
    } else {
        $drawing.DrawRoundedRectangle(
            $gradient, $null,
            [System.Windows.Rect]::new(0, 0, 512, 512), 112, 112
        )
    }

    $route = [System.Windows.Media.Geometry]::Parse('M 137,156 H 365 L 147,356 H 375')
    $line = [System.Windows.Media.Pen]::new([System.Windows.Media.Brushes]::White, 48)
    $line.StartLineCap = [System.Windows.Media.PenLineCap]::Round
    $line.EndLineCap = [System.Windows.Media.PenLineCap]::Round
    $line.LineJoin = [System.Windows.Media.PenLineJoin]::Round
    $drawing.DrawGeometry($null, $line, $route)

    $endPoint = [System.Windows.Point]::new(375, 356)
    $drawing.DrawEllipse([System.Windows.Media.Brushes]::White, $null, $endPoint, 28, 28)
    $drawing.DrawEllipse([System.Windows.Media.SolidColorBrush]::new($blueDark), $null, $endPoint, 11, 11)
    $drawing.Pop()
    $drawing.Close()

    $bitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
        $size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32
    )
    $bitmap.Render($visual)
    $encoder = [System.Windows.Media.Imaging.PngBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [System.IO.MemoryStream]::new()
    $encoder.Save($stream)
    return $stream.ToArray()
}

$fullSizePng = Render-IconPng 512
$pngTargets = @(
    'design/zaki-app-icon.png',
    'admin-panel/public/favicon.png',
    'firebase/hosting/favicon.png',
    'hosting/favicon.png',
    'android/app/src/main/assets/admin/favicon.png'
)
foreach ($relativePath in $pngTargets) {
    [System.IO.File]::WriteAllBytes((Join-Path $repo $relativePath), $fullSizePng)
}

foreach ($density in @(
    @{ Name = 'mdpi'; Size = 48 },
    @{ Name = 'hdpi'; Size = 72 },
    @{ Name = 'xhdpi'; Size = 96 },
    @{ Name = 'xxhdpi'; Size = 144 },
    @{ Name = 'xxxhdpi'; Size = 192 }
)) {
    $folder = Join-Path $repo "android/app/src/main/res/mipmap-$($density.Name)"
    [System.IO.File]::WriteAllBytes((Join-Path $folder 'ic_launcher.png'), (Render-IconPng $density.Size))
    [System.IO.File]::WriteAllBytes((Join-Path $folder 'ic_launcher_round.png'), (Render-IconPng $density.Size $true))
}

$svgSource = Join-Path $PSScriptRoot 'zaki-app-icon.svg'
foreach ($relativePath in @(
    'admin-panel/public/app-icon.svg',
    'firebase/hosting/app-icon.svg',
    'hosting/app-icon.svg',
    'android/app/src/main/assets/admin/app-icon.svg'
)) {
    Copy-Item -LiteralPath $svgSource -Destination (Join-Path $repo $relativePath) -Force
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @($sizes | ForEach-Object { ,(Render-IconPng $_) })
$icoStream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($icoStream)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $writer.Write([byte]$(if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }))
    $writer.Write([byte]$(if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$i].Length)
    $writer.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
$writer.Flush()
[System.IO.File]::WriteAllBytes(
    (Join-Path $repo 'windows/ZaKi.Dispatcher/Assets/zaki.ico'),
    $icoStream.ToArray()
)
Write-Output 'ZaKi web PNG/SVG and Windows ICO generated.'
