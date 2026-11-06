# OTOG clone security audit — 16 October 2026

This audit found significant vulnerabilities. The first priority is the judge isolation boundary: the running image exposes the testcase tree inside contestant sandboxes and compiles submissions outside the sandbox.

**Correction during remediation:** the active `mainWorkers.py` wraps `judge.initIsolate` and already raises an infrastructure error if initialization returns `None`. F02 originally overlooked that wrapper and overstated the deployed exposure. Its unsafe core fallback is latent defense-in-depth work, not a demonstrated current critical vulnerability. The standalone canary tested the core helper, not the active wrapper.

**Audit and report only. No production patches, configuration changes, account changes, submissions, rejudges or service restarts were performed.** Application/service PIDs and all eight existing container start timestamps were unchanged at verification. Temporary scripts, sanitized evidence and dummy canaries were created for the audit. All local artifacts are on D.

**Deployment update:** authorized remediation is now live. See [deployed changes, verification and remaining limits](SECURITY-REMEDIATION-20261016.md). The findings below describe the pre-remediation state.

## Scope and evidence

Reviewed the API controllers, guards, authentication/session services, chat, problem and testcase management, submissions, contests, grading controls, avatar storage, web authentication/rendering, and grader compile/execution paths. Checked the running VM's service identities, container privileges/mounts/resource limits, database role privileges, SSH, listeners, nginx and VirtualBox forwarding. Compared eight relevant deployed application source files and three running grader source files with the local sources; they matched.

Validation included anonymous HTTP requests, a wrongly signed test JWT, a read-only hidden-PDF request using an already expired/used refresh cookie, isolated copies of the real TypeScript functions with dummy database state, and a disposable container using the deployed grader image. That container had no network, no production credentials and no real testcase mounts; its only mounted data was an audit canary, with a 256 MiB memory limit, 32-process limit and one CPU. No denial-of-service payloads, exploit probes against real credential files or container escape attempts were run.

Sanitized evidence: [audit evidence directory](../../../grader/vm-setup/security-audit-20261016). Key files: `inventory.json`, `privileged-inventory.json`, `sandbox-canary.json`, `offline-validation.json`, `production-packages.json`, `final-verification.json`.

Severity expresses impact and prerequisites in this deployment. A configuration weakness is not itself proof that someone has exploited it. No finding below establishes that the server has already been compromised, or explains a particular historical outage.

## Findings at a glance

| ID | Severity | Finding | Evidence / prerequisite |
| --- | --- | --- | --- |
| F01 | High | Contestant sandbox can read the shared testcase/answer tree | Confirmed with a dummy mounted testcase in the deployed image; ordinary submission capability |
| F02 | Low, latent core fallback | Core helper permits an unsafe fallback, but the active worker already blocks it | Active worker wrapper raises on failed initialization; remove the legacy path for defense in depth |
| F03 | High | Compilation runs as root outside the contestant sandbox | Real compile function exposed a dummy file in diagnostics; no compiler memory cap in production |
| F04 | High | Graders use a PostgreSQL superuser account | Confirmed through a read-only role query; impact amplifier if a worker/credential is compromised |
| F05 | High | Installed multipart upload library has published DoS vulnerabilities | Multer 1.4.4-lts.1 matches vendor advisory ranges; authenticated upload routes exposed |
| F06 | High / conditional | Old Next.js version matches applicable security advisories | Next 14.2.3, Pages Router SSR, default image optimization; exploit effects not induced |
| F07 | High, conditional on hash disclosure | Passwords use unsalted, fast SHA-256 | Registration, password update and login source paths verified |
| F08 | High for compromised administrators | HTTP access tokens cannot be promptly revoked | Current role/account state is not checked; tokens issued for 12 hours; logout only clears a cookie |
| F09 | Medium | Refresh-token single-use protection has a race | Two concurrent validations of the same dummy token both succeeded |
| F10 | Medium | Hidden PDFs accept expired/used refresh cookies | Live read-only check returned a PDF with HTTP 200 |
| F11 | Medium | Hidden-problem and contest authorization is inconsistent | Anonymous hidden submission detail returned metadata/diagnostics; additional source-confirmed gaps |
| F12 | Medium, administrator required | Testcase ZIP can write outside its problem directory | Actual extraction function wrote a dummy canary outside `source/<id>` in a temporary directory |
| F13 | High availability risk | Resource and abuse controls leave several exhaustion paths | Missing compile/output/container caps, late upload validation, unbounded pagination and no explicit request/queue admission rate limits |
| F14 | High impact amplifier | Public application account has Docker-level VM control | API/web run as `otog`, which belongs to Docker; unsandboxed service privileges are broad |
| F15 | Low / hardening | Broad CORS, incomplete cookie flags, development API docs and missing response defenses | Live headers, accessible docs and configuration review |

These findings overlap in their attack paths; they should not be interpreted as fifteen independent remote takeovers.

## F01 — Testcases and answers are visible inside contestant sandboxes

All six workers mount `/home/otog/otog/apps/api/source` at `/usr/src/app/shared-source`, read-only. The runner uses Isolate's default directory rules without removing or masking `/usr/src/app`. Isolate exposes `/usr` recursively by default, including nested mounts. Read-only access protects integrity, but does not protect hidden inputs or expected answers.

**Proof:** In a fresh container using `otog-grader:glibc-20261012`, a sandboxed process successfully read `/usr/src/app/shared-source/audit.sol`. That file contained only `OTOG_AUDIT_DUMMY_TESTCASE_ONLY`. The probe used the same default directory exposure as the live runner. It did not inspect real answers.

Impact: a malicious contestant can inspect inputs, expected answers and auxiliary grader files exposed under that tree. This can undermine judging and disclose hidden problems. This is filesystem overexposure inside the sandbox, not proof of a kernel/container escape.

Source: [execution options](../../../grader/src/evaluate/verdict/main.py#L18). Configuration: grader mounts in `inventory.json`. The behavior agrees with the [official Isolate directory-rule documentation](https://github.com/ioi/isolate/blob/master/isolate.1.txt).

Remediation: keep grader code, testcase storage, credentials and logs outside the sandbox's exposed filesystem. Construct an explicit minimal directory allowlist or correctly mask private subtrees. Expose only the executable/runtime libraries and necessary per-job inputs. Test all supported languages and custom checkers before deployment; merely making mounts read-only is insufficient.

## F02 — Sandbox initialization failure permits an unsafe fallback

[initIsolate](../../../grader/src/handle.py#L95) returns `None` on initialization error. [judge](../../../grader/src/judge.py#L165) continues with that value. [The execution fallback](../../../grader/src/evaluate/verdict/main.py#L82) then launches the contestant program through a normal shell with a time/memory ulimit, without the Isolate identity, filesystem or network boundary.

The worker process is UID 0 in a privileged container. A caller using that core fallback directly would have an unsafe execution path. However, the deployed `mainWorkers.py` replaces `judge.initIsolate` with `require_isolate`, which raises if initialization returns `None`; normal active workers do not reach this fallback after initialization failure. **The standalone helper's failure branch was reproduced using a simulated initializer failure. I did not force a live failure, run a contestant program as root, or demonstrate escape into Ubuntu or Windows. The original severity was overstated because the active wrapper was missed.**

Remediation: fail closed. If Isolate is enabled but cannot initialize, mark an infrastructure/judge error and stop that job; do not continue. Reject configurations that allow unsandboxed execution of untrusted submissions. Validate recovery behavior without using live jobs.

## F03 — The compiler is outside the isolation and resource boundary

[create](../../../grader/src/handle.py#L220) invokes the configured compiler via a shell as the worker's root identity. A 30-second timeout exists, but compilation is not run inside Isolate, has no explicit memory/process/output budget and inherits the worker environment. Production containers have `memoryLimit=0` and no PID limit.

**Proof:** Calling the real `handle.create` function in the isolated audit container on C++ source that included a dummy header outside the box returned that header's dummy text through compilation diagnostics. The corresponding diagnostics are normally placed in submission results. This establishes compiler-side file disclosure without any runtime sandbox escape.

Impact: compiler-readable private files can be exposed, and expensive compilations can consume VM resources beyond the intended contestant runtime limits. A dummy inherited-environment disclosure probe did **not** succeed; this audit does not claim that live database credentials were extracted.

Remediation: compile under a separate unprivileged, bounded sandbox with a minimal filesystem and sanitized environment. Do not pass database/cloud/session credentials into compiler processes. Apply memory, time, process and byte limits to compilation and diagnostics, and retain only permitted build artifacts.

## F04 — The worker database role has full administrative privileges

A read-only query, made using the running grader's existing connection settings, returned `rolsuper=true`, `rolcreatedb=true`, `rolcreaterole=true` and `rolreplication=true`. Worker environment configuration contains database credentials. No credential values were recorded in the report/evidence.

Impact: compromise of a grader credential/process can affect the entire database rather than only the queue and results it needs. PostgreSQL superuser capabilities can also extend beyond ordinary table access inside the database container. This does not establish a direct unauthenticated database endpoint.

Remediation: create separate least-privilege API, migration and grader roles. Grant graders only the tables/functions needed for claims, heartbeats and result persistence; keep migrations/admin operations separate. Validate every normal queue/result path before removing old grants. Rotate credentials after fixing exposure paths if compromise is suspected.

## F05 — Vulnerable multipart parser is deployed

The API resolves Multer **1.4.4-lts.1** through `@nestjs/platform-express` 10.3.8. Submission and avatar uploads use this stack. Role guards precede normal upload handling, so the ordinary contestant path requires an account; registration is available publicly.

The vendor documents an [unhandled-exception DoS affecting this version](https://github.com/expressjs/multer/security/advisories/GHSA-g5hg-p3ph-g8qg), [uncontrolled-recursion DoS](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2), and [oversized-array-index DoS](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4). These are installed-version/advisory matches; no crash request was sent to your server.

Remediation: upgrade the supported Nest upload stack and Multer to a currently patched compatible release, configure strict multipart limits, then test submission, avatar and administrator PDF/ZIP uploads. The newest reviewed index advisory requires at least 2.3.0; do not stop at the older 2.0.1 fix, and review newer vendor advisories before choosing the actual target.

## F06 — Next.js has known security debt

The deployed web package is **Next.js 14.2.3**. It uses the Pages Router, non-dynamic SSR pages and the default image optimizer. It therefore matches the documented prerequisites/version ranges for [Pages Router cache poisoning](https://github.com/vercel/next.js/security/advisories/GHSA-gp8f-8m3g-qvj9) and the [image-optimization CPU DoS](https://github.com/vercel/next.js/security/advisories/GHSA-g77x-44xx-532m). Cache poisoning and resource exhaustion were not induced. nginx currently caches only immutable static assets, which limits one caching layer but does not repair the framework.

Avoid interpreting every Next.js headline as applicable: this clone has no Next middleware authorization boundary or App Router/RSC routes in the reviewed source. Also, the installed dependency inventory contains **sharp 0.35.5**, which meets the vendor's explicit workaround for the [October 2026 SVG image RCE advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw). That specific RCE is **not reported as confirmed here**.

Remediation: upgrade Next.js to a currently maintained, patched release with matching dependencies, exercising SSR/session behavior, API rewrites, static assets, the editor and image rendering. Patching only to an old advisory's minimum version would leave later security fixes missing.

## F07 — Password hashing is unsuitable for breach resistance

[User creation](../../../apps/api/src/modules/user/user.service.ts#L36), password updates and [login verification](../../../apps/api/src/modules/auth/auth.service.ts#L33) use a single unsalted SHA-256 hash. Equal passwords produce equal hashes, and guesses are cheap if hashes are ever disclosed. No password hashes were extracted or attacked during this audit.

Remediation: use a versioned password format with a suitable password KDF, preferably Argon2id with per-password random salt, and migrate legacy hashes after successful login. Bound hashing concurrency on this small VM. See [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## F08 — HTTP authorization survives account/role changes and logout

[JwtStrategy.validate](../../../apps/api/src/modules/auth/jwt.strategy.ts#L16) returns verified token claims without looking up the current user or checking a session/token version. [Tokens last 12 hours](../../../apps/api/src/modules/auth/auth.module.ts#L20). [Logout](../../../apps/api/src/modules/auth/auth.controller.ts#L72) clears the RID cookie but does not revoke the database refresh row or access JWT.

Impact: a previously issued token retains its embedded authorization until expiration, including an administrator token after demotion, account deletion or password change. A stolen refresh pair is not invalidated by logout alone. This is a revocation weakness: wrongly signed JWTs are rejected, and this is not the previously fixed chat signature bug.

Validation: the real strategy accepted and returned a dummy admin payload without consulting database state in an isolated test. No real user's role, password or session was changed.

Remediation: check current identity/authorization plus a revocable session or token version on protected requests. Revoke relevant refresh sessions on logout, password changes and account/role changes; shorten access-token lifetime appropriately. Ensure chat connections also respond to session revocation.

## F09 — Refresh rotation is not atomic

[validateToken](../../../apps/api/src/modules/auth/auth.service.ts#L84) reads the row, checks `used`, then marks it used in a separate update. Concurrent requests can both pass the read/check stage. With the actual service and dummy Prisma state, **two simultaneous validations of one refresh token both succeeded**.

Prerequisite: possession/use of the same valid token pair concurrently. This does not let an attacker invent a valid token.

Remediation: atomically consume a token with expiry, used state and JWT binding in the update predicate/transaction; require exactly one affected row. Keep replacement issuance consistent with that transaction and test simultaneous refreshes from multiple tabs.

## F10 — Expired or already used cookies still unlock hidden PDFs

[getPdf](../../../apps/api/src/modules/problem/problem.controller.ts#L100) identifies a user by RID row existence but does not check `used` or `expiryDate`. This bypasses the stronger checks in the normal refresh endpoint.

**Live proof:** an already expired/used administrator refresh cookie returned **HTTP 200 and a PDF signature** for hidden problem 1, without an access JWT. Only the first five PDF bytes were read; the cookie and document content were not stored. The database had 17 used/expired refresh rows at the time, but only one cookie was checked.

Remediation: authorize document requests through the same current, valid session policy as other private resources. Do not treat old refresh rows as enduring login credentials. An ordinary user also requires an explicit contest entitlement check where applicable.

## F11 — Privacy checks differ across resource routes

**Live proof:** anonymous `/backend/problem/1` returned 403, but `/backend/submission/523` returned 200 with metadata for that hidden problem and compilation diagnostics, although that submission's `public` flag was false. This does not establish disclosure of its source code: the detail endpoint tested does not return source.

[Submission read queries](../../../apps/api/src/modules/submission/submission.service.ts#L92) do not consistently enforce problem visibility or contest entitlement. Additional source-confirmed gaps include accepting a caller-supplied user ID in contest submission queries, missing contest membership checks in problem/detail/attachment routes, and a submission eligibility predicate that does not enforce contest start/end times. Some routes intentionally expose public scores, so the desired contest policy needs to be explicit before changing them. There is no private-contest flag in the reviewed schema; membership restrictions are nevertheless not enforced by these routes.

Remediation: centralize visibility/entitlement rules and apply them to list, detail, PDF, attachment, keyword-rule, score and submission endpoints. Enforce timing/membership on the server, and distinguish public scoreboard visibility from access to another user's submissions. Test anonymous visitors, ordinary contestants, non-members and administrators. Do not make public problem browsing require login as a shortcut.

## F12 — Administrator testcase ZIP extraction escapes its directory

[updateProblemTestCase](../../../apps/api/src/utils/file.util.ts#L33) joins `entry.path` to `source/<id>` without validating that the resolved path remains within that directory. Entries are buffered without an expanded-byte or entry-count budget. Existing testcases are removed before the replacement archive is validated.

**Proof:** the actual deployed extraction function, loaded in a temporary audit working directory with a dummy file manager matching the local write behavior, accepted `../../escape-canary.txt` and wrote outside the problem directory. It touched no real problem or application path.

This route is administrator-only. An attacker needs administrator access or must persuade an administrator to upload an untrusted archive. It is not reported as an anonymous upload exploit. Administrators can already supply trusted custom checker/command code, but that does not justify arbitrary writes into API/application directories.

Remediation: validate normalized paths, disallow traversal/absolute paths/symlink tricks, enforce permitted entries and expanded-size/count limits, and extract into an isolated staging directory. Validate the complete package, then atomically replace the problem bundle; retain the old bundle on failure.

## F13 — Resource admission is incomplete

The new 1.5 GiB admission guard helps with ordinary load, but it cannot stop already running processes from allocating memory or filling disk. Confirmed gaps:

- Grader containers have no Docker memory/PID ceiling; compilers have only the 30-second timeout.
- Runtime Isolate arguments do not specify a file/output size limit. Output is later copied/read for checking; a long output line can also make the line-based checker allocate substantial memory.
- Submission `FileInterceptor('sourceCode')` has no streaming size limit. The 10 KiB check happens only after Multer has buffered the upload. nginx permits bodies up to 100 MiB on the shared endpoint.
- Pagination contracts accept arbitrary numeric limits, passed to Prisma without a maximum on public submission/chat reads.
- No explicit per-user/IP login, registration, chat-message or submission rate limit was found in the reviewed application/nginx configuration. Worker concurrency caps limit active jobs, not the number of queued submissions or stored messages/accounts.
- ZIP expansion and compile-diagnostic byte budgets are missing.

These were confirmed by code/configuration review, not by exhausting resources. They could produce failures resembling ordinary overload, but do not establish the cause of earlier outages.

Remediation: separate upload limits by route, reject oversized streams early, bound page sizes and queue admission, rate-limit abusive operations while preserving normal contestants' experience, and enforce compile/runtime/output/container budgets. Choose memory ceilings around legitimate high-memory tasks, including NPK Tull, and preserve its one-worker cap. Test the memory guard and six-worker workflow after changes.

## F14 — A web-process compromise would have excessive VM impact

The API, web and ngrok services run as `otog`. That account belongs to `docker`, `sudo` and `lxd`. API/web service settings do not enable `NoNewPrivileges`, `ProtectSystem` or `PrivateTmp`. Worker-control code connects directly to `/var/run/docker.sock`; its endpoint currently restricts requested worker identities, but the API process itself holds broader OS authority.

Impact: code execution in the API/web account can become much more than an application-data compromise. Docker control is root-equivalent for the Ubuntu VM, as explained by [Docker's security documentation](https://docs.docker.com/engine/security/). This is an impact amplifier, not proof of an existing remote code-execution entry point or of Windows host compromise.

Remediation: use separate service accounts and a narrow privileged broker/socket policy for approved worker operations. Harden writable paths and service privileges incrementally, preserving uploads, builds and worker controls. Do not simply remove privileges from live Isolate containers without testing their required namespace operations.

## F15 — Lower-priority session/header/configuration hardening

- API CORS reflects arbitrary origins and permits credentials; live requests with `Origin: https://audit.invalid` received matching allow-origin plus allow-credentials. Restrict to intended site/local origins. Bearer JWTs are not automatically supplied by the browser to an attacker, so reflected CORS alone is not proof of authenticated account takeover.
- Backend RID cookies specify HttpOnly but omit explicit Secure and SameSite. The web access-token cookie is intentionally readable by browser code; this increases the impact of any future XSS. Set explicit cookie policy compatible with HTTPS ngrok and localhost, and avoid exposing bearer tokens to JavaScript where the architecture can support it.
- The API process starts with `NODE_ENV=development`, and `/backend/doc` is accessible anonymously with HTTP 200. This is API documentation exposure; the web process is in production mode. API docs are not themselves an authorization bypass.
- Sampled responses lacked CSP and `X-Content-Type-Options`. Add appropriate defenses after checking PDFs, Monaco workers, styles and authentication flows. Validate URL schemes in administrator-authored rich-text links; no stored-XSS exploit was confirmed in this audit.
- Ubuntu UFW is inactive and the API listens on all guest interfaces. **Current VirtualBox NAT forwarding binds both SSH (2222) and web (3030) to Windows loopback only; PostgreSQL/Minio/monitor ports also bind guest loopback.** I did not find direct database/SSH exposure to the LAN through these forwarding rules. Consider guest firewall/binding defense in depth before changing VM networking.

## Checks that passed / important non-findings

- The prior chat fix remains present in deployed source. All **52** chat authentication/expiry/transport regression checks passed against a local dummy server, with zero production writes or live chat messages.
- The HTTP API rejected a wrongly signed administrator JWT with 401.
- Sampled administrator grading/user/problem routes returned 401 anonymously. The ngrok grading route also returned 401.
- Anonymous direct access to a hidden problem returned 403 both locally and through ngrok.
- Sampled `.env` and direct testcase-file HTTP paths returned 404. Filesystem exposure F01 is a different path.
- Sampled live API/web/grader/Cloudinary/private-session environment files were mode 0600. No matching short/common placeholder was detected for the active session secrets inspected. This is not an exhaustive secret-entropy analysis.
- Avatar handling has server-side ownership/admin guards, upload/dimension restrictions, fixed Cloudinary endpoints, signed server requests and operation throttling. No confirmed avatar authorization bypass or SSRF was found in the reviewed path.
- Reviewed Prisma query paths use structured arguments or tagged parameterized SQL; no confirmed SQL injection was found. User-supplied source text being compiled is not by itself shell-command injection.
- The monitor is loopback-bound and its service has stronger service isolation than the API/web services.
- VirtualBox remains in use, with eight vCPUs and 4096 MiB RAM. No Windows security or VM setting was changed during this audit.

## Recommended remediation sequence

1. Repair the judge boundary: fail closed, isolate compilation, remove private filesystem exposure, and add meaningful output/compile resource limits. Verify C/C++/Python, custom checkers, six workers, memory admission and Tull's one-worker restriction in a staging test first.
2. Replace shared database superuser credentials with least-privilege roles and reduce application access to Docker/VM administration. Rotate any credentials reasonably suspected of exposure after fixing the leak paths.
3. Upgrade the vulnerable upload stack and Next.js/dependencies with regression checks.
4. Fix session revocation, atomic refresh rotation and PDF authorization, then unify problem/contest visibility checks.
5. Migrate password hashing, secure ZIP replacement, and add route-specific abuse limits and browser defenses.

This is a proposed order, not authorization inferred to deploy changes. No fixes have been deployed by this audit.

## Coverage limits

This was a broad manual, non-destructive audit, not a proof that every vulnerability has been found. It did not include high-volume fuzzing, DoS payload execution, kernel/VirtualBox exploit attempts, all possible contest authorization combinations, exhaustive browser XSS testing, full Windows security auditing, third-party Cloudinary/ngrok account-policy review, or scanning every historical backup/Git object.

The local dependency walk inventoried **686 reachable production package names**. Five dependency names could not be resolved by that walk (`@otog/ui`, `click-to-react-component`, `monaco-editor`, `vscode`, `@aws-sdk/nested-clients`); the UI source was available for manual review. Selected important vendor advisories were matched manually. This is **not** a clean result from an exhaustive dependency/CVE scanner, nor a full Ubuntu/container-image CVE scan.

Automatic approval review rejected uploading the installed package/version inventory to npm because it would disclose deployment metadata externally. The request was not executed. The replacement inventory script runs locally without external requests, and public vendor advisories were consulted separately. No unresolved finding depends on claiming that blocked scan completed.
