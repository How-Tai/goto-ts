# Per-problem keyword rules

API/contract/grader release: `20261014-003452`. Final website dialog release: `20261014-004810`.

Admins can set optional Required keywords and Banned keywords in both Add Problem and Edit Problem on `/admin`. Commas, spaces or newlines separate identifiers; examples include `all_of` and `std::sort`. Every required keyword must appear. Blank fields disable the respective restriction. A keyword cannot be both required and banned. Inputs are bounded to 64 identifiers per list, 100 characters per identifier and 4096 characters per field.

Matching is case-sensitive and respects identifier boundaries. C/C++ comments, quoted strings, character literals and raw strings are ignored. Python comments and quoted/triple-quoted text are ignored. This is a basic lexical check, not proof of actual algorithm use or execution; dead code, aliases, macros and language-specific constructs can limit what it establishes.

The frontend reads current rules when Submit is pressed and checks code before upload. A failed check opens a dialog listing missing required keywords, banned keywords found and the configured lists. No submission or queue entry is created. Public problem editors, file submission dialogs and both contest editor/file form variants use this check. Submit is disabled while a check/upload is pending.

All six live workers independently enforce rules at job start. Violations receive zero-score REJECTED/WA verdicts, explanatory result text and a verdict for every configured testcase, preserving subtask score layout. No compilation or contestant execution is needed for a keyword violation. Rules are read again on rejudge. Changing rules does not automatically rejudge old submissions or change an already-running job.

Rules are stored in `otogProblemKeywordRules` with a cascading problem foreign key. Problem metadata and rule updates commit together. Existing problems have no restrictions until configured. Raw parameterized SQL avoids replacing the live generated Prisma client. The schema declares the new table and the migration is recorded.

Verification completed:

- Shared TypeScript/Python fixtures: required/banned identifiers, boundaries, case, comments, escapes, raw strings, triple quotes, qualified names and C++ digit separators.
- Rule validation, duplicate handling, conflicts and bounds.
- Grader WA results, testcase counts, zero resource accounting and custom subtask layout.
- Prisma schema validation, generated contract types, API/web typechecks and production builds.
- Live admin creation/update, regular-user denial, hidden rule access, direct-upload bypass producing WA, passing AC, changing/clearing rules and rejudging.
- Live best-subtask contest scoring retained prior earned points after a keyword WA.
- Browser confirmed optional Add/Edit fields, saved values, failure dialog appearing only after Submit, no submission created on failure, and valid browser submission receiving AC/100.
- Active grading finished before the worker rollout. Previous worker enable/pause flags were restored. The final website-only deployment left API and worker start times unchanged.
- Final source/page-asset checks and service health passed; all six graders running and website HTTP 200.

Only uniquely named diagnostic accounts, a hidden problem, a diagnostic contest and generated testcase/code fixtures were used. IDs/names were checked before cleanup. Those accounts, submissions, problem, contest, shared testcase files and temporary login files were removed; existing users/problems/submissions were not edited.

Backups are on D:

- `D:\otog-grader\vm-setup\keyword-rules-backups\20261014-003452`
- `D:\otog-grader\vm-setup\keyword-dialog-backups\20261014-004810`

The first backup includes the pre-change database, source, contract declarations, web service and Docker Compose configuration. No Cloudinary/API environment credentials were copied.

Proof screenshots: `D:\otog-grader\vm-setup\keyword-ui-test\submit-error-verified.png` and `valid-submission-verified.png`.
