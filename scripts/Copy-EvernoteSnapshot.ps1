function Get-SnapshotHash([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Copy-VerifiedTree([string]$SourcePath, [string]$TargetPath, [string]$RelativePath, $Entries) {
    [IO.Directory]::CreateDirectory($TargetPath) | Out-Null
    foreach ($entry in [IO.DirectoryInfo]::new($SourcePath).EnumerateFileSystemInfos()) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A linked item was found in the snapshot; no links are followed.' }
        $target = Join-Path $TargetPath $entry.Name
        $relative = "$RelativePath/$($entry.Name)"
        if (($entry.Attributes -band [IO.FileAttributes]::Directory) -ne 0) {
            Copy-VerifiedTree $entry.FullName $target $relative $Entries
        } else {
            [IO.File]::Copy($entry.FullName, $target, $false)
            $before = Get-SnapshotHash $entry.FullName
            $after = Get-SnapshotHash $target
            if ($before -ne $after) { throw 'Backup hash check failed. Keep the incomplete folder for diagnosis.' }
            $Entries.Add([ordered]@{ path = $relative; size = $entry.Length; sha256 = $after })
        }
    }
}
