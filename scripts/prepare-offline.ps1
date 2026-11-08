param(
    [string]$Version = '3.2.2',
    [string]$Destination = "release/gamehub-offline-3.2.2",
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Invoke-Docker([string[]]$arguments) {
    & docker @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($arguments -join ' ')" }
}
function File-Hash([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }

$destinationPath = [IO.Path]::GetFullPath((Join-Path $root $Destination))
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination already exists; choose a new folder.' }
$commit = (& git rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) { throw 'Prepare an offline release from a committed Git checkout.' }
if (@(& git status --porcelain).Count -ne 0) { throw 'Commit or remove source changes before preparing a release.' }
$tag = "v$Version"
if (@(& git tag --points-at HEAD) -notcontains $tag) { throw "Tag $tag must point to this commit." }
foreach ($path in @('offline/npm/cache/_cacache', 'offline/python/wheels', 'frontend/package-lock.json', 'requirements.lock')) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing offline dependency: $path. Run scripts/vendor-deps.ps1 on the preparation machine." }
}
Invoke-Docker @('version', '--format', '{{.Server.Version}}')
foreach ($imageTag in @('node:22-alpine', 'python:3.11-slim', 'nginx:1.27-alpine', 'postgres:16-alpine', 'redis:7-alpine')) {
    Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $imageTag)
}
if (-not $SkipBuild) {
    Invoke-Docker @('build', '--pull=false', '--network', 'none', '-f', 'deploy/Dockerfile.backend.offline', '-t', "gamehub-backend:$Version", '.')
    Invoke-Docker @('build', '--pull=false', '--network', 'none', '-f', 'deploy/Dockerfile.frontend.offline', '-t', "gamehub-frontend:$Version", '.')
} else {
    Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', "gamehub-backend:$Version")
    Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', "gamehub-frontend:$Version")
}

New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$tracked = @(& git ls-files --cached)
if ($LASTEXITCODE -ne 0 -or $tracked.Count -eq 0) { throw 'No tracked source files.' }
foreach ($relative in $tracked) {
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Tracked file missing: $relative" }
    $target = Join-Path $destinationPath $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
}
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'offline/images') -Force | Out-Null
$archive = Join-Path $destinationPath 'offline/images/gamehub-images.tar'
Invoke-Docker @('save', '-o', $archive, "gamehub-backend:$Version", "gamehub-frontend:$Version", 'node:22-alpine', 'python:3.11-slim', 'nginx:1.27-alpine', 'postgres:16-alpine', 'redis:7-alpine')
$imageHash = File-Hash $archive
Set-Content -LiteralPath "$archive.sha256" -Value "$imageHash  gamehub-images.tar" -Encoding ascii
$exampleVersion = Get-Content -LiteralPath (Join-Path $destinationPath '.env.example') |
    Where-Object { $_ -match '^GAMEHUB_VERSION=' } | Select-Object -Last 1
if ($exampleVersion -ne "GAMEHUB_VERSION=$Version") { throw '.env.example version does not match release.' }

$hashes = @{}
foreach ($file in Get-ChildItem -LiteralPath $destinationPath -File -Recurse) {
    $relative = $file.FullName.Substring($destinationPath.Length + 1).Replace('\', '/')
    $hashes[$relative] = File-Hash $file.FullName
}
$manifest = [ordered]@{
    version = $Version
    tag = $tag
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
