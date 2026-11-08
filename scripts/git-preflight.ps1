param([switch]$Staged)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$paths = if ($Staged) { @(& git diff --cached --name-only --diff-filter=ACMR) } else { @(& git ls-files) }
if ($LASTEXITCODE -ne 0 -or $paths.Count -eq 0) { throw 'No Git files found.' }
$forbidden = @(
    '^\.env$', '^release/', '^backups/', '^data/', '^frontend/node_modules/',
    '^frontend/dist/', '^frontend/frontend/', '^docs/screenshots/',
    '^docs/football-visual-review/', '^docs/audio/', '^docs/[^/]+\.json$',
    '^docs/(offline-audit|casino-audit-2026-09|football-v2-report|delivery|verification|plinko-todo|offline-start)\.md$',
    '(^|/)(\.idea|\.venv|__pycache__|test-results|playwright-report)/',
    '\.(dump|log|webm|mp4)$'
)
foreach ($path in $paths) {
    foreach ($pattern in $forbidden) { if ($path -match $pattern) { throw "Unwanted Git file: $path" } }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing staged file: $path" }
    if ((Get-Item -LiteralPath $path).Length -ge 100MB) { throw "File exceeds GitHub size limit: $path" }
}
foreach ($path in @('frontend/src/main.tsx', 'frontend/public/audio/arena/CREDITS.md', 'backend/app/arena/wsgi.py', 'backend/migrations/env.py', 'compose.yaml', 'deploy/Dockerfile.frontend.offline', 'offline/dependencies.json', 'offline/npm/cache/_cacache', 'offline/python/wheels', 'OFFLINE_INSTALL.md')) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required source or dependency missing: $path" }
}
foreach ($path in $paths) {
    if ($path -match '\.(py|ts|tsx|js|mjs|json|yaml|yml|md|ps1|sh|ini|html|css|example)$') {
        if (Select-String -LiteralPath $path -Pattern '-----BEGIN (RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{30,}' -Quiet) {
            throw "Potential credential in $path"
        }
    }
}
& (Join-Path $PSScriptRoot 'dependency-manifest.ps1') -Verify
if (-not $?) { throw 'Offline dependency verification failed.' }
Write-Host "Git preflight passed: $($paths.Count) files."
