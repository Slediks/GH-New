param([string]$Destination = 'release/github-source')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$target = [IO.Path]::GetFullPath((Join-Path $root $Destination))
if (Test-Path -LiteralPath $target) { throw 'Destination already exists; choose a new folder.' }
$excludedDirectories = @('node_modules', 'dist', '.review', 'test-results', 'playwright-report', '__pycache__', '.pytest_cache', '.ruff_cache', '.git', '.idea', 'screenshots', 'frontend', '_logs')
$excludedDocs = @('offline-audit.md', 'casino-audit-2026-09.md', 'football-v2-report.md', 'delivery.md', 'verification.md', 'plinko-todo.md', 'offline-start.md')
function Copy-SourceTree([string]$from, [string]$to, [bool]$isDocs = $false) {
    New-Item -ItemType Directory -Path $to -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
        if ($item.Name -in $excludedDirectories -or $item.Name -match '\.pyc$|\.tsbuildinfo$') { continue }
        if ($isDocs -and ($item.Name -in $excludedDocs -or $item.Name -in @('football-visual-review', 'audio') -or $item.Extension -eq '.json')) { continue }
        $destination = Join-Path $to $item.Name
        if ($item.PSIsContainer) { Copy-SourceTree $item.FullName $destination $isDocs }
        else {
            Copy-Item -LiteralPath $item.FullName -Destination $destination
            if ($isDocs -and $item.Extension -eq '.md') {
                $body = Get-Content -LiteralPath $destination -Raw
                $body = [regex]::Replace($body, '!?(\[([^\]]+)\])\(screenshots/[^)]+\)', '$2')
                [IO.File]::WriteAllText($destination, $body)
            }
        }
    }
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($directory in @('backend', 'shared', 'simulation', 'demo-games', 'deploy', 'frontend', 'scripts')) {
    Copy-SourceTree (Join-Path $root $directory) (Join-Path $target $directory)
}
Copy-SourceTree (Join-Path $root 'docs') (Join-Path $target 'docs') $true
foreach ($name in @('.dockerignore', '.env.example', '.gitignore', '.gitattributes', 'README.md', 'OFFLINE_INSTALL.md', 'OFFLINE_UPDATE.md', 'BACKUP_RESTORE.md', 'ROLLBACK.md', 'compose.yaml', 'compose.build.yaml', 'compose.offline.build.yaml', 'alembic.ini', 'requirements.lock', 'pyproject.toml')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $target $name)
}
New-Item -ItemType Directory -Path (Join-Path $target 'offline/npm') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $target 'offline/python') -Force | Out-Null
foreach ($name in @('dependencies.json', 'dependency-hashes.json')) {
    Copy-Item -LiteralPath (Join-Path $root "offline/$name") -Destination (Join-Path $target "offline/$name")
}
Copy-SourceTree (Join-Path $root 'offline/npm/cache') (Join-Path $target 'offline/npm/cache')
Copy-SourceTree (Join-Path $root 'offline/python/wheels') (Join-Path $target 'offline/python/wheels')
Write-Host "Clean source candidate prepared: $target"
