param(
    [string]$Version = '3.1.1',
    [string]$Destination = "release/gamehub-offline-3.1.1",
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Invoke-Docker([string[]]$arguments) {
    & docker @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($arguments -join ' ')" }
}
function Copy-Tree([string]$from, [string]$to) {
    $excluded = @('node_modules', 'dist', '.review', 'test-results', 'playwright-report', '__pycache__', '.pytest_cache', '.ruff_cache', '.git', '.idea', '_logs')
    New-Item -ItemType Directory -Path $to -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
        if ($item.Name -in $excluded -or $item.Name -match '\.tsbuildinfo$|\.pyc$') { continue }
        $target = Join-Path $to $item.Name
        if ($item.PSIsContainer) { Copy-Tree $item.FullName $target }
        else { Copy-Item -LiteralPath $item.FullName -Destination $target }
    }
}
function File-Hash([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

$destinationPath = [IO.Path]::GetFullPath((Join-Path $root $Destination))
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination already exists; choose a new folder.' }
$commit = (& git rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) { throw 'Prepare an offline release from a committed Git checkout.' }
if (@(& git status --porcelain).Count -ne 0) { throw 'Commit or remove source changes before preparing a release.' }
foreach ($path in @('offline/npm/cache/_cacache', 'offline/python/wheels', 'frontend/package-lock.json', 'requirements.lock')) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing offline dependency: $path. Run scripts/vendor-deps.ps1 on the preparation machine." }
}
Invoke-Docker @('version', '--format', '{{.Server.Version}}')
foreach ($tag in @('node:22-alpine', 'python:3.11-slim', 'nginx:1.27-alpine', 'postgres:16-alpine', 'redis:7-alpine')) {
    Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $tag)
}
if (-not $SkipBuild) {
    Invoke-Docker @('build', '--pull=false', '--network', 'none', '-f', 'deploy/Dockerfile.backend.offline', '-t', "gamehub-backend:$Version", '.')
    Invoke-Docker @('build', '--pull=false', '--network', 'none', '-f', 'deploy/Dockerfile.frontend.offline', '-t', "gamehub-frontend:$Version", '.')
} else {
    Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', "gamehub-backend:$Version")
    Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', "gamehub-frontend:$Version")
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
foreach ($directory in @('backend', 'shared', 'simulation', 'demo-games', 'frontend', 'deploy', 'scripts', 'docs')) {
    Copy-Tree (Join-Path $root $directory) (Join-Path $destinationPath $directory)
}
foreach ($name in @('compose.yaml', 'compose.offline.build.yaml', 'alembic.ini', 'requirements.lock', '.env.example', '.dockerignore', 'README.md', 'OFFLINE_INSTALL.md', 'OFFLINE_UPDATE.md', 'BACKUP_RESTORE.md', 'ROLLBACK.md')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $destinationPath $name)
}
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'offline/npm') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'offline/python') -Force | Out-Null
foreach ($name in @('dependencies.json', 'dependency-hashes.json')) {
    Copy-Item -LiteralPath (Join-Path $root "offline/$name") -Destination (Join-Path $destinationPath "offline/$name") -Force
}
Copy-Tree (Join-Path $root 'offline/npm/cache') (Join-Path $destinationPath 'offline/npm/cache')
Copy-Tree (Join-Path $root 'offline/python/wheels') (Join-Path $destinationPath 'offline/python/wheels')
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'offline/images') -Force | Out-Null
$archive = Join-Path $destinationPath 'offline/images/gamehub-images.tar'
Invoke-Docker @('save', '-o', $archive, "gamehub-backend:$Version", "gamehub-frontend:$Version", 'node:22-alpine', 'python:3.11-slim', 'nginx:1.27-alpine', 'postgres:16-alpine', 'redis:7-alpine')
$imageHash = File-Hash $archive
Set-Content -LiteralPath "$archive.sha256" -Value "$imageHash  gamehub-images.tar" -Encoding ascii
$example = Join-Path $destinationPath '.env.example'
$config = Get-Content -LiteralPath $example -Raw
$config = $config -replace '(?m)^GAMEHUB_VERSION=.*$', "GAMEHUB_VERSION=$Version"
[IO.File]::WriteAllText($example, $config)

$hashes = @{}
foreach ($file in Get-ChildItem -LiteralPath $destinationPath -File -Recurse) {
    $relative = $file.FullName.Substring($destinationPath.Length + 1).Replace('\', '/')
    $hashes[$relative] = File-Hash $file.FullName
}
$manifest = [ordered]@{
    version = $Version
    tag = "v$Version"
    source_commit = $commit
    created = (Get-Date).ToUniversalTime().ToString('o')
    platform = 'linux/amd64'
    images = @("gamehub-backend:$Version", "gamehub-frontend:$Version", 'node:22-alpine', 'python:3.11-slim', 'nginx:1.27-alpine', 'postgres:16-alpine', 'redis:7-alpine')
    files = $hashes
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destinationPath 'offline/manifest.json') -Encoding utf8
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'backups') -Force | Out-Null
Write-Host "Offline package ready: $destinationPath"
Write-Host 'No .env, database, user uploads or existing backup contents were included.'
