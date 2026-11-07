param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('install', 'load-images', 'start', 'stop', 'status', 'logs', 'backup', 'restore', 'update', 'rollback', 'check')]
    [string]$Action,
    [string]$BackupPath,
    [string]$Version,
    [switch]$ConfirmRestore,
    [switch]$Clean
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$apps = @('nginx', 'backend', 'arena', 'casino-worker', 'simulation', 'games')
$imageArchive = Join-Path $root 'offline/images/gamehub-images.tar'

function Invoke-Docker([string[]]$arguments) {
    & docker @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($arguments -join ' ')" }
}
function Compose([string[]]$arguments) { Invoke-Docker (@('compose') + $arguments) }
function Secret {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
function Read-Version {
    $line = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^GAMEHUB_VERSION=' } | Select-Object -Last 1
    if (-not $line) { throw 'GAMEHUB_VERSION is missing in .env' }
    return ($line -split '=', 2)[1]
}
function Set-Version([string]$value) {
    $file = Join-Path $root '.env'
    $content = Get-Content -LiteralPath $file -Raw
    if ($content -match '(?m)^GAMEHUB_VERSION=') {
        $content = $content -replace '(?m)^GAMEHUB_VERSION=.*$', "GAMEHUB_VERSION=$value"
    } else { $content += "`nGAMEHUB_VERSION=$value`n" }
    [IO.File]::WriteAllText($file, $content)
}
function Wait-Service([string]$service, [int]$seconds = 120) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
        $id = (& docker compose ps -q $service | Select-Object -First 1)
        if ($id) {
            $state = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id).Trim()
            if ($state -eq 'healthy' -or $state -eq 'running') { return }
            if ($state -eq 'unhealthy' -or $state -eq 'exited') { throw "$service is $state" }
        }
        Start-Sleep -Seconds 2
    }
    throw "Timeout waiting for $service"
}
function Check-Tools {
    Invoke-Docker @('version', '--format', '{{.Server.Version}}')
    Compose @('version')
}
function Check-Bundle([bool]$strict = $true) {
    if (-not (Test-Path -LiteralPath $imageArchive)) { throw "Missing $imageArchive" }
    $expected = (Get-Content -LiteralPath "$imageArchive.sha256" -Raw).Trim().Split(' ')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $imageArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw 'Image archive checksum mismatch; no images were imported.' }
    foreach ($file in @('frontend/package-lock.json', 'requirements.lock', 'deploy/Dockerfile.backend.offline', 'deploy/Dockerfile.frontend.offline')) {
        if (-not (Test-Path -LiteralPath $file)) { throw "Missing $file" }
    }
    if (-not (Test-Path -LiteralPath 'offline/npm/cache/_cacache') -or -not (Test-Path -LiteralPath 'offline/python/wheels')) {
        throw 'Missing local npm cache or Python wheelhouse.'
    }
    $manifestPath = Join-Path $root 'offline/manifest.json'
    if ($strict -and (Test-Path -LiteralPath $manifestPath)) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        foreach ($item in $manifest.files.PSObject.Properties) {
            $filePath = Join-Path $root $item.Name
            if (-not (Test-Path -LiteralPath $filePath)) { throw "Package file missing: $($item.Name)" }
            $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne $item.Value) { throw "Package file modified or corrupt: $($item.Name)" }
        }
    }
}
function Load-Images {
    Check-Bundle
    Invoke-Docker @('load', '-i', $imageArchive)
}
function Ensure-Env {
    if (Test-Path -LiteralPath '.env') { return }
    $content = Get-Content -LiteralPath '.env.example' -Raw
    $content = $content -replace '(?m)^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$(Secret)"
    $content = $content -replace '(?m)^SECRET_KEY=.*$', "SECRET_KEY=$(Secret)"
    if ($Version) { $content = $content -replace '(?m)^GAMEHUB_VERSION=.*$', "GAMEHUB_VERSION=$Version" }
    [IO.File]::WriteAllText((Join-Path $root '.env'), $content)
    Write-Host 'Created .env. Configure the existing LAN authentication API before user login.'
}
function Run-Migration {
    Compose @('run', '--rm', '--no-deps', 'migrate')
}
function Start-Stack {
    if (-not (Test-Path -LiteralPath '.env')) { throw 'Missing .env. Run install first.' }
    Compose @('up', '-d', '--no-deps', 'postgres', 'redis')
    Wait-Service 'postgres'
    Wait-Service 'redis'
    Run-Migration
    Compose @('up', '-d', '--no-deps', 'backend', 'arena', 'casino-worker', 'simulation', 'games')
    Wait-Service 'backend'
    Wait-Service 'arena'
    Compose @('up', '-d', '--no-deps', 'nginx')
    Wait-Service 'nginx'
    Write-Host "GameHub is running at http://localhost:$((Get-Content .env | Where-Object { $_ -match '^GAMEHUB_PORT=' } | Select-Object -Last 1) -replace '^GAMEHUB_PORT=', '')"
}
function Resume-Apps {
    Compose @('up', '-d', '--no-deps', 'backend', 'arena', 'casino-worker', 'simulation', 'games')
    Wait-Service 'backend'
    Wait-Service 'arena'
    Compose @('up', '-d', '--no-deps', 'nginx')
    Wait-Service 'nginx'
}
function Backup([string]$target) {
    if (-not $target) { $target = Join-Path $root ("backups/gamehub-{0}-{1}" -f (Read-Version), (Get-Date -Format 'yyyyMMdd-HHmmss')) }
    $target = [IO.Path]::GetFullPath($target)
    if (Test-Path -LiteralPath $target) { throw "Backup already exists: $target" }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $version = Read-Version
    try {
        Compose (@('stop') + $apps)
        $dbId = (& docker compose ps -q postgres | Select-Object -First 1)
        if (-not $dbId) { throw 'PostgreSQL is not running.' }
        Invoke-Docker @('exec', $dbId, 'pg_dump', '-U', 'gamehub', '-d', 'gamehub', '-Fc', '-f', '/tmp/gamehub-backup.dump')
        Invoke-Docker @('cp', "${dbId}:/tmp/gamehub-backup.dump", (Join-Path $target 'database.dump'))
        Invoke-Docker @('exec', $dbId, 'rm', '-f', '/tmp/gamehub-backup.dump')
        Invoke-Docker @('run', '--rm', '--network', 'none', '-v', 'gamehub_game_files:/data:ro', '-v', "${target}:/backup", 'nginx:1.27-alpine', 'tar', '-czf', '/backup/files.tar.gz', '-C', '/data', '.')
        Copy-Item -LiteralPath '.env' -Destination (Join-Path $target 'config.env')
        Copy-Item -LiteralPath 'deploy/games.conf' -Destination (Join-Path $target 'games.conf')
        $schema = (& docker exec $dbId psql -U gamehub -d gamehub -Atc 'SELECT version_num FROM alembic_version LIMIT 1').Trim()
        $manifest = @{version=$version; schema=$schema; created=(Get-Date).ToString('o'); components=@('postgres', 'game_files', 'config.env', 'games.conf')}
        $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8
        $hashes = @{}
        foreach ($name in @('database.dump', 'files.tar.gz', 'config.env', 'games.conf')) { $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash.ToLowerInvariant() }
        $hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'sha256.json') -Encoding utf8
        Write-Host "Backup completed: $target"
    } finally { Resume-Apps }
    return $target
}
function Restore([string]$target, [bool]$makeSafetyBackup = $true) {
    if (-not $ConfirmRestore) { throw 'Restore replaces current data. Repeat with -ConfirmRestore.' }
    $target = [IO.Path]::GetFullPath($target)
    if (-not (Test-Path -LiteralPath (Join-Path $target 'manifest.json'))) { throw 'Backup manifest is missing.' }
    $previousVersion = (Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json).version
    foreach ($tag in @("gamehub-backend:$previousVersion", "gamehub-frontend:$previousVersion")) {
        & docker image inspect $tag *> $null
        if ($LASTEXITCODE -ne 0) { throw "Restore image is missing: $tag" }
    }
    $hashes = Get-Content -LiteralPath (Join-Path $target 'sha256.json') -Raw | ConvertFrom-Json
    foreach ($name in @('database.dump', 'files.tar.gz', 'config.env', 'games.conf')) {
        $actual = (Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $hashes.$name) { throw "Backup checksum mismatch: $name" }
    }
    if ($makeSafetyBackup) {
        $safety = Backup ''
        Write-Host "Safety backup before restore: $safety"
    }
    Compose (@('stop') + $apps)
    $dbId = (& docker compose ps -q postgres | Select-Object -First 1)
    Invoke-Docker @('cp', (Join-Path $target 'database.dump'), "${dbId}:/tmp/gamehub-restore.dump")
    Invoke-Docker @('exec', $dbId, 'pg_restore', '-U', 'gamehub', '-d', 'gamehub', '--clean', '--if-exists', '--no-owner', '--no-privileges', '/tmp/gamehub-restore.dump')
    Invoke-Docker @('exec', $dbId, 'rm', '-f', '/tmp/gamehub-restore.dump')
    Invoke-Docker @('run', '--rm', '--network', 'none', '-v', 'gamehub_game_files:/data', '-v', "${target}:/backup:ro", 'nginx:1.27-alpine', 'sh', '-c', 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/files.tar.gz -C /data')
    Copy-Item -LiteralPath (Join-Path $target 'config.env') -Destination '.env' -Force
    Copy-Item -LiteralPath (Join-Path $target 'games.conf') -Destination 'deploy/games.conf' -Force
    Start-Stack
}
function Build-Images([string]$tag, [bool]$noCache) {
    $extra = @()
    if ($noCache) { $extra += '--no-cache' }
    Invoke-Docker (@('build', '--pull=false', '--network', 'none') + $extra + @('-f', 'deploy/Dockerfile.backend.offline', '-t', "gamehub-backend:$tag", '.'))
    Invoke-Docker (@('build', '--pull=false', '--network', 'none') + $extra + @('-f', 'deploy/Dockerfile.frontend.offline', '-t', "gamehub-frontend:$tag", '.'))
}

Check-Tools
switch ($Action) {
    'load-images' { Load-Images }
    'install' {
        Load-Images
        Ensure-Env
        New-Item -ItemType Directory -Path 'backups' -Force | Out-Null
        Start-Stack
    }
    'start' { Start-Stack }
    'stop' { Compose (@('stop') + $apps) }
    'status' { Write-Host "GameHub version: $(Read-Version)"; Compose @('ps') }
    'logs' { Compose @('logs', '--tail', '150') }
    'backup' { Backup $BackupPath | Out-Null }
    'restore' {
        if (-not $BackupPath) { throw 'Specify -BackupPath.' }
        Restore $BackupPath
    }
    'update' {
        $old = Read-Version
        $next = if ($Version) { $Version } else { "local-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
        if ($next -eq $old) { throw 'New version must differ from current version.' }
        foreach ($tag in @("gamehub-backend:$old", "gamehub-frontend:$old")) {
            & docker image inspect $tag *> $null
            if ($LASTEXITCODE -ne 0) { throw "Current image required for rollback is missing: $tag" }
        }
        Build-Images $next $Clean.IsPresent
        $saved = Backup $BackupPath
        try {
            Compose (@('stop') + $apps)
            $env:GAMEHUB_VERSION = $next
            Run-Migration
            Compose (@('up', '-d', '--no-deps', '--force-recreate') + $apps)
            Wait-Service 'backend'
            Wait-Service 'arena'
            Wait-Service 'nginx'
            Set-Version $next
            Write-Host "Updated to $next. Backup: $saved"
        } catch {
            $message = $_
            Write-Error "Update failed; restoring backup $saved. Cause: $message" -ErrorAction Continue
            Remove-Item Env:GAMEHUB_VERSION -ErrorAction SilentlyContinue
            $ConfirmRestore = $true
            Restore $saved $false
            throw "Update failed and rollback was attempted: $message"
        } finally { Remove-Item Env:GAMEHUB_VERSION -ErrorAction SilentlyContinue }
    }
    'rollback' {
        if (-not $BackupPath) { throw 'Specify -BackupPath of the version to restore.' }
        Restore $BackupPath
    }
    'check' {
        Check-Bundle $false
        $tag = "offline-check-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Build-Images $tag $true
        Write-Host "Offline clean rebuild passed: $tag"
    }
}
