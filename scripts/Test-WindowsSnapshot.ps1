param([Parameter(Mandatory = $true)][string]$RunDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$evidenceRoot = Join-Path $projectDirectory '.evidence'
$RunDirectory = [IO.Path]::GetFullPath($RunDirectory)
if (-not $RunDirectory.StartsWith($evidenceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test output must be under this project .evidence folder.' }
if (Test-Path -LiteralPath $RunDirectory) { throw 'Choose a new test directory.' }
$ancestor = Get-Item -LiteralPath (Split-Path -Parent $RunDirectory) -Force
while ($null -ne $ancestor) {
    if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Test directory ancestors must not be links.' }
    $ancestor = $ancestor.Parent
}
[IO.Directory]::CreateDirectory($RunDirectory) | Out-Null
$resultPath = Join-Path $RunDirectory 'result.json'
$result = [ordered]@{ status = 'running'; scope = 'invented files only, no Evernote data or client access'; stage = 'administrator-check'; snapshotCreated = $false; snapshotRemoved = $false; filesVerified = 0; error = $null }
function Save-TestResult { [IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false)) }
Save-TestResult
$shadowId = $null
try {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Native test requires a Windows administrator token.' }
    Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets/CimCmdlets.psd1') -ErrorAction Stop
    . (Join-Path $PSScriptRoot 'Copy-EvernoteSnapshot.ps1')
    $source = Join-Path $RunDirectory 'invented-source'
    [IO.Directory]::CreateDirectory((Join-Path $source 'nested')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'note.txt'), 'Invented note. Last viewed: unchanged.', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllBytes((Join-Path $source 'nested\attachment.bin'), [byte[]](0, 1, 2, 255, 0, 40))
    [IO.File]::WriteAllText((Join-Path $source 'live-marker.txt'), 'before snapshot')
    $noteHash = Get-SnapshotHash (Join-Path $source 'note.txt')
    $noteModified = [IO.File]::GetLastWriteTimeUtc((Join-Path $source 'note.txt'))
    $markerHash = Get-SnapshotHash (Join-Path $source 'live-marker.txt')
    $result.stage = 'create-snapshot'; Save-TestResult
    $volume = [IO.Path]::GetPathRoot($source)
    $created = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{ Volume = $volume; Context = 'ClientAccessible' }
    if ($created.ReturnValue -ne 0) { throw "VSS create failed with code $($created.ReturnValue)." }
    $shadowId = $created.ShadowID
    if ($shadowId -notmatch '^\{[0-9a-fA-F-]{36}\}$') { throw 'Unexpected shadow identity; no broad cleanup will run.' }
    $result.snapshotCreated = $true
    $result.stage = 'read-snapshot'; Save-TestResult
    $shadow = Get-CimInstance -ClassName Win32_ShadowCopy -Filter "ID='$shadowId'"
    if ($null -eq $shadow -or $shadow.DeviceObject -notmatch '^\\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\d+$') { throw 'Unexpected snapshot device.' }
    $snapshotSource = $shadow.DeviceObject + '\' + $source.Substring($volume.Length)
    # Only this invented marker changes; the snapshot must retain its earlier bytes.
    [IO.File]::WriteAllText((Join-Path $source 'live-marker.txt'), 'after snapshot')
    $entries = [Collections.Generic.List[object]]::new()
    $output = Join-Path $RunDirectory 'copied-snapshot'
    Copy-VerifiedTree $snapshotSource $output 'cache' $entries
    if ($entries.Count -ne 3) { throw 'Unexpected copied file count.' }
    if ((Get-SnapshotHash (Join-Path $output 'live-marker.txt')) -ne $markerHash) { throw 'Copy did not contain the frozen snapshot bytes.' }
    if ((Get-SnapshotHash (Join-Path $source 'note.txt')) -ne $noteHash -or [IO.File]::GetLastWriteTimeUtc((Join-Path $source 'note.txt')) -ne $noteModified) { throw 'Source note changed.' }
    if ((Get-SnapshotHash (Join-Path $output 'note.txt')) -ne $noteHash) { throw 'Copied note differs.' }
    $result.filesVerified = $entries.Count
    $result.stage = 'snapshot-cleanup'
    $result.status = 'passed'
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
} finally {
    if ($null -ne $shadowId -and $shadowId -match '^\{[0-9a-fA-F-]{36}\}$') {
        try {
            $owned = Get-CimInstance -ClassName Win32_ShadowCopy -Filter "ID='$shadowId'"
            if ($null -ne $owned) { $owned | Remove-CimInstance }
            if ($null -ne (Get-CimInstance -ClassName Win32_ShadowCopy -Filter "ID='$shadowId'")) { throw 'Created test snapshot still exists.' }
            $result.snapshotRemoved = $true
        } catch { $result.status = 'failed'; $result.error = "Cleanup of test snapshot $shadowId failed: $($_.Exception.Message)" }
    }
    Save-TestResult
}
if ($result.status -ne 'passed') { exit 1 }
