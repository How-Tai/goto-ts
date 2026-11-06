# Security audit remediation — 21 October 2026

The findings in `SECURITY-AUDIT-20261021.md` have been addressed and the application and grader changes deployed. Windows localhost:3030 and ngrok passed final checks. All six graders are enabled with fresh heartbeats. No production test accounts/submissions were created, no production verdicts were rejudged or rewritten, and no schema migration or credential rotation was required.

## Findings and corrections

| Finding | Correction and current status |
| --- | --- |
| A01: finished scratch can block memory admission | **Deployed.** The worker reclaims its private contestant tree, compiled baseline and copied output/error metadata after a job, before becoming idle. Startup and idle paths reclaim stale private scratch before RAM admission. Cleanup remains under a deadline. Failure after persistence requests worker retirement without overwriting the committed result. |
| A02: local dependency drift | **Repaired locally; production verified.** Windows dependencies were synchronized to the frozen lockfile with pnpm 8.9.0. Actual consuming modules resolve Next.js 15.5.28 and Multer 2.4.0. Fresh VM checks confirmed production already had those versions before this work and still does afterward. Downloads/package caches were placed on D. This is not an exhaustive dependency/CVE scan. |
| A03: authentication route aliases | **Deployed.** Throttle path matching now handles Express's case-insensitive paths and trailing slashes consistently; aliases share the canonical IP bucket. |
| A04: account throttle before body parsing | **Deployed.** Explicit bounded JSON and form parsers precede the middleware, so the username bucket is populated before password verification. The normal 100 KiB parser limits and multipart handling are retained. |
| A05: prize/scoreboard mismatch | **Deployed.** Scoreboard, score history and prizes use one results-policy helper. Authorization precedes expensive scoreboard/prize aggregation. Missing/forbidden prize responses are represented in the contract. |
| A06: submission-list visibility | **Deployed.** The problem/user submission list receives the viewer and uses the same row-visibility predicate as individual submission reads. Owners retain access to their own submissions; administrators retain access; other viewers cannot bypass restricted contest results through the list. Source code is not added to the list projection. |
| A07: unbounded startup/claim waits | **Deployed.** Startup, main connection, registration/recovery, claims and expected idle waits have progress deadlines. Main connections have a 5-second connection timeout, 60-second statement timeout, 10-second lock timeout, keepalives and a 15-second TCP user timeout. Ordinary pause/low-memory waiting remains valid and does not itself cause restarts. |

Additional fixes from the audit observations:

- Chat links use the same HTTP/HTTPS/mailto scheme policy as announcements; unsafe schemes render as text.
- Concurrent archive extractions reserve a shared process-local expansion budget. Nested finalization releases reservations and per-problem locks even if temporary-file cleanup raises.
- Optional Discord requests have connection/read timeouts. The inactive legacy HTTP-sync path has connection/read timeouts and three result-post attempts instead of an infinite retry loop. Its source is updated for future use; the six active graders still use `mainWorkers.py`.
- Integration logs exposed an existing refresh handler using ts-rest while directly sending an Express response. It now uses the same ordinary Nest GET response approach as the manually handled login route. The URL, cookies, response and atomic refresh consumption are preserved; session/refresh integration checks passed afterward.

## Verification

- Windows API/frontend typechecks and API production build passed after dependency synchronization.
- Linux API/frontend typechecks and production builds passed. The frontend build ran in a temporary memory-controlled scope on CPU 6, using the existing swap and retaining the 1.5 GiB VM free-memory guard. No live service memory limits or VM CPU/RAM allocations were changed. The scope ended after the build.
- Eight new API regression groups passed, including **162** policy/time/hidden-resource/admin combinations, route-alias bucket sharing, cross-IP username throttling, parser ordering, list/detail visibility equivalence and URL schemes.
- Five existing security regression groups, **54** real Nest/Socket.IO checks, four archive regressions and **37** HTTP integration checks passed. HTTP tests used a separate dummy database, which was removed; they covered normal uploads, malformed uploads, login aliases, logout, refresh races, PDF access, contest restrictions and post-contest access.
- A disposable networkless grader ran actual main-loop/judge/Isolate cleanup. Final-testcase scratch used **67,153,920 bytes** of tmpfs at persistence and **0 bytes** when idle. A forced cleanup failure preserved the saved AC verdict and requested exit 70. Subsequent ordinary C++ and Python jobs passed.
- Shortened-deadline fixtures confirmed startup/claim blockage exits for recovery while an independent heartbeat continues, and ordinary paused waits do not expire.
- A separate networkless PostgreSQL fixture confirmed the main connection's configured timeouts, a real held advisory-lock timeout in approximately 10 seconds, query cancellation and usable connection recovery after rollback.
- Ordinary/expanded judge pipeline, watchdog and checker-memory regressions passed. Five accepted reference solutions retained 100 points against complete current testcase data, without production verdict writes.
- Restricted `otog-web` preview passed home/login/problem pages, static assets, CSRF and backend proxy checks. All 84 reviewed frontend source files were checked against the maintenance checkout; two differences were reviewed as formatting-only and preserved. The Python editor's `.py` filename fix remains included.
- Final localhost/ngrok checks passed. Public PDF 48 returned 200 with PDF content; hidden PDF 1 returned 403 for guests. The actual running packages resolve Next.js 15.5.28 and Multer 2.4.0. All six workers have fresh heartbeats and are enabled.

## Deployment and recovery

The six graders were drained before replacement; original enabled flags, Docker image identities, CPU assignments, 1,536 MiB worker memory limits, restart policies and 256 MiB/4,096-inode tmpfs mounts were preserved. Result/scoring/policy fingerprints matched across the grader replacement.

- Grader release and compose rollback: `/opt/otog/security-remediation-20261021/compose.before.yml`.
- API runtime: `/opt/otog/releases/security-20261016/apps/api`; its `dist` now contains the verified new bundle. Previous compiled API: `dist.before-audit-20261021` beside it.
- Frontend runtime: `/opt/otog/security-remediation-20261021/workspace/apps/web/.next/standalone/apps/web`.
- Frontend-only override: `/etc/systemd/system/otog-web.service.d/zzzz-audit-remediation-20261021.conf`. It changes the executable/working directory and inherits the existing service account, environment and protections. Removing this specific override restores the retained Python-extension release.
- **The new release workspace contains the active frontend. Do not delete it as a temporary build directory.**
- Reviewed source and regression tests are retained in the release workspace, and the human maintenance checkout was synchronized without replacing its environment files or data.

The first application activation was rolled back because the verification script failed to trim a newline from a systemd value. The verifier was corrected and the same tested builds were activated successfully. The website recovered and no data rollback was performed. A temporary test-directory permission issue and staged compiler memory limits were also resolved before activation; those failures did not change running application code.

For rollback, drain graders before switching their compose file. Restore the prior API `dist` and remove only the new frontend override as needed, then restart the affected application services. Do **not** restore a database backup to undo this code-only release. Preserve users' new accounts, sessions and results.

Sanitized evidence is at `D:/otog-grader/vm-setup/audit-remediation-evidence-20261021/`, including `api-tests.json`, `grader-tests.json`, both deployment records, `web-tests.json`, and `postflight.json`. Credentials, environment files and accepted solution fixtures are not exported.

## Remaining boundaries

These fixes do not establish that the earlier VM freezes were caused by these findings or that every crash is impossible. RAM admission still samples availability rather than reserving future allocations, so six memory-heavy running jobs can still pressure a 4 GiB VM. Checkers retain their previously introduced per-process cap rather than a new aggregate child-process cgroup. Compiler/kernel/Isolate bugs and whole-VM scheduling failures remain separate boundaries. The archive reservation is process-local, appropriate to the current single API process; multiple API instances would need shared coordination.
