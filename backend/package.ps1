param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../release'))

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv/Scripts/python.exe'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path

Push-Location $root
try {
    npm --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    & $python -m PyInstaller --noconfirm --onedir --windowed --name PrintNa `
        --icon "$root/backend/printna.ico" --distpath "$output/package" `
        --workpath "$output/build" --specpath $output `
        --add-data "$root/frontend/dist/index.html;frontend/dist" `
        --add-data "$root/frontend/dist/printna.svg;frontend/dist" `
        --add-data "$root/frontend/dist/assets;frontend/dist/assets" backend/desktop.py
    if ($LASTEXITCODE -ne 0) { throw 'Windows package build failed.' }
    Compress-Archive -LiteralPath "$output/package/PrintNa" -DestinationPath "$output/PrintNa-Windows-x64.zip" -Force
} finally {
    Pop-Location
}
