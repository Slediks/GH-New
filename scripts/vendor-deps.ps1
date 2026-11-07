# Run only when releasing a new dependency lock. The resulting cache and wheels
# are packaged; target machines never run this script or contact a registry.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force -Path 'offline/npm/context', 'offline/npm/cache', 'offline/python/wheels' | Out-Null
Copy-Item -LiteralPath 'frontend/package.json', 'frontend/package-lock.json' -Destination 'offline/npm/context' -Force
& docker run --rm --platform linux/amd64 -v "${PWD}/offline/npm/context:/work" -v "${PWD}/offline/npm/cache:/npm-cache" -w /work node:22-alpine npm ci --cache /npm-cache --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm dependency preparation failed.' }
& docker run --rm --platform linux/amd64 -v "${PWD}/offline/python/wheels:/wheels" python:3.11-slim pip wheel --no-deps --wheel-dir /wheels chess==1.11.2
if ($LASTEXITCODE -ne 0) { throw 'chess wheel preparation failed.' }
& docker run --rm --platform linux/amd64 -v "${PWD}/requirements.lock:/requirements.lock:ro" -v "${PWD}/offline/python/wheels:/wheels" python:3.11-slim pip download --only-binary=:all: --find-links /wheels --dest /wheels -r /requirements.lock
if ($LASTEXITCODE -ne 0) { throw 'Python dependency preparation failed.' }
Write-Host 'Dependencies are ready. Verify with scripts/offline.ps1 check after packaging.'
& (Join-Path $PSScriptRoot 'dependency-manifest.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Dependency manifest generation failed.' }
