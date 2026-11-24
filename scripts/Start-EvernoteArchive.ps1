param([switch]$Share, [int]$Port = 0)
$ErrorActionPreference = 'Stop'
if ($Port -eq 0) { $Port = if ($Share) { 4319 } else { 4318 } }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Choose a port between 1 and 65535.' }
function Open-ArchiveSession($session) {
    Write-Host "Open: $($session.url)"
    Write-Host "Library: $($session.dataDir)"
    if ($Share) { Write-Host "iPhone (same trusted Wi-Fi): $($session.phoneUrls -join '  ')" }
    Write-Host "App process: $($session.pid). To stop: Stop-Process -Id $($session.pid)"
    try { Start-Process $session.url }
    catch { Write-Warning 'The app is running, but the browser could not open automatically. Open the link above in your browser.' }
}
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
$nodePath = (Get-Command node -ErrorAction Stop).Source
$installedNodeVersion = & $nodePath --version
if ($LASTEXITCODE -ne 0 -or $installedNodeVersion -notmatch '^v(\d+)\.(\d+)\.' -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 13)) { throw 'Install Node.js 22.13 or later, then launch again.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules/yazl/package.json') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules/yjs/package.json') -PathType Leaf)) {
    Write-Host 'Installing the pinned application dependencies...'
    & npm ci --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the network connection and try again.' }
}
$runtimeDirectory = Join-Path $projectDirectory '.runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$modeName = if ($Share) { 'phone' } else { 'local' }
$statusFile = Join-Path $runtimeDirectory "$modeName-$Port.json"
if (Test-Path -LiteralPath $statusFile -PathType Leaf) {
    $reuse = $false
    try {
        $previous = Get-Content -LiteralPath $statusFile -Raw -ErrorAction Stop | ConvertFrom-Json
        $previousUri = [Uri]$previous.url
        $previousKey = $previousUri.Fragment -replace '^#key=', ''
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status" -Headers @{ 'X-Archive-Key' = $previousKey } -TimeoutSec 2
        $reuse = $true
    } catch { Write-Host 'Starting a new app session...' }
    if ($reuse) { Open-ArchiveSession $previous; return }
}
$serverScript = Join-Path $projectDirectory 'src/web/server.js'
$serverArguments = @('"' + $serverScript + '"', '--port', "$Port", '--status-file', '"' + $statusFile + '"')
if ($Share) { $serverArguments += '--share' }
$appProcess = Start-Process -FilePath $nodePath -ArgumentList $serverArguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory "$modeName-$Port-out.log") -RedirectStandardError (Join-Path $runtimeDirectory "$modeName-$Port-error.log") -PassThru
for ($attempt = 0; $attempt -lt 300; $attempt++) {
    if ($appProcess.HasExited) { throw "App did not start. See .runtime/$modeName-$Port-error.log. If the port is occupied, launch with -Port 4319." }
    if (Test-Path -LiteralPath $statusFile -PathType Leaf) {
        try {
            $status = Get-Content -LiteralPath $statusFile -Raw -ErrorAction Stop | ConvertFrom-Json
        } catch { Start-Sleep -Milliseconds 100; continue }
        if ($status.pid -eq $appProcess.Id) { Open-ArchiveSession $status; return }
    }
    Start-Sleep -Milliseconds 100
}
throw 'App startup timed out. Inspect .runtime logs before retrying.'
