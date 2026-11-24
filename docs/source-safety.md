# Source preservation boundary

Reviewed 2026-11-24. Requirement: no changes to the source Evernote account, including note/notebook last-viewed dates.

## What this release does

The app accepts existing local ENEX files. It has no Evernote credentials, API client, login, sync, or write-back path. The server reads supplied files and writes a separate local archive. Browser requests stay with the local archive server; remote note images are not fetched. Source note links render as inactive text in the app and portable HTML to prevent accidental navigation back to Evernote or through a redirect. Original link values remain in source records; Markdown retains usable links for migration.

Downloading original ENEX only reads the local copy. Importing it into the original Evernote account would change that account and is excluded. Downloaded attachments, Markdown readers, and destination apps can follow links or contact services; their behavior is not controlled by this app. Use an offline viewer when needed. Local file access timestamps may change; preservation of source bytes is not a promise to preserve filesystem access metadata.

## Live acquisition is unresolved

Evernote's [desktop export instructions](https://help.evernote.com/hc/en-us/articles/209005557-Export-Notes-and-Notebooks-as-ENEX-or-HTML) describe saving copies. They do not state that opening the client, selecting notebooks, exporting, or signing in preserves last-viewed metadata.

The published [NoteStore API reference](https://dev.evernote.com/doc/reference/NoteStore.html#getNoteWithResultSpec) describes retrieval but provides no explicit guarantee for all access/view metadata. Calling only retrieval methods does not establish the absence of server-side side effects. We found no adequate guarantee in these reviewed sources; this is not a claim that every possible acquisition route changes dates.

No live account was opened to test this. An account test could itself violate the requirement. Comparing created/updated timestamps alone would not prove that access dates, notebook metadata, device records, or other service state stayed unchanged. Opening a desktop client offline could change local state that syncs later.

Current prerequisite: existing exported files, or a separately established acquisition method with evidence covering the exact client/API and both note and notebook access metadata. A frozen backup may help, but is not automatically complete or directly importable. If no existing export is available, stop before accessing Evernote. Do not treat “no edits” as “no changes.”

## Account completeness

The archive verifies the supplied ENEX, not account coverage. Using a previously captured inventory, reconcile every notebook and split file, note count, empty notebook, stack, and tag grouping. Obtaining that inventory must also respect the source constraint. Log unavailable shared notes, Trash, history, Tasks, reminders, encrypted content, OCR, and organization that ENEX cannot fully represent. Keep unsupported features explicit; never silently count them as migrated.

This release is a working offline archive tool. It is not a certified zero-change live Evernote exporter or a verified complete migration of this account.
