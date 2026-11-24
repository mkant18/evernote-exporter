# Evernote Exporter

Windows-first archive app for your Evernote exports. Import notebooks, search and read notes, download attachments, export Markdown, and retain original ENEX files for restoration. Runs locally on Node.js 22 or later, with an iPhone-friendly browser interface. No Evernote credentials or cloud upload are required.

## Start here

Download the [Windows release ZIP](https://github.com/mkant18/evernote-exporter/releases/tag/v0.2.1) and follow [START HERE](START%20HERE.md) or the [walkthrough](docs/user-guide.md). Requires Node.js 22 or later.

**Absolute no-changes requirement:** use existing ENEX files only. No live acquisition method has been verified to preserve Evernote note/notebook last-viewed dates. If there are no existing exports, stop before opening Evernote. This release is an offline archive tool, not a certified zero-change live exporter. See [source safety evidence](docs/source-safety.md). Do not import back into the original account.

## Run

Double-click **Start Evernote Archive.cmd**. It installs pinned dependencies if needed, starts the app in the background, and opens your browser. Your library persists under `archives/app`.

For iPhone, double-click **Start on iPhone.cmd**, then open **Use on iPhone** in the app. Open the private link in Safari while the phone and PC are on the same trusted Wi-Fi. The PC must remain on. Local-network sharing uses HTTP and a private access key; use only a trusted network and keep the link private.

Terminal equivalents:

```powershell
npm ci --ignore-scripts
npm start
# Or allow your iPhone on the same private network:
npm run start:phone -- --port 4319
```

The app provides notebook/stack labels, sequential multi-file import, search and tags, safe note rendering, attachment downloads, Markdown ZIP, portable reading HTML, complete archive ZIP, and original ENEX downloads. Read the [start-to-finish guide](docs/user-guide.md).

## CLI (optional)

```powershell
npm ci --ignore-scripts
node src/cli.js export --input "M:\PrivateExports\Trips.enex" --output "M:\PrivateExports\Trips-archive" --notebook "Trips" --stack "Family"
node src/cli.js verify --archive "M:\PrivateExports\Trips-archive"
```

The output directory must be new, and its parent must already exist. Keep real exports outside this repository. Input files are never modified. Omit `--notebook` and `--stack` if the assignment is unknown; names are never inferred from a filename. An explicit assignment applies to every note in the file, so use a notebook-specific export for this option.

`npm run cli -- --help` shows converter commands. Exit 0 means the command succeeded; exit 1 means it failed. **Success is not proof of a complete Evernote account backup.** Review the app's conversion notes and `manifest.json` warnings before relying on the archive.

## What is preserved

- Note titles, Unicode text, tags, valid created/updated timestamps, ordered rich-content structure and checklist states.
- Original ENML, unknown note metadata, resource metadata, encrypted ciphertext and unresolved links, with warnings for unsupported conversions.
- Exact attachment bytes with SHA-256 checksums, MIME types and original filenames. Identical bytes share a stored asset; repeated notes keep distinct local IDs.
- Original ENEX bytes for inspection and future conversion, plus user-supplied notebook/stack assignment and its provenance.

```text
archive/
  manifest.json          # inventory, checksums, organization, warnings
  sources/original.enex  # exact input copy
  notes/<local-id>.json  # one readable JSON file per note
  assets/<sha256>        # original bytes; names/MIME in note JSON
```

Attachment filenames are metadata, never filesystem paths. The JSON content tree is data, not sanitized HTML; a future viewer must safely render it. See [archive format](docs/archive-format.md) for the contract.

## Verify

`verify` checks payload size/SHA-256, required fields, attachment MD5, content references, checkbox/link summaries and inventories. It reconciles retained ENEX note order/count, identities, titles, tags, original content and resource bytes against the archive. It works after moving the archive and rejects payload symlinks/junctions and traversal paths. It does not authenticate the manifest or establish completeness against an Evernote account.

The exporter verifies its staged archive before publishing it. Existing destinations, including empty directories, are rejected. Publication uses an `.incomplete` marker; verification rejects an interrupted publication. If interrupted, retain the original input and retry with a new destination. An abandoned `.evernote-export-*` staging directory may remain beside the destination after a forced process termination.

## Current limits

The app stores each ENEX file as a separate archive, and can import several files sequentially. Notebook/stack labels are user-supplied; source note IDs, tag hierarchy and account coverage remain unknown. Evernote links are retained without repairing destinations. Structured Tasks, reminders, OCR and alternate resource data remain inspectable source metadata. Encrypted content is retained but not decrypted. The original ENEX remains available for migration; importing it back into the source Evernote account would change that account and is excluded from the no-changes workflow. The app does not validate live account sync.

UTF-8 XML only. Files are streamed, but each note is held in memory with a 128 MiB XML-character limit; decoded resources and JSON add memory overhead. Nesting is limited to 128 levels. This is well-formed XML parsing, not validation against Evernote's DTD. External DTDs are never fetched; internal subsets and custom entities are rejected. Standard named ENML character entities resolve locally.

App uploads are limited to 512 MiB per ENEX. Portable HTML is bounded to 32 MiB and may reject large or heavily repeated embedded media; use the app reader or archive ZIP for those notebooks. Very long notes display a preview limit notice while retaining their complete content. Actual iPhone use, current Evernote export/import and representative large-library workloads require separate acceptance; responsive/browser tests are not physical-device proof.

Evernote's [export instructions](https://help.evernote.com/hc/en-us/articles/209005557-Export-Notes-and-Notebooks-as-ENEX-or-HTML) do not establish preservation of last-viewed dates; they are not an approved acquisition route under this requirement. Checklist and resource placement conversion follows the [official ENML definitions](https://dev.evernote.com/legacy/doc/articles/enml).

## Development and synthetic demo

```powershell
npm test
node src/cli.js export --input tests/fixtures/sample.enex --output .evidence/demo-new --notebook Trips --stack Family
node src/cli.js verify --archive .evidence/demo-new
```

Create `.evidence` first and use a fresh output name on each run. Tests cover conversion, verification, HTTP upload/download, persistence, corrupted records, hostile content and paths, large resources, and independent ZIP reading. Python 3 is used only by the development tests for an independent standard-library ZIP/HTML reader; the app needs only Node.js. Fixtures are synthetic. Current handoff: [task-state.md](task-state.md).
