# PDF titles corrected — 13 October 2026

The initial filename header fix was deployed but did not resolve Chrome's displayed title for problem 30. Browser inspection confirmed its title remained about:blank. A read-only diagnostic copy revealed PDF Info /Title=about:blank and ViewerPreferences /DisplayDocTitle=true, created by HeadlessChrome/Skia. Chrome therefore displayed the internal title instead of the response filename.

The upload path now uses pinned pdf-lib 1.17.1 to set the PDF title to its current numeric problem ID, preserving other metadata and disabling form appearance regeneration. Parsing occurs before replacing an existing statement, so malformed PDFs no longer trigger prior statement deletion first. The Content-Disposition filename header remains in place. The production library is bundled into the API; source dependencies and lock entries are recorded for subsequent builds.

All 27 existing numeric PDF statements were normalized on isolated copies. Regression checks verified page geometry and hashes of all drawing, font and image resource streams matched before/after, as did other descriptive metadata. Malformed PDF and invalid ID inputs were rejected. Problem 30's complete rendered page was pixel-identical before/after. TypeScript and production API build passed.

Activation backed up all original PDFs, source utility, package manifest and lockfile, and retained the previous API bundle as dist.pdf-titles-before-<stamp>. Before writing, original source/PDF hashes were rechecked to avoid overwriting newer uploads. Each PDF replacement was atomic. Automatic rollback was prepared for activation or verification failures. Only the API was briefly restarted; the six grader container identities/start times were unchanged. No problems, submissions, testcase data or scores were changed.

All repaired PDF hashes matched live files. The public PDF endpoint returned the corrected file and its numeric filename. Anonymous private PDF access remained HTTP 403. API, web, nginx, ngrok and monitoring services remained active.

Chrome verification after deployment:

- localhost problem 30 tab and PDF viewer title: 30.
- ngrok problem 30 tab title: 30.

Original PDFs and verification are backed up on D in vm-setup/pdf-titles-backups. The exact timestamp and hashes are in manifest.json and pdf-manifest.json. The local browser proof is vm-setup/pdf-title-diagnostic-20261013/chrome-title-fixed.png.

Library behavior: [PDFDocument.setTitle](https://pdf-lib.js.org/docs/api/classes/pdfdocument#settitle).
