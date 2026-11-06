# Security remediation — deployed 16 October 2026

The tested fixes are live in the Ubuntu VirtualBox VM. Localhost and ngrok passed verification; all six graders are connected and monitoring is fresh. No production rejudges, account deletions, renumbering or testcase replacements were performed.

Public PDFs remain readable without signing in. Hidden PDFs require a current authorized session: an administrator, or an authenticated user entitled through an ongoing public contest. Used, expired and logged-out sessions no longer unlock them. The existing schema has no invitation-only/private-contest flag; public contests retain automatic enrollment.

## Changes against the audit

| Finding | Deployed change |
| --- | --- |
| F01: testcase exposure | Execution and compilation mask `/usr/src`, including shared answers. Compilers receive the submission and permitted libraries in a private Isolate box. |
| F02: legacy fallback | Core helpers now fail closed. **Audit correction:** the active worker already blocked failed Isolate initialization; the original critical interpretation was overstated. |
| F03: compiler isolation | C/C++/Python compilation runs in Isolate with a clean environment, 30 CPU seconds, 35 wall seconds, 768 MiB virtual-memory limit and 64 processes, plus an outer deadline. |
| F04: database superuser | Separate restricted API/grader roles are active. Graders cannot read users/passwords/sessions or create schema objects. The former shared administrator password was rotated; a real connection test confirms its retired value is rejected. |
| F05: multipart parser | Multer upgraded to 2.4.0; normal, oversized and malformed multipart requests tested. |
| F06: frontend dependencies | Next.js upgraded to 15.5.28; sharp pinned at 0.35.5. Contract packages/types aligned and lockfile saved. Existing Inter/Noto fonts bundled locally to remove the failing build-time download. |
| F07: password hashes | New/reset passwords use random-salt scrypt with bounded concurrency. Legacy SHA-256 hashes upgrade on successful login. Last check: 25 legacy hashes and one scrypt hash; no forced resets. |
| F08: stale authorization | HTTP/chat check current database identity and session state. Logout, account deletion and password/role changes revoke affected sessions. JWT verification explicitly permits HS256. |
| F09: refresh race | Refresh consumption is conditional and atomic; concurrent use has exactly one winner. |
| F10: hidden PDFs | Used/expired/revoked cookies are rejected; public PDFs ignore stale cookies and remain available to guests. |
| F11: privacy/eligibility | Hidden submission reads/lists filtered; ordinary users cannot request another user's private contest submissions. Problem/PDF/attachment reads check visibility. Contest submissions require the problem/contest association and valid timing before enrollment. |
| F12: ZIP extraction | Streamed staging extraction rejects traversal/absolute paths and enforces entry, expanded-size and disk budgets. Replacement is atomic; an invalid archive preserves existing testcases. |
| F13: resource bounds | Streaming source limit preserves the existing 10 KiB allowance. Multipart fields, pagination, chat messages and queue admission are bounded. Workers have 1536 MiB memory/no-swap limits, 128 PIDs and 256 MiB Isolate tmpfs. Output files are capped at 64 MiB; compiler diagnostics at 64 KiB. |
| F14: process privileges | Separate `otog-api`/`otog-web` accounts have root-owned code, root-read environment files, protected system/home paths and explicit data/cache writes. Neither belongs to Docker. A narrow broker permits only sanitized inspection/restart of the six verified graders. Human `otog` retains sudo/Docker access. |
| F15: browser/session hardening | HTTP and Socket.IO use the configured origin allowlist; WebSocket handshakes reject untrusted origins too. Cookies specify SameSite/HTTPS Secure behavior; production API docs are disabled; response headers and announcement URL-scheme validation added. |

## Verification

- API typecheck/build and Next.js production typecheck/build passed.
- **58** real Nest/Socket.IO regression checks passed against dummy state: signatures, expiry, identity, revoked sessions, both transports and origin rules.
- **29** HTTP checks passed, including a repeat under the restricted service account and production filesystem protections: signup/login, uploads, roles, privacy, PDFs, CORS, refresh races and logout.
- C/C++/Python sandbox tests passed. Dummy private-file reads were denied during execution/compilation; failed initialization refused execution.
- Accepted reference submissions **631/627/649/651/650**, on problems **48/52/53/54/56**, still score 100 across complete testcase sets in disposable networkless containers, without production verdict writes.
- The restricted grader role passed claiming, locking, result persistence, contest scoring/history and lease cleanup in a separate fixture database. That database and transient test services have been removed/stopped.
- Claims were paused and active jobs drained before grader replacement. Database counts/hashes for results, verdicts, contest scoring/history and grading policies matched before/after replacement. Original pause flags were restored.
- All current problem memory allowances fit the container budget: maximum **1024 MiB**, including Tull. All **974** inspected answer/output files fit the output cap; maximum **8,638,022 bytes**.
- Final localhost/ngrok checks passed for public browsing/PDFs, private PDF authorization, role guards, revoked sessions, login/CSRF routes and page assets. All six worker heartbeats/locks and fresh telemetry were verified. Temporary audit sessions were deleted afterward; no test accounts or submissions were created in production.
- Proxy-level cookie checks also passed: RID is HttpOnly/SameSite=Lax on both paths and Secure on ngrok HTTPS, including cookies forwarded by the frontend login handler. Localhost HTTP remains usable. Nginx reloaded gracefully; these probes revoked no real session or restarted any grader.

The **six workers**, **1.5 GiB free-memory admission guard**, per-user worker setting and **Tull's one-worker limit** remain. No Windows security or VM hardware settings were changed.

## Deployment and recovery records

- Active runtime: `/opt/otog/releases/security-20261016`. Services: `otog-api`, `otog-web`, added `otog-worker-control`; security drop-ins: `zz-security-20261016.conf`.
- Root-only configuration: `/etc/otog/`. Management credentials are separate from runtime credentials. Values are deliberately absent from this report.
- Human maintenance checkout: `/home/otog/otog`, synchronized with patched source/packages/lockfile. **Editing that checkout does not automatically update the protected active runtime.** Validate a release before activation.
- Grader image: `otog-grader:security-20261016`; prior image/compose retained. Existing queue, memory, keyword and worker-control mounts preserved.
- Private original backup: `/home/otog/security-backups/security-patch-20261016-original.tgz`, also at `D:\otog-grader\vm-setup\security-patch-20261016-original.tgz`. Windows ACL restricted; Git ignores it. It contains private database/configuration material and should not be shared.
- Sanitized evidence: `D:\otog-grader\vm-setup\security-patch-evidence-20261016\`.
- Detailed release records: `/home/otog/worker-setup/security-patch-20261016-051050/`.

Do not restore the old database over live data to undo an application issue. New results/accounts and migrated hashes must survive. For a service-permission regression, retain patched authentication/current credentials while adjusting restrictions. Blindly restoring the old SHA-256-only authentication build would prevent migrated users from signing in. The API build immediately before the final chat-origin change is retained as `apps/api/dist.before-origin` within the protected release and already supports scrypt.

## Remaining limits

- Isolate still uses privileged grader containers. A sandbox/kernel vulnerability could therefore have significant VM impact. Administrator-supplied checker/command code remains trusted.
- A 4 GiB VM cannot guarantee six memory-intensive jobs without contention. Caps/admission checks bound several abuse paths but do not prevent already running jobs from allocating memory or eliminate every denial-of-service risk.
- Password migration completes as users log in/reset passwords; no mass reset was imposed.
- These tests do not prove the absence of all vulnerabilities. Full kernel/container-image scanning, browser XSS fuzzing and every contest-policy combination were outside the completed tests.
