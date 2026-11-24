param([string]$Destination, [string]$CachePath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-OrdinaryPath([string]$ItemPath) {
    $item = Get-Item -LiteralPath $ItemPath -Force -ErrorAction Stop
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked/junction paths are not supported. Use an ordinary local folder.' }
        $item = $item.Parent
    }
}

. (Join-Path $PSScriptRoot 'Copy-EvernoteSnapshot.ps1')

try {
    if (-not $Destination) { $Destination = Read-Host 'Full path for a NEW private backup folder (for example E:\Evernote-PC1-backup)' }
    $Destination = [IO.Path]::GetFullPath($Destination)
    if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists. Choose a new folder; nothing is overwritten.' }
    $parentDirectory = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parentDirectory -PathType Container)) { throw 'Create the destination parent folder first.' }
    Assert-OrdinaryPath $parentDirectory
    if ($Destination -notmatch '^[A-Za-z]:\\') { throw 'Use a local drive, not a network path.' }

    if (-not $CachePath) {
        $candidates = [Collections.Generic.List[string]]::new()
        $appData = [Environment]::GetFolderPath('ApplicationData')
        $localData = [Environment]::GetFolderPath('LocalApplicationData')
        $installerCache = Join-Path $appData 'Evernote'
        if (Test-Path -LiteralPath (Join-Path $installerCache 'conduit-storage') -PathType Container) { $candidates.Add($installerCache) }
        $packages = Join-Path $localData 'Packages'
        if (Test-Path -LiteralPath $packages -PathType Container) {
            foreach ($package in Get-ChildItem -LiteralPath $packages -Directory -Filter 'Evernote.Evernote_*' -Force) {
                $storeCache = Join-Path $package.FullName 'LocalCache\Roaming\Evernote'
                if (Test-Path -LiteralPath (Join-Path $storeCache 'conduit-storage') -PathType Container) { $candidates.Add($storeCache) }
            }
        }
        if ($candidates.Count -eq 0) { throw 'No supported Windows cache found for this Windows user. Do not open/sign in to Evernote to create one.' }
        if ($candidates.Count -eq 1) { $CachePath = $candidates[0] }
        else {
            for ($i = 0; $i -lt $candidates.Count; $i++) { Write-Host "$($i + 1): $($candidates[$i])" }
            $choice = Read-Host 'Choose one cache number; capture others separately'
            $selected = 0
            if (-not [int]::TryParse($choice, [ref]$selected) -or $selected -lt 1 -or $selected -gt $candidates.Count) { throw 'Invalid cache selection.' }
            $CachePath = $candidates[$selected - 1]
        }
    }
    $CachePath = [IO.Path]::GetFullPath($CachePath).TrimEnd('\')
    if ($CachePath -notmatch '^[A-Za-z]:\\') { throw 'Source must be on a local Windows volume.' }
    Assert-OrdinaryPath $CachePath
    if (-not (Test-Path -LiteralPath (Join-Path $CachePath 'conduit-storage') -PathType Container)) { throw 'Unsupported cache: conduit-storage is absent.' }
    if ([IO.Path]::GetPathRoot($CachePath).Equals([IO.Path]::GetPathRoot($Destination), [StringComparison]::OrdinalIgnoreCase)) { throw 'Use a separate backup drive, such as a USB drive, to keep all backup writes off the Evernote volume.' }
    if ($Destination.StartsWith($CachePath + '\', [StringComparison]::OrdinalIgnoreCase) -or $CachePath.StartsWith($Destination + '\', [StringComparison]::OrdinalIgnoreCase) -or $Destination.Equals($CachePath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup destination must be separate from Evernote data.' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run Backup Windows Evernote.cmd as administrator. This is needed for a filesystem snapshot, not Evernote access.' }
    Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets/CimCmdlets.psd1') -ErrorAction Stop
    $sourceLetter = [IO.Path]::GetPathRoot($CachePath).TrimEnd('\')
    $targetLetter = [IO.Path]::GetPathRoot($Destination).TrimEnd('\')
    $sourceVolume = @(Get-CimInstance -ClassName Win32_Volume -Filter "DriveLetter='$sourceLetter'")
    $targetVolume = @(Get-CimInstance -ClassName Win32_Volume -Filter "DriveLetter='$targetLetter'")
    if ($sourceVolume.Count -ne 1 -or $targetVolume.Count -ne 1) { throw 'Use ordinary volume drive letters; substituted or ambiguous drive aliases are not supported.' }
    if ($sourceVolume[0].DeviceID -eq $targetVolume[0].DeviceID) { throw 'Source and destination refer to the same Windows volume. Use a separate backup drive.' }

    Write-Host "Selected Windows cache: $CachePath"
    Write-Host "Backup destination: $Destination"
    Write-Host 'If you elevated with another Windows administrator account, verify this is the intended user profile. Use -CachePath to select it explicitly.'
    if ((Read-Host 'Type BACKUP to confirm this source and a private, unsynced backup drive') -cne 'BACKUP') { throw 'Backup cancelled; no snapshot created.' }

    Write-Host 'Creating a filesystem snapshot. Evernote will not be launched, closed, signed into, or synced.'
    $volume = [IO.Path]::GetPathRoot($CachePath)
    # ClientAccessible excludes VSS writers. Do not use ClientAccessibleWriters.
    $created = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{ Volume = $volume; Context = 'ClientAccessible' }
    if ($created.ReturnValue -ne 0) { throw "Windows snapshot creation failed (code $($created.ReturnValue)). No live-copy fallback will run." }
    try {
        $shadow = Get-CimInstance -ClassName Win32_ShadowCopy -Filter "ID='$($created.ShadowID)'"
        if ($null -eq $shadow -or $shadow.DeviceObject -notmatch '^\\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\d+$') { throw 'Could not validate the created snapshot.' }
        $snapshotSource = $shadow.DeviceObject + '\' + $CachePath.Substring($volume.Length)
        [IO.Directory]::CreateDirectory($Destination) | Out-Null
        $entries = [Collections.Generic.List[object]]::new()
        # Preserve all cache files, including graph WALs and pending local mutations.
        Copy-VerifiedTree $snapshotSource (Join-Path $Destination 'cache') 'cache' $entries
        if ($entries.Count -eq 0) { throw 'Snapshot contains no files.' }
        $receipt = [ordered]@{ format = 'evernote-windows-snapshot-v1'; capturedAt = [DateTime]::UtcNow.ToString('o'); acquisition = 'Windows VSS ClientAccessible, no writers'; sourceCache = $CachePath; accountCoverage = 'unverified'; files = @($entries.ToArray()) }
        $json = $receipt | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText((Join-Path $Destination 'snapshot.json'), $json, [Text.UTF8Encoding]::new($false))
        Write-Host "Backup verified: $($entries.Count) files. Saved to $Destination"
        Write-Host 'This is a local cache backup; full account coverage is not yet verified. Keep it private.'
    } finally {
        # Delete only the transient shadow created by this invocation, never existing backups.
        $ownedShadow = Get-CimInstance -ClassName Win32_ShadowCopy -Filter "ID='$($created.ShadowID)'"
        if ($null -ne $ownedShadow) { $ownedShadow | Remove-CimInstance }
    }
} catch {
    Write-Error $_
    exit 1
}
