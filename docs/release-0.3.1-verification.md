# 0.3.1 walkthrough and reader correction

Checked 2026-11-24 on Windows with Node.js 22.21.0.

This release adds a self-contained offline HTML walkthrough and removes an encrypted-content message that directed readers to open the source note in Evernote. The reader now says it cannot decrypt the content and instructs users to keep the original export without opening the source note.

The packaged 0.3.0 app was exercised through its actual Windows launcher and Chrome interface: a file-picker import of the included invented ENEX displayed two notes and two attachments. The new HTML walkthrough was opened and visually checked in Chrome. These observations cover synthetic data only.

The Windows snapshot test was prepared using invented files, but Windows canceled its administrator launch. The test did not run and created no snapshot. Native VSS capture and compatibility with a real current Evernote installation remain unverified. Full account coverage, physical iPhone/iPad access and migration into a live Joplin installation remain unverified. This remains a prerelease.

All 77 tests passed in a fresh extraction with dependencies installed from the lockfile. Independent ZIP CRC and SHA-256 checks passed for all 40 packaged files. Package checks and fresh-install tests are recorded in local `.evidence/release-031-*` receipts. No real account or cache was accessed. Private research additions, runtime state and user data are excluded from publication.
