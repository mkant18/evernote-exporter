# Windows backup and offline export

This route copies Windows files without opening Evernote. It does not log in, call Evernote, select notes, sync, or write to Evernote's data folder. Conversion runs against a disposable copy. Reading the resulting archive cannot change the source account's note or notebook viewing dates through this tool.

**Validation limit:** the copy function, conversion, Windows export launcher, and archive import are tested with invented data. Native Windows snapshot creation needs an administrator and has not been exercised in this release environment. No real Evernote installation or full account has been verified. Treat this as a backup-route preview, not a certified complete export.

## What you need

- A Windows PC that already has desktop Evernote data. Do not open Evernote, sign in, sync, or change offline settings to prepare it.
- A private USB/backup drive on a different drive letter from the Evernote data. Do not use OneDrive, Dropbox, a shared folder or a public repository. The backup can include private notes and session data.
- Enough space for the backup, a second full copy made during conversion, generated ENEX, and the readable archive. Large libraries can require substantially more than three times the cache size.
- Windows administrator access for the snapshot step. Normal user rights for conversion and reading.

Prepare the downloaded app and its dependencies first: install Node.js 22.13 or later, then run **Start Evernote Archive.cmd** once. After that, backup and conversion need no internet. You may disconnect the Windows PC from its network before these steps; do not open or close Evernote as part of preparation. The script does not stop an already running client. Ordinary activity in other running clients is outside its control.

## 1. Make a private backup

1. Right-click **Backup Windows Evernote.cmd** and choose **Run as administrator**.
2. Enter a new folder on the backup drive, for example `E:\Evernote-PC1-backup`. Substitute your drive letter. The parent drive/folder must already exist. Existing destinations are refused.
3. The helper finds common Windows installer and Microsoft Store cache locations. If it lists more than one, select the intended installation; back up others separately.
4. Check the displayed source Windows user and destination. Type **BACKUP** only when they are correct. If Windows asked you to use a different administrator account, automatic detection may point at that administrator's profile; stop and have your helper supply the original user's `-CachePath`.
5. Wait for **Backup verified**. It creates a read-only filesystem snapshot without application writers, copies the cache including database journals, checks every copied file's SHA-256, then removes only its temporary snapshot. A failure stops the process; it never falls back to copying a changing live database.

`snapshot.json` is written only after the copy verifies. Keep it with the `cache` folder. Do not upload either. Windows snapshot storage and system logs can change during this process; Evernote application data is not a write target.

Repeat on a second Windows device into a different folder, such as `E:\Evernote-PC2-backup`. The two caches may contain different material. Keep both; do not combine or overwrite them. The iPhone and iPad are not export sources in this workflow.

## 2. Export the copied notes

1. Double-click **Export Windows Backup.cmd** normally, without administrator rights.
2. Enter the backup folder containing `snapshot.json`.
3. Enter a separate new output folder, for example `E:\Evernote-PC1-export`.
4. Read **READ ME.txt** in the result. `export-report.json` records notebook names, empty notebooks, file mappings, counts, failures, and limits. Both files are private.

**Copied graph notes exported** means the supported note rows in that copied database were converted. It deliberately returns exit code 2: full account completeness remains unverified. **Incomplete** returns exit code 1. Missing bodies, missing/corrupt attachments, unsupported rich-text encoding, unknown schemas and ambiguous accounts do not become successful empty notes.

Each generated `.enex` is in `enex`. Files are grouped by notebook, split around 256 MiB, and separate Trash notes. Filenames include notebook IDs to prevent collisions. The report maps them to human notebook names. Use those names when importing. Empty notebooks have no ENEX, but remain listed in the report.

The complete verified input is retained in `original-backup`. `working-database` is a disposable recovery copy; changes there cannot sync because Evernote never opens it. Never replace the source installation's data with either folder.

## 3. Read and check the result

Run **Start Evernote Archive.cmd**, choose **Add notebooks**, and select the generated ENEX files. Assign notebook names from the report. Check the exported counts, representative notes, tags, dates, tables, checklists, encrypted blocks, and attachments. Keep the entire backup and output folders, including failed/unsupported originals.

If content is missing, export the second Windows backup separately. Do not open notes in Evernote to download missing content under the no-changes requirement. This tool cannot retrieve cloud-only material. Combining divergent copies requires comparing identities and versions; it does not automatically choose one version or deduplicate them.

Then follow the [reading and migration walkthrough](user-guide.md). The archive's private Wi-Fi link works in a browser on another Windows PC, iPhone or iPad while its host PC is awake. For an independent notes app on all devices, try the guide's Joplin path using copied ENEX.

## What “all” still requires

A local cache is not proof of account coverage. Pending local mutations are retained but not replayed. History, sharing permissions, Tasks, reminders, OCR, stack/tag hierarchy and other application state are retained as available in the raw backup, not fully reconstructed in ENEX. Encrypted blocks remain encrypted. Unsupported notes are retained raw and reported. A cache cannot reveal notes and attachments that were never downloaded to it.

Do not call the migration complete until the two local inventories and all failures/exclusions are reconciled against a trustworthy account inventory obtained without violating the source constraint. If cloud-only content exists, this workflow cannot promise to acquire it without further evidence about a compliant server-side method. It has no online fallback.

## Technical scope and evidence

Supported input: one account graph using `Nodes_Note`, `Nodes_Notebook`, `Nodes_Tag`, `NoteTag`, `Attachment`, and Yjs `content`/`en-note` body files. Required columns are checked. Legacy `.exb`, multiple body profiles/accounts, unknown schema changes, and rich-text delta marks are refused for conversion; the raw backup is retained. Individual bodies/resources over 64 MiB and notes over the converter's size limit are reported rather than truncated. The app importer limits and memory bounds still apply.

The adapter was independently implemented using Yjs and Node's SQLite module. It does not run or bundle a third-party Evernote exporter. Format research: [local-cache layout](https://github.com/oooooooo/export-evernote/blob/main/docs/evernote-cache.md) and [a v11 local reader](https://github.com/nord342/evernote-local-mcp). These are reverse-engineered observations, not an Evernote schema guarantee. Library references: [Yjs XML text](https://docs.yjs.dev/api/shared-types/y.xmltext) and [Node 22 SQLite](https://nodejs.org/docs/latest-v22.x/api/sqlite.html).

Microsoft documents [`VSS_CTX_CLIENT_ACCESSIBLE`](https://learn.microsoft.com/en-us/windows/win32/api/vss/ne-vss-vss_snapshot_context) as read-only and without writer involvement. Evernote's [offline documentation](https://help.evernote.com/hc/en-us/articles/209005917-Access-notes-offline) describes local desktop data, but does not certify cache completeness or this extractor. These distinctions are why the tool reports separate backup integrity, copied-graph export status, and unverified account coverage.
