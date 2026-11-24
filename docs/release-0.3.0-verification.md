# 0.3.0 backup-route preview verification

Checked 2026-11-24 with Node.js 22.21.0 and Windows PowerShell 5.1.

77 tests pass, no failures or skips. New tests exercise the public backup-conversion CLI, the actual Windows PowerShell export launcher, copied SQLite WAL recovery, UTF-8/text escaping, encrypted-block retention, tag/date transfer, attachment size/hash verification, and import/verification through the existing archive implementation. The Windows snapshot copy function is exercised on synthetic files with exact hash reconciliation and junction refusal. Tests reject missing/corrupt resources, absent bodies, unsupported rich-text marks/schema columns, duplicate identities, ambiguous accounts/profiles, manifest tampering, path traversal, overlapping output, existing output and directory junctions.

The input backup and retained raw copy match byte-for-byte in the fixture journey, including synthetic note/notebook last-viewed fields. SQLite opens only a disposable database copy. The capture and conversion paths contain no Evernote login, API, client-launch or sync operation. Dependency installation is a separate preparation step requiring internet; no Evernote credentials are requested.

**Native VSS snapshot creation is unverified:** this execution environment has no administrator token. The WMI class exists, but that does not prove creation succeeds. No real Evernote cache/account was accessed, and no claim is made about full account coverage, physical mobile devices or actual Joplin import. Current-cache support is based on documented reverse-engineered layouts and synthetic schema fixtures, not a captured current installation. These limits require a prerelease label.

Independent review found and prompted fixes for missing schema validation, snapshot cleanup coverage, body size checking, overly broad success wording and elevated-user source selection. Reviewed upstream exporter was not shipped or executed: its WAL handling, account selection and failure status did not satisfy this workflow. The adapter is independently implemented using pinned Yjs and Node SQLite.

Full account completeness remains unverified even when all copied graph notes export. Pending mutations and unsupported app features remain in the raw backup. Missing content yields exit 1; supported copied-graph export yields exit 2 and an explicit coverage warning. Neither outcome authorizes opening/syncing the original Evernote client or restoring into it.

Local evidence: `.evidence/release-030-tests.txt`; package and fresh-install receipts are recorded separately during publication. Private account-context research, provider-question drafts, task-state updates, backup data and local logs are excluded from this release.
