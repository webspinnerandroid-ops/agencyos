# Generates 128px thumbnails for the AI-team avatar photos in public/team.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-avatar-thumbs.ps1
Add-Type -AssemblyName System.Drawing

$teamDir = Join-Path $PSScriptRoot "..\public\team"
$teamDir = (Resolve-Path $teamDir).Path

$names = @('ak','barry','brett','cheryl','cyril','lana','malory','pam','ray','sterling','woodhouse','team')

foreach ($n in $names) {
    $src = Join-Path $teamDir "$n.png"
    $dst = Join-Path $teamDir "$n-128.png"
    if (-not (Test-Path $src)) { Write-Output "SKIP $n (no source)"; continue }
    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap(128, 128)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, 128, 128)
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose()
    Write-Output "thumb $n"
}
