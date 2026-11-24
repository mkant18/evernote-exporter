param([string]$InputBackup, [string]$OutputFolder)
$ErrorActionPreference = 'Stop'
try {
    $projectDirectory = Split-Path -Parent $PSScriptRoot
    Set-Location -LiteralPath $projectDirectory
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    & $nodePath -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<13))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22.13 or later first.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules/yjs/package.json') -PathType Leaf)) { throw 'Run Start Evernote Archive.cmd once while online to install dependencies, then disconnect before processing private backups.' }
    if (-not $InputBackup) { $InputBackup = Read-Host 'Full path of your verified backup folder (contains snapshot.json)' }
    if (-not $OutputFolder) { $OutputFolder = Read-Host 'Full path for a NEW export folder' }
    & $nodePath (Join-Path $projectDirectory 'src/cli.js') export-cache --input $InputBackup --output $OutputFolder
    $result = $LASTEXITCODE
    if ($result -eq 2) { Write-Host 'Local files exported. Full account completeness is NOT verified. Read READ ME.txt and export-report.json.' }
    elseif ($result -ne 0) { Write-Host 'Export incomplete. Keep the backup and review the report; do not sync/open Evernote to repair it.' }
    exit $result
} catch { Write-Error $_; exit 1 }
