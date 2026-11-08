param([switch]$Verify)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$metadataPath = 'offline/dependencies.json'
$hashPath = 'offline/dependency-hashes.json'
function Bundle-Hash([hashtable]$hashes, [string]$prefix) {
    $listing = ($hashes.GetEnumerator() | Where-Object { $_.Key.StartsWith($prefix) } |
        Sort-Object Key | ForEach-Object { "$($_.Key) $($_.Value)`n" }) -join ''
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($listing))).ToLowerInvariant()
}
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
    if ((Bundle-Hash $files 'offline/npm/cache/') -ne $metadata.frontend_bundle_sha256) { throw 'Frontend dependency bundle changed.' }
    if ((Bundle-Hash $files 'offline/python/wheels/') -ne $metadata.backend_bundle_sha256) { throw 'Backend dependency bundle changed.' }
    Write-Host "Verified $($files.Count) offline dependency files."
    return
}
$files | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $hashPath -Encoding utf8
$metadata = [ordered]@{
    target_platforms = @('linux/amd64', 'windows/amd64')
    frontend_package_manager = 'npm'
    frontend_dependency_path = 'offline/npm/cache'
    backend_dependency_path = 'offline/python/wheels'
    node_linux = '22.23.4'
    npm_linux = '10.9.9'
    node_windows_verified = '22.12.0'
    npm_windows_verified = '11.12.0'
    python_linux = '3.11.18'
    python_windows = '3.11'
    package_lock_sha256 = (Get-FileHash frontend/package-lock.json -Algorithm SHA256).Hash.ToLowerInvariant()
    requirements_lock_sha256 = (Get-FileHash requirements.lock -Algorithm SHA256).Hash.ToLowerInvariant()
    frontend_bundle_sha256 = Bundle-Hash $files 'offline/npm/cache/'
    backend_bundle_sha256 = Bundle-Hash $files 'offline/python/wheels/'
    frontend_bundle_bytes = (Get-ChildItem offline/npm/cache/_cacache -File -Recurse | Measure-Object Length -Sum).Sum
    backend_bundle_bytes = (Get-ChildItem offline/python/wheels -File | Measure-Object Length -Sum).Sum
    npm_cache_files = (Get-ChildItem offline/npm/cache/_cacache -File -Recurse | Measure-Object).Count
    python_wheels = (Get-ChildItem offline/python/wheels -File | Measure-Object).Count
    created_utc = (Get-Date).ToUniversalTime().ToString('o')
    license_note = 'Package licenses are retained inside npm cache tarballs and wheel distributions; Arena audio credits are in frontend/public/audio/arena/CREDITS.md.'
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
Write-Host "Recorded $($files.Count) offline dependency files."
