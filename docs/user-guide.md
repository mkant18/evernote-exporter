# Walkthrough: read, back up, and move saved notes

Start with [START HERE](../START%20HERE.md). Use existing ENEX files or the [Windows backup walkthrough](windows-backup.md) to create ENEX from an isolated cache copy. That new route has explicit compatibility and completeness limits. Do not open Evernote to export under the strict no-changes requirement.

## Start on Windows

Download the ZIP from the [release page](https://github.com/mkant18/evernote-exporter/releases/tag/v0.3.0), extract all files, and install [Node.js 22.13 or later](https://nodejs.org/en/download). Double-click **Start Evernote Archive.cmd**. First launch downloads pinned dependencies; later launches can run without internet. No Evernote login is requested. The app requires no administrator rights.

Keep the extracted folder: your library lives in `archives/app` inside it. Closing the browser leaves the app running. The launcher shows its process ID and stop command. Reopening it reuses that session; restarting the PC stops it. For a visible terminal, run `npm start` and stop with Ctrl+C.

## Practise with invented notes

Choose **Add notebooks → Choose ENEX files**, select `examples/sample.enex` from the release (or `tests/fixtures/sample.enex` in the source checkout), enter notebook **Practice** and stack **Family**, then choose **Add to archive**. Expect two notes, including **Travel / plans: café 🧭**. Open that note, search for text, try a tag, and download its text attachment. The fixture deliberately contains conversion notices to show where limitations appear.

Choose **Take this notebook** and try **Portable reader**, **Markdown + attachments**, **Evernote ENEX**, and **Complete archive**. These buttons download copies; none imports into Evernote. The ENEX download should be byte-identical to the input. Keep this practice app folder separate from your real library if you want counts without sample notes.

## Add your existing exports

Keep two copies of the original files, one on a separate backup drive. Add all parts of each notebook, including numbered parts. Each input must be at most 512 MiB. For larger existing files, stop and ask for help; do not reopen Evernote to re-export under this constraint. The optional CLI can process larger files subject to documented per-note memory limits.

Review notebook names and optional stack names before importing. These are your assignments, not recovered Evernote organization. One file's label applies to every note in it. Split files remain separate archive entries with the same label. Imports run sequentially. A failed file stays in the queue for retry; completed files remain saved. Keep a list of filenames, notebook/stack names, note counts, and failures outside the app.

Compare counts against any existing inventory. Check representative notes, tags, dates, tables, checklists, images, and attachments. Expand **About this archive** and note-level conversion notices. Importing all supplied files successfully does not prove that all Evernote content was captured. Empty notebooks, shared material, Trash, history, tag hierarchy, Tasks, reminders, OCR, encrypted content and unresolved note links need explicit accounting. Do not revisit Evernote to check these until a compliant acquisition method is established.

The reader does not fetch remote images. Note links are inactive in the app and portable HTML. Downloaded attachments and links in Markdown/destination apps may contact external services. Use offline viewers when needed. Encrypted content remains encrypted.

## Save a backup

For each imported file choose **Take this notebook → Complete archive**. Save the ZIP plus original ENEX to your backup drive. The archive ZIP holds notes, exact attachments, checksums, organization labels and original source. Markdown is a more limited migration copy. Portable HTML allows offline reading, with a 32 MiB output limit; use the app or complete archive for larger notebooks.

For a whole-library backup, stop every archive app session and copy `archives/app`. Restore it to the same relative location in a fresh app folder before launching. To use a complete archive ZIP instead, extract it to a new directory, verify it with `node src/cli.js verify --archive "PATH"`, then add `sources/original.enex` through the app and re-enter labels from `manifest.json`. Never overwrite your only copy.

## Try another notes app

[Joplin](https://joplinapp.org/) is one option with an official ENEX importer. You can test local import without connecting it to Evernote or configuring sync.

1. Install Joplin's desktop app and use a fresh local profile/library for the trial. Start with the invented sample or a copy of one existing notebook export.
2. Choose **File → Import → ENEX** and select the copied file. Joplin creates a new notebook. Choose its HTML import option if preserving rich formatting matters more than Markdown editing.
3. Check note count, tags, titles, dates, attachments, tables, checklists, and internal links. Formatting and OCR behavior can differ; note links may be guessed by title or remain Evernote links. Do not click remaining Evernote links under the no-changes requirement.
4. If acceptable, import the remaining copied ENEX files. Track split notebook parts and recreate stack organization in Joplin as needed. Keep original ENEX and archive backups even after migration.
5. For use across Windows, iPhone and iPad, install [Joplin on each device](https://joplinapp.org/help/install/). Import on one Windows device first, then configure the same [Joplin sync destination](https://joplinapp.org/help/apps/sync/) on the others. Joplin supports providers including OneDrive, Dropbox and Joplin Cloud; choose one you trust. Let the initial sync finish and check representative notes and attachments on every device. Do not re-import every ENEX on each device, which could create duplicates. Do not delete or reorganize the original Evernote account.

These steps follow [Joplin's import documentation](https://joplinapp.org/help/apps/import_export/); this release has not been tested against a live Joplin installation or your mother's account. Migration acceptance requires inspecting the copied data. Importing back into the source Evernote account would change it and is excluded.

## Read on your iPhone

These steps also apply to an iPad or another Windows browser. Double-click **Start on iPhone.cmd** on the PC, then choose **Use on iPhone** in the app. Open its private link in Safari. Both devices must be on the same trusted Wi-Fi, and the PC must remain awake. This is a local archive link, not the Evernote iPhone app.

If Windows requests network access, allow only the private network you intend to use. The app does not change firewall rules. If connection fails, check Wi-Fi, PC sleep, VPNs, and router client isolation. Sharing uses HTTP and a private key; anyone with the link and network access can read the library. Do not use public/shared Wi-Fi or publish the link. A new process normally generates a new key.

Choose a notebook, tap a note, then use **Back to notes**. Safari's Add to Home Screen can save a shortcut; this is not an offline native app. Physical iPhone acceptance remains unverified.

## If something fails

Keep the input files. Retry a failed import with the same existing file after reading the error. Preserve unreadable archive directories and run CLI verification; do not edit checksums to hide failures. Launcher logs and private links are in `.runtime`; do not share that directory. If Node.js is missing, install it and reopen the launcher. If installation fails, check connectivity and retain the error message.

To upgrade, stop sessions and back up `archives/app`, extract the new release into a different folder, copy the backed-up library into it, then launch. Keep the old folder until the new one has been checked.
