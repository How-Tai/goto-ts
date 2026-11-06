# Thai and English problem statements

Deployed on 3 November 2026, build `2nDDC0QAQDa6GUChQevAH`. API and web type
checks, production builds, nine catalog/HTTP check groups, five security groups,
15 React render states, and four frontend HTTP checks passed. Live HTTP and public
HTTPS verification passed. Grader containers and allocation were unchanged.

Both OTOG and the separate CF catalog accept a Thai PDF (`pdfTh`) and an English
PDF (`pdfEn`). The existing `pdf` field and `docs/:id.pdf` files remain supported.
No problem data migration is required.

Without a language parameter, PDF requests try Thai, then English, then the
existing statement. With `lang=en`, they try English, then Thai, then the existing
statement. If no statement exists, the existing not-found response applies.

- OTOG: `/backend/problem/doc/:id?lang=th|en`
- CF: `/backend/codeforces/statement/:id?lang=th|en&contestId=:contestId`
  (`contestId` is required only when accessing a private contest problem).

The problem create/edit forms have separate language uploads. Problem pages have
a Thai/English selector; the displayed PDF and its open/download link use the same
choice. Missing translations fall back on the server. Every request retains the
existing problem/contest authorization checks, including conditional requests.

Files are stored as `docs/:id.th.pdf`, `docs/:id.en.pdf`, and the legacy
`docs/:id.pdf`. Language values are restricted to `th` and `en`; arbitrary strings
are rejected. Responses identify known languages with `Content-Language`, and
ETags include the selected representation to prevent cross-language 304 responses.

OTOG-to-CF imports, CF-to-OTOG exports, and legacy CF catalog migration copy all
three files independently. Deleting a problem or cleaning up an unsuccessful
catalog import also removes its translated statements. Existing hidden testcase
and attachment handling is unchanged.

Verification covers real multipart create/update uploads, PDF bytes, default and
explicit language selection, English fallback, legacy fallback, missing documents,
invalid languages, private CF access, language-specific validators, independent
copies in both directions, and the existing security and React rendering checks.

On 4 November, the shared frontend PDF URL helper and legacy PDF redirect were
updated to send `?lang=th` explicitly by default, including the `/problem` list.
English selections send `?lang=en`. Frontend typecheck/build, loopback preview
redirects and public HTTPS checks passed (build `lhlMunewa6rOD_e7V5ju2`). Browser
inspection was unavailable because local browser use is disabled in Work settings.
