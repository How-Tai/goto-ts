# Problem PDF filenames — 13 October 2026

The user reported PDFs appearing as about:blank instead of their problem number. Inspection found that both the website PDF redirect and backend PDF endpoint returned application/pdf without Content-Disposition. Public problem 11 was used for verification; private problem 4 remained forbidden to anonymous requests.

The PDF controller now sets `Content-Disposition: inline; filename="<current problem ID>.pdf"` after its existing authorization checks. IDs and PDFs are unchanged. This supplies a browser filename without forcing downloads. Browser PDF metadata/preferences can also influence tab titles; a visual check of the user's existing browser was not performed.

The isolated production API build and TypeScript check passed. Deployment backed up the controller and retained the previous API bundle in `dist.pdf-before-<timestamp>`, with automatic rollback on failed verification. Only the API was briefly restarted. All six grader container identities/start times were unchanged.

Live checks after deployment:

- `/api/problem/11` and `/backend/problem/doc/11`: HTTP 200, application/pdf, inline filename 11.pdf.
- Problem 11 PDF SHA-256 matched before and after: 8c5bf56c0b1afe2073abfa742be9bd33a9bf3df797751eeeec6b4a07c258c009.
- Anonymous private problem 4: HTTP 403.
- API, website, nginx, ngrok and monitor active.

Backups and verification snapshots are saved on D in `vm-setup/pdf-filename-backups`. The exact release is recorded there in manifest.json.

[MDN documents the inline disposition and filename parameter](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition).
