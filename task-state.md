# Current task

Publication checkpoint, 2026-11-24: user explicitly requested pushing the entire implementation to GitHub. Target is `https://github.com/mkant18/evernote-exporter`, branch `master`; remote was verified at scaffold commit `c03818a` before publication. All 10 recorded release fingerprints match the tested files; the final suite passed 67/67. Stage source, fixtures, tests, launchers, dependency lock and documentation. Exclude private archives, runtime/access keys, local browser evidence/caches and pre-existing unrelated assistant settings. Next action: commit, push without force, and verify the remote branch SHA matches local HEAD. Earlier entries below are historical checkpoints; physical iPhone and live Evernote acceptance remain unobserved.

Objective: deliver the usable export/archive/reading/restore flow after review, using delegated agents. Implementation and synthetic browser acceptance complete; user targets iPhone and both independent browsing/Markdown and return to Evernote. Physical iPhone and live Evernote acceptance remain unobserved.

Constraints: preserve source bytes and unknown fields; never overwrite an output archive; no live account access or private captures; do not touch pre-existing `.claude/` or `CLAUDE_Tool.md`. The Python `evernote-portable-archive` is a separate project, not this checkout's implementation.

Plan: implement strict XML parsing and neutral note conversion, staged archive storage and integrity verification, then exercise the public CLI against synthetic preservation and failure fixtures. Document the format and commands.

Verified starting state (2026-11-23): initial scaffold commit `c03818a`; no implementation or tests. Node 22.21.0 and npm 11.18.0 available.

Completion criteria: public export and verify commands work on synthetic ENEX; attachment bytes, tags, checklist states and user-supplied notebook/stack survive; invalid input and existing destinations fail without source or destination loss. Account completeness must remain explicitly unknown.

## Verified outcome, 2026-11-23

Implemented `node src/cli.js export` and `verify`, also exposed through `src/index.js`. The exporter streams UTF-8 ENEX, converts ordered content/checklists/tags, preserves metadata and original source, extracts and deduplicates exact attachment bytes, records organization provenance and fidelity warnings, verifies the staged archive, and publishes only to a new destination. The verifier checks checksums, inventories and references and rejects incomplete publication and unsafe paths/symlinks.

`npm test`: 23 tests passed, 0 failed, 0 skipped. Includes public CLI export and relocated verification, exact Unicode/content/resource expectations, duplicate-title preservation, deterministic manifests, missing media, invalid dates/checkboxes, named entities versus CDATA, multi-chunk Unicode and attachment input, corruption, malformed XML/base64, XXE rejection, deep nesting, existing-output protection and junction rejection.

Actual CLI demo: `.evidence/demo-20261123`, 2 notes, 2 attachment occurrences, 1 unique asset, 8 explicit warnings. Verification passed for 4 payload files. Account completeness is deliberately `unverified`.

Evidence: `.evidence/test-results.txt`, `.evidence/demo-export.json`, `.evidence/demo-verify.json`, `.evidence/demo-20261123/manifest.json`. Portable verification summary: `docs/verification.md`. Format contract: `docs/archive-format.md`. Usage: `README.md`. `git diff --check` passed. Changes remain local and uncommitted; no remote publication attempted.

## Remaining work and next action

### Active implementation

Completion checkpoint: all four review findings repaired; final automated run67/67 passed. Chrome desktop/narrow and WebKit26.6 iPhone15 emulation exercised upload, read/search/tags, attachments and all four actual saved downloads. Returned ENEX and attachment bytes independently match source; extracted ZIP verifies sourceNotesReconciled:true. All three dialogs restore focus in both engines after a targeted Safari repair. Native launcher version/path/status/browser handling tested. The package allowlist excludes settings/private state; dependency audit0 known advisories. App remains on port4319/PID56404 (verify PID/status before any process action); old task-owned4318/PID52004 stopped after all sessions moved. Private current URL in `.runtime/phone-4319.json`. No private account/device acquisition, commits, public hosting or GitHub publication. User's physical iPhone question is pending; do not equate WebKit emulation with its answer.

Next user journey: open app, use own notebook ENEX exports, inspect fidelity notices; use private same-Wi-Fi link on iPhone. To return notes to Evernote, download exact originalENEX and use desktop File > Import then check sync. `docs/user-guide.md` and `docs/app-acceptance-2026-11-24.md` carry current guidance and evidence. Final modern-checklist alignment is fixed and geometry/screenshots pass in Chrome and WebKit. All delegated work completed; `.evidence/ui-acceptance-summary.md` has consolidated browser evidence. Final code fingerprints refreshed after JS/CSS repairs. Preserve remaining device/account limits in the handoff.

2026-11-24 milestone: R1–R4 fixed and 67 automated tests pass. Browser app, authenticated service, worker-backed uploads, Markdown/archive ZIP, bounded portable HTML, original ENEX restore downloads, Windows launchers and iPhone LAN sharing implemented. Desktop and 390 px Chrome journeys pass including partial import/retry; WebKit26.6 iPhone15 emulation import/read/all downloads pass. Worker is repairing observed WebKit dialog focus return, then rerunning those gates. Root native phone launcher successfully opened final service on4319; session details are private in `.runtime/phone-4319.json`, library in `archives/app`. Keep this service stable for user's pending physical iPhone check. Older Chrome service4318/PID52004 can stop only after browser agent confirms no dependency. No account access, live Evernote restore or remote publication.

Current handoff/receipts: `docs/app-acceptance-2026-11-24.md`, `docs/user-guide.md`, `.evidence/build-20261124-final-tests.txt` (67/67), `.evidence/build-20261124-hashes.json`, `.evidence/ui-*`. Packaging allowlist checked; runtime npm audit reports0 known advisories. Actual iPhone and Evernote account acceptance remain explicitly unobserved. User answered iPhone + both destinations; a LAN link/check question is pending. Next: complete focus repair browser recheck, refresh fingerprints/state, retain working final service and deliver launch links.

User explicitly authorized subagents and full implementation. Work ownership: conversion_repairs owns convert.js + regression tests (R1/R2/R4); verification_repairs owns archive.js + regression tests (R3 and source reconciliation); app_interface owns src/web/public UI. Root owns service, downloads, CLI/launchers, integration, live browser tests, docs. Preserve all existing work and the separate Python repository.

Build target: local authenticated browser app with sequential multiple ENEX imports, notebook/stack labels, library search/filter/read, safe attachments, Markdown ZIP, archive ZIP, original ENEX restore download, and self-contained reading HTML. iPhone uses explicit private-network sharing; no cloud upload or public deployment. Desktop Evernote import followed by sync is documented separately from independently verified converter behavior. Real iPhone and account acceptance remain unobserved.

### Latest review, 2026-11-23

Full report: `docs/review-2026-11-23.md`. The existing 23 tests pass, but new probes establish P1 failures: valid 4 MiB/8 MiB resources crash the base64 regex, and style-based Evernote checklists lose normalized states without warning. P2: verifier accepts missing encrypted ciphertext and inconsistent checkbox/MD5 metadata after checksum recomputation. P3: plain-text line breaks/table cells merge. Production files remain unchanged by this audit; no fixes, commits, publication or live account/device work performed.

Phone/web interfaces and Evernote import integration are absent. Windows CLI operation is established only for tested cases, not a complete migration. Source reconciliation and representative real-export acceptance remain open. New receipts: `.evidence/review-20261123-{tests.txt,probes.json,fidelity.json,input-hashes.json,dependencies.json,package.json,production-unchanged.json}`. Dependency advisory check found zero known advisories; package dry run exposes local assistant settings in the prospective package.

Next action after review: repair findings R1/R2 before adding broader workflows; then strengthen verifier R3 and plaintext R4 and rerun affected regressions. The implementation roadmap below is secondary to those fixes.

This completes the first runnable export/storage increment. No live account access or real-note fixtures were used. Real target-export fidelity, large-library performance and owner acceptance remain unverified. Structured Tasks, reminders, OCR/alternate resource data remain inspectable metadata rather than fully normalized features. No target importer or GUI is implemented.

Next implementation increment: explicit multi-file capture manifest mapping ENEX exports to notebooks/stacks, followed by Markdown output and a safe local reader. Preserve source IDs/tag hierarchy/account coverage as unknown until independent source evidence supplies them. Continue synthetic/offline work; obtain separate authorization before account/device acquisition. Pre-existing `.claude/` and `CLAUDE_Tool.md` remain untouched.
