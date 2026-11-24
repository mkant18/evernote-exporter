# App implementation and acceptance — 2026-11-24

Version 0.2.0, Windows / Node.js 22.21.0. Acceptance was performed before the release commit; runtime/package fingerprints are retained locally in `.evidence/build-20261124-hashes.json`. The user subsequently authorized publishing the source, tests, launchers and documentation to GitHub. Raw local evidence, archives and private session data are excluded. No public cloud deployment was performed.

## Delivered flow

Native Windows launcher → local authenticated browser app → one or more ENEX uploads → explicit notebook/stack labels → verified, persistent local archives → search/tag filtering → safe rich-content reading and attachment downloads → Markdown ZIP, portable HTML, original ENEX, or complete archive ZIP.

A separate phone launcher provides a private-network link on port 4319. The interface supports iPhone-sized layouts. Returning notes to Evernote uses the exact retained original ENEX through desktop File → Import, followed by Evernote's own sync. The app is read-only; it does not modify original notes, write archive labels back into ENEX, sign into Evernote or confirm account completeness.

Three delegated workers repaired conversion, strengthened verification, and built the interface. Follow-up independent tasks reviewed ZIP/HTML output, exercised real HTTP routes and inspected launch/integration failures. Root integrated the service, downloads, launchers, documentation and repairs.

## Review findings resolved

| Finding | Repair and evidence |
| --- | --- |
| R1: multi-megabyte base64 stack overflow | Linear alphabet/padding validation and canonical round trip. Exact-byte 4 MiB and 8 MiB resource CLI regressions pass; invalid late bytes/padding reject safely. |
| R2: style-based checklist states missing | Modern checklist containers/list items normalize into existing checkbox nodes. Legacy, nested, malformed/unknown states and ordinary nested lists are covered. |
| R3: incomplete verifier | Required node/metadata fields, ciphertext, summary consistency, actual MD5/media references and streamed retained-source reconciliation. Rehashed inconsistent records and omitted-note inventory reject. |
| R4: plain-text content merging | Explicit breaks and table separators preserved; regression assertions cover blank lines and cells. |

Additional integration repairs: Markdown task-list/ordered-list formatting; very long code-fence handling; portable HTML size bounds including repeated media; import-lock recovery when staging fails; verified-read cache invalidation and before/after file fingerprints; Windows PowerShell version checking, stale status recovery and separate local/phone ports. A package allowlist excludes assistant settings, tests, private session files and data from distribution.

## Observed gates

- **67 automated tests passed, 0 failed, 0 skipped.** Receipt: `.evidence/build-20261124-final-tests.txt`. Includes actual CLI, independently inspected ZIP/HTML, and 12 HTTP tests covering authenticated upload/read/download, corrupt/hostile input, retry, restart persistence, concurrent imports and cache invalidation.
- **Desktop Chrome journey passed.** Actual file chooser import, notebook assignment, search/tag filtering, checklist display, attachment download and all four exports. Saved files were independently read back; original ENEX and attachment bytes match. Downloaded archive was extracted and passed `verify` with `sourceNotesReconciled: true`.
- **Narrow Chrome layout passed at 390×844.** List/read/back navigation, search, downloads, dialogs, partial multi-file import/retry and hostile source rendering were exercised. No horizontal overflow or background focus escape was observed.
- **WebKit 26.6 / iPhone 15 emulation passed import, search/tag/read/back and attachment/all-four-format downloads at 393 px.** This is a desktop-hosted Safari-engine test, not a physical iPhone. The initial modal focus-return discrepancy was fixed with explicit opener tracking; all three dialogs now return focus correctly in both Chrome and WebKit.
- **Native Windows launcher works on this host.** Windows PowerShell 5.1 starts the background server, writes current session metadata, reuses a running service, and opens the browser. Paths containing spaces were independently checked. The initial version-probe and overbroad browser-error catches were repaired.
- **Dependency advisory check: 0 known advisories** for the locked runtime tree at check time. Receipt: `.evidence/build-20261124-dependencies.json`. This is not proof of absence of vulnerabilities.
- **Package dry run and whitespace check pass.** Receipt: `.evidence/build-20261124-package.json`; no package was published.

## Browser receipts

All paths here are relative to `.evidence/`:

- `ui-desktop-results.txt`, `ui-mobile-results.txt`, `ui-partial-results.txt`, `ui-portable-results.txt`, `ui-webkit-results.txt` retain observations and scripts.
- `ui-download-checks.json`, `ui-downloaded-archive-verification.json` retain independent file/read-back checks. Actual downloaded files use `ui-download-*` and `ui-webkit-*` names.
- `ui-welcome-desktop.png`, `ui-library-desktop.png`, `ui-reader-mobile.png` and `ui-webkit-reader.png` show the running interface.
- `ui-mobile-attempt1.txt` retains an initial overly strict focus assertion that treated browser-chrome focus as background escape; the corrected check rejects focus on actual background controls. No application fix was needed for that assertion.
- `ui-chrome-focus-recheck.txt` and `ui-webkit-focus-recheck.txt` verify the actual WebKit focus repair. WebKit automation emitted blocked-inline-style CSP diagnostics while inspecting/capturing the page; the application retains its strict policy. Functional journeys produced no page exceptions or failed requests.
- `ui-acceptance-summary.md` consolidates browser results. Final modern-checklist alignment passes in both engines; `ui-final-friendly-chromium.png` and `ui-final-friendly-webkit.png` show the final interface. Final code fingerprints were refreshed after the focus and layout fixes.

## Limits still open

Physical iPhone access on the owner's network is awaiting the user's device check. A private link was provided during the session. No current real Evernote export, desktop import or account-to-iPhone sync was performed; synthetic success does not establish those vendor/account gates. No original notes have been deleted.

Full independent reconstruction of normalized rich content, unknown account inventory, tag hierarchy, original note IDs, structured Tasks/reminder behavior, OCR/alternate-data usability, encrypted plaintext, and representative large-library performance are not certified. Original/source metadata remains retained with explicit warnings. The app caps each upload at 512 MiB, individual note XML at 128 MiB characters, and portable HTML at 32 MiB; larger notes/notebooks may require splitting exports or the archive ZIP route.

Sharing is opt-in LAN HTTP protected by a random access key, not public hosting or encrypted HTTPS. The PC must remain available. Offline HTML reading still depends on the phone's file viewer; WebKit download success is not physical Files/Safari acceptance. No firewall settings were changed.
