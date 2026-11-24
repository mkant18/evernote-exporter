# Release verification: 0.2.1

Verified 2026-11-24. Scope: existing local ENEX inputs and offline archive behavior. No Evernote account access or source acquisition occurred.

- Automated suite: 68 passed, zero failed/skipped, both in the source checkout and after extracting the release ZIP and running a fresh `npm ci --ignore-scripts`.
- ZIP: 30 allowlisted files plus CONTENTS.sha256; Python independently checked all file hashes, ZIP CRC and exact entry inventory. No private archives, credentials, runtime state or unrelated assistant settings included.
- Actual packaged CLI: sample export yielded two notes, two attachment occurrences and one unique asset. Verification passed and reconciled source notes. Account completeness remains unverified.
- Packaged Windows `.cmd` launcher started its server on a separate test port. Its browser-opening step failed in this execution environment and correctly printed a manual link. The browser access host was unavailable, so no new visual/UI acceptance is claimed for 0.2.1.
- Actual launcher-started HTTP service: sample import succeeded; original ENEX, complete archive ZIP, Markdown ZIP and portable HTML downloads all returned successfully. Original ENEX matched input bytes exactly; portable HTML contained no active external note links.
- Link regression: portable rendering leaves HTTP(S), Evernote, mailto and script links inactive while retaining text and destination metadata. Existing hostile content, data integrity, corruption, upload, download and persistence tests pass.

Local evidence: `.evidence/release-021-tests.txt`, `.evidence/release-021-fresh-tests.txt`, `.evidence/release-021-package-check.json`, `.evidence/release-021-launcher-journey.json`. These contain synthetic data only and are excluded from distribution.

Release asset: `dist/Evernote-Archive-0.2.1-Windows.zip`.
SHA-256: `11b18d0666f504968fa905e2bcab784d3c5d0548d7e421cdde953d0d859c7d29`.

Not established: zero-change live Evernote export (including last-viewed dates), complete account capture, physical iPhone acceptance, live Joplin import, or representative large-library acceptance. The release requires Node.js 22+ and first-run internet for dependency installation. Prior 0.2.0 browser acceptance is historical evidence, not a fresh test of these changes.
