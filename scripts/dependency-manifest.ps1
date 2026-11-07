param([switch]$Verify)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$metadataPath = 'offline/dependencies.json'
$hashPath = 'offline/dependency-hashes.json'
$files = @{}
foreach ($directory in @('offline/npm/cache/_cacache', 'offline/python/wheels')) {
    if (-not (Test-Path -LiteralPath $directory)) { throw "Missing $directory" }
    foreach ($file in Get-ChildItem -LiteralPath $directory -File -Recurse) {
        $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        $files[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
if ($Verify) {
    $expected = Get-Content -LiteralPath $hashPath -Raw | ConvertFrom-Json
    if ($files.Count -ne @($expected.PSObject.Properties).Count) { throw 'Dependency file count changed.' }
    foreach ($item in $files.GetEnumerator()) {
        $property = $expected.PSObject.Properties[$item.Key]
        if (-not $property -or $property.Value -ne $item.Value) { throw "Dependency checksum mismatch: $($item.Key)" }
    }
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if ((Get-FileHash frontend/package-lock.json -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.package_lock_sha256) { throw 'package-lock.json changed.' }
    if ((Get-FileHash requirements.lock -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.requirements_lock_sha256) { throw 'requirements.lock changed.' }
    Write-Host "Verified $($files.Count) offline dependency files."
    return
}
$files | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $hashPath -Encoding utf8
$metadata = [ordered]@{
    platform = 'linux/amd64'
    node = '22.23.4'
    npm = '10.9.9'
    python = '3.11.18'
    package_lock_sha256 = (Get-FileHash frontend/package-lock.json -Algorithm SHA256).Hash.ToLowerInvariant()
    requirements_lock_sha256 = (Get-FileHash requirements.lock -Algorithm SHA256).Hash.ToLowerInvariant()
    npm_cache_files = (Get-ChildItem offline/npm/cache/_cacache -File -Recurse | Measure-Object).Count
    python_wheels = (Get-ChildItem offline/python/wheels -File | Measure-Object).Count
    created_utc = (Get-Date).ToUniversalTime().ToString('o')
    license_note = 'Package licenses are retained inside npm cache tarballs and wheel distributions; Arena audio credits are in frontend/public/audio/arena/CREDITS.md.'
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
Write-Host "Recorded $($files.Count) offline dependency files."
