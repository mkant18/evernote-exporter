# Offline verification — 2026-11-23

Current app verification: [2026-11-24 acceptance record](app-acceptance-2026-11-24.md), including repairs and 67 passing automated tests. The older 23-test evidence below is retained as history.

Subsequent [repository review](review-2026-11-23.md) reproduced multi-megabyte attachment failures and missing style-based checklist normalization despite the 23 passing tests. The results below remain historical evidence for their synthetic scope, not general compatibility or migration readiness.

Environment: Windows, Node.js 22.21.0, npm 11.18.0. Pinned production dependencies: saxes 6.0.0, entities 6.0.1; transitive versions locked in `package-lock.json`.

`npm test`: **23 passed, 0 failed, 0 skipped**. Full local output: `.evidence/test-results.txt`.

Tests exercise public CLI export and verify; exact source/attachment bytes; note titles, Unicode, tags, timestamps, checklist states and resource placement; duplicate titles and resource deduplication; organization provenance; unknown metadata retention; deterministic output; relocated verification; malformed XML/ENML; invalid UTF-8/base64/checksums; internal DTD/entity rejection; deep nesting; existing destination protection; larger multi-chunk input; corruption and unsafe manifest paths; and Windows directory junction rejection.

The saved demo was produced and verified using:

```powershell
node src/cli.js export --input tests/fixtures/sample.enex --output .evidence/demo-20261123 --notebook Trips --stack Family
node src/cli.js verify --archive .evidence/demo-20261123
```

Both commands exited 0. Export result: 2 notes, 2 attachment occurrences, 1 unique stored asset, 8 warnings. Verification result: `valid: true`, 4 payload files, `completeness: "unverified"`. Full results: `.evidence/demo-export.json` and `.evidence/demo-verify.json`. The demo is intentionally retained locally, ignored by Git; source fixture and tests are portable.

`git diff --check` passed. Git emitted host configuration/line-ending warnings; these did not prevent the check.

This establishes synthetic offline conversion and stored-archive integrity within the documented version-1 contract. It does not establish actual Evernote exporter behavior, account coverage, full feature normalization, production-scale performance, target-system import or owner acceptance. No live Evernote access, private-note processing or GitHub publication occurred.
