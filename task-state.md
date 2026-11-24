# Current task

Objective (2026-11-24): package a working version on mkant18's GitHub with a simple guide for his mother to read/export/migrate Evernote, without ANY source account changes including note/notebook last-viewed dates.

Constraint: do not open or authenticate to her Evernote. User reports no existing export / unsure. No verified live acquisition route satisfies the absolute condition. Existing local ENEX processing is safe for the account because it does not contact Evernote; local filesystem access timestamps are outside that claim. Preserve unrelated `.claude/`, `.skillopt-sleep/`, and `CLAUDE_Tool.md`. Do not mix in the separate Python evernote-portable-archive project.

Verified outcomes:
- Existing implementation was already published at 00991d95b0e97f8d5f31e2ae0c81670c5391a7ac, origin master, public mkant18/evernote-exporter. Remote checked this run.
- Prepared 0.2.1 Windows ZIP, START HERE, detailed walkthrough, optional Joplin import instructions, source-safety evidence and SHA-256 receipt.
- Removed guide/UI directions to access or restore into the source account. Source links inactive in app/portable HTML; original source retained. Markdown/destination apps and downloaded attachments remain outside reader protection.
- 68 tests pass in checkout and freshly extracted package. Independent ZIP checks verify all 30 files and no private state. Actual packaged CLI export/verify passes, and launcher-started HTTP import/all four downloads pass with byte-identical original ENEX.
- Browser access host unavailable; launcher starts server but cannot auto-open browser in sandbox. No fresh browser visual verification. Earlier 0.2.0 browser evidence remains historical.

Evidence: docs/release-0.2.1-verification.md; docs/source-safety.md; .evidence/release-021-{tests.txt,fresh-tests.txt,package-check.json,launcher-journey.json}. ZIP: dist/Evernote-Archive-0.2.1-Windows.zip (SHA-256 11b18d0666f504968fa905e2bcab784d3c5d0548d7e421cdde953d0d859c7d29).

Next action: commit only release-related files, push master without force, create GitHub v0.2.1 release with ZIP/checksum, download published assets and compare bytes. GitHub connector has no release-asset publishing capability; use authenticated gh CLI. Network needs sandbox escalation; escalated auth check succeeds.

Remaining goal gap: no existing export is known and live acquisition preserving all access metadata is not established. Do not claim a complete migration or mark the overall goal complete. Need existing copies or a verified acquisition route covering exact current client/API and both note and notebook last-viewed metadata. Physical iPhone, current Joplin and full-library acceptance remain unobserved.

Test session: packaged app was launched on port 4327 from .evidence/release-021-fresh. Its status/key is in that folder's .runtime/local-4327.json; never publish it. Recheck identity before stopping any process. Prior app sessions/user libraries must be left alone.
