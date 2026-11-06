# OTOG security and worker availability review

**Date:** 21 October 2026 (Asia/Bangkok). **Work performed:** assessment, bounded offline verification, and documentation. Application code, dependencies, production accounts, submissions, verdicts, and services were not changed.

## Main result

There is a credible **persistent queue-stall path involving files retained after completed jobs and the low-memory admission guard**. The actual worker loop reproduces the control-flow problem with a simulated memory reading. A new contestant-program-to-Linux-sandbox reproduction was not possible in this environment, so this is not reported as a demonstrated live outage.

Separately, offline checks confirmed bypasses of the login/registration throttles, a middleware-ordering error that disables the intended per-username throttle for ordinary JSON requests, and two routes that disclose contest-result information despite scoreboard restrictions. The local installation also still loads vulnerable dependency versions even though the package manifests and lockfile request newer versions.

The previously reproduced deep-directory worker poisoning is **already addressed in the reviewed grader sources and retained deployment records**. It should not be treated as a newly confirmed, still-unfixed issue. No sandbox escape or newly demonstrated permanent worker crash was found in this review.

## Scope and limits

Reviewed the security-sensitive API controllers/services, guards, authentication and refresh handling, chat, submission admission, visibility rules, problem/PDF/attachment/archive handling, avatar handling, frontend authentication and rendering sinks, dependency resolution, Docker/build configuration, and the neighboring grader implementation at `D:\otog-grader`. Grader review covered compilation, per-testcase reset, output collection, answer checking, native cleanup patch, claims/leases, retry accounting, persistence, watchdogs, heartbeat/control, memory admission, and legacy entrypoints.

The source inventory contains **61 API TypeScript files, 84 web TypeScript/TSX files, 2 contract files, the database schema, 45 grader Python files, and 4 grader/deployment files**. This is a repository-wide security triage with deeper inspection of trust boundaries; an inventory hash is not a claim that every line or every possible behavior has been exhaustively verified. Generated/minified vendor bundles and every historical deployment script were not individually audited.

Important evidence boundaries:

- Findings concern the **current local source**, including pre-existing uncommitted changes. Repository HEAD is `b408effb3b491a790b6ce13baba65cb54895e475`; HEAD alone does not describe the audited working tree. Relevant source hashes are retained with the evidence.
- The 12 current grader modules match the combined 17 October inode-cap/checker-hardening deployment manifests: 10 byte-for-byte, and the classic/Codeforces evaluators after CRLF normalization. This supports continuity with the retained release records, **not fresh verification of today's running containers**.
- Docker Desktop's Linux engine was unavailable. WSL and SSH to the local VM returned access/permission errors. No workaround or privilege escalation was attempted. Fresh Linux/Isolate/container tests and production-state verification were therefore unavailable.
- The existing Socket.IO regression script was attempted but timed out waiting for a connection in this restricted environment. It is **not counted as passing**. Its fixture app/clients close in `finally`.
- New passing tests use actual source functions with dummy dependencies/state; the worker test substitutes judging, production storage, and host-memory readings. Only a 64 KiB inert file stands in for contestant scratch data. No hostile contestant program, fork bomb, OOM attack, live submission, rejudge, restart, or production database operation was performed.
- Dependency checks were targeted version/advisory checks, not an exhaustive current CVE, operating-system, kernel, or container-image scan.

## Findings

Severity considers impact and prerequisites. Related observations are not independent remote takeovers. “Offline confirmed” means the described code path was exercised against fixtures, not against a deployed service.

| ID | Priority / severity | Finding | Evidence level |
| --- | --- | --- | --- |
| A01 | High availability, conditional | Completed jobs retain tmpfs data; memory admission can prevent the next cleanup and stall the queue | Actual worker loop + actual low-memory claim branch; simulated host memory |
| A02 | High for an exposed local instance | Installed Next.js/Multer versions differ from the patched manifests and remain in published affected ranges | Actual module resolution + vendor advisories; no crash payload |
| A03 | Medium | Login and registration rate limits can be bypassed through route aliases | Actual middleware + installed Express route matching |
| A04 | Medium | Per-username login throttling runs before the JSON body parser | Real initialized Nest middleware stack; no listener |
| A05 | Medium | Contest prize route bypasses scoreboard timing/policy restrictions | Actual controller/service, dummy database |
| A06 | Medium | Public-problem submission list bypasses contest-result visibility | Actual controller and service query construction, dummy database |
| A07 | Medium reliability, conditional | Startup and queue claims are outside the job watchdog | Source inspection; no database/network stall induced |

### A01 — Retained sandbox files can prevent workers from ever reaching cleanup

**Locations:** `D:\otog-grader\src\mainWorkers.py:82`, `:89`, `:146`; `src\worker_queue.py:93`; `src\sandbox_security.py:89`, `:121`, `:201`; `src\judge.py` final result path.

The worker claims a job before attaching/arming `JobWatchdog`. Claiming immediately returns `None` when available host memory is below 1,536 MiB. The worker then waits and repeats. This is intentional load protection, but the normal successful job path does not release the final testcase's sandbox tree or the compiled baseline. The next job's initialization/compilation performs that cleanup, **after** admission.

A submitted program can leave allowed scratch files behind during its final testcase without violating the per-file or inode limits. The current recorded mount allows up to 256 MiB per worker. Tmpfs data consumes memory and remains allocated while its files remain; a program exiting does not itself remove those files. Docker documents these properties in [tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/).

The problematic state is:

1. Jobs finish and persist results, retaining final sandbox files/baselines.
2. Available host memory stays below the admission threshold, partly because of retained data.
3. All idle workers reject new claims before sandbox cleanup can run.
4. No job watchdog is armed during that idle wait; Docker sees healthy worker processes. Heartbeats can remain fresh.

This is an admission/cleanup feedback loop, not a contestant process that defeats its execution time limit. It can remain until another source frees sufficient memory or an operator deliberately clears/restarts an affected idle worker. The precise payload size and number of jobs required depend on real VM memory, swapping, concurrent activity, and existing files. **A single submission was not demonstrated to force this state on the live VM.**

**Offline reproduction:** the actual `mainWorkers.main()` completed and persisted one dummy successful job. Its inert fixture left 65,536 bytes on disk; the memory-reader fixture then reported 1,400 MiB available. Three subsequent calls through the actual low-memory `claim()` branch returned no work, the worker waited each time, and the file remained. There were no sandbox runs or large real allocations. This proves the ordering/lack-of-cleanup behavior, not the full resource-exhaustion prerequisite.

**Recommended correction:** add bounded teardown of the contestant tree and compiled baseline after every finished job, while a cleanup deadline/recovery mechanism remains active. Retain required diagnostics first. Cleanup failure after a committed result must not overwrite that result or blindly requeue the job; retire/restart the affected worker safely. Idle workers should be able to reclaim their own stale scratch data without first passing the admission guard. Add an explicit low-memory-blocked reason to monitoring.

**Acceptance test:** in a disposable networkless Linux worker, use finite final-testcase file writes under the existing quotas, finish grading, and verify that scratch/baseline memory is reclaimed before the worker becomes idle. Independently force a low-memory admission reading and verify that bounded idle cleanup can restore progress. Follow with ordinary C/C++/Python jobs. Do not perform this on the live queue.

### A02 — Patched manifests do not match locally loaded dependencies

**Locations:** `package.json` overrides; `pnpm-lock.yaml`; `apps/web/package.json`; locally resolved dependency trees under `apps/api/node_modules` and `apps/web/node_modules`.

| Package | Declared/requested by current source | Actually loaded locally |
| --- | --- | --- |
| Next.js | 15.5.28 | **14.2.3** |
| Multer | 2.4.0 override | **1.4.4-lts.1** through Nest's Express adapter |

The check resolved modules from the consuming API/web package, rather than merely inspecting a top-level directory. This is installation drift. Editing a package manifest does not change an already installed module tree.

The loaded Multer version is within the vendor's affected range for [CVE-2025-48997 / unhandled-exception denial of service](https://github.com/expressjs/multer/security/advisories/GHSA-g5hg-p3ph-g8qg). Its use on protected upload routes generally requires an account; public registration exists. Loaded Next.js 14.2.3 is within the vendor ranges for [Pages Router cache poisoning](https://github.com/vercel/next.js/security/advisories/GHSA-gp8f-8m3g-qvj9) and [image-optimizer CPU denial of service](https://github.com/vercel/next.js/security/advisories/GHSA-g77x-44xx-532m). This project uses the Pages Router and has no configured image-optimizer workaround. Exact exploit effects also depend on runtime/build/proxy behavior.

**Scope:** confirmed on **this local checkout**. The 16 October remediation records describe separately installed patched production releases. The VM could not be inspected today, so this finding does not establish that those production releases reverted. Neither an upload crash nor cache poisoning was induced.

**Recommended correction:** synchronize installed dependencies with the reviewed lockfile using the project's package-manager version, verify module resolution in both consumers, rebuild, and exercise upload/session/page behavior before exposing the local instance. Review current vendor advisories when choosing release versions; the historical minimum fixes linked above are not a complete upgrade target. Do not deploy or expose a build based on the stale local installation merely because its manifest looks patched.

### A03 — Route aliases bypass the login/registration rate limiter

**Locations:** `apps/api/src/utils/security-middleware.ts:27`, `:33`; `apps/api/src/index.ts:18`; authentication routes in `auth.controller.ts` and the contract.

The limiter uses exact string comparisons against `/auth/login` and `/auth/register`. The Express router accepts different casing and trailing slashes by default. No application setting in the reviewed bootstrap makes those comparisons equivalent. See the [Express application settings](https://expressjs.com/en/4x/api/application/#app.settings.table).

**Offline proof:** for each endpoint, 125 canonical-path middleware calls produced five HTTP-429 decisions once the 120-request IP allowance was exceeded. For the same peer, all 125 uppercase-path calls and all 125 trailing-slash calls proceeded. The installed Express route layer confirmed that each alias matches the canonical protected endpoint. No requests were sent to a running server.

**Impact:** unauthenticated callers can avoid the implemented IP throttle for password attempts and account creation. Password-hash concurrency limits still bound simultaneous derivations; this is not evidence of password recovery. Queue depth caps remain but do not replace registration/submission-rate controls. No proxy-level compensating limiter was verified today.

**Recommended correction:** attach throttling to the authentication routes/guards themselves, or normalize paths consistently with routing before applying the limiter. Test both casing and trailing-slash variants for login and registration. Keep burst/rate controls separate from bounded password-hash concurrency.

### A04 — The intended per-username login limiter cannot see ordinary JSON bodies

**Locations:** `apps/api/src/index.ts:18`; `apps/api/src/utils/security-middleware.ts:28`.

`app.use(securityMiddleware)` is called before `app.listen()` initializes Nest's default body parsers. The middleware tries to read `req.body.username` immediately. For ordinary JSON requests, the parser has not populated `req.body`, so the username is empty and the `login-name:` bucket is skipped.

**Offline proof:** an empty real Nest application initialized with the same registration order had `securityMiddleware` at middleware-stack index 2 and `jsonParser` at index 3. No network listener or production module/configuration was loaded. The intended account-specific throttle is therefore not in the effective JSON login path, independently of A03.

**Impact:** even canonical requests from different source IPs do not share the intended per-account allowance. This weakens protection against distributed password guessing; it does not bypass authentication.

**Recommended correction:** perform per-account admission after a bounded body parser and before expensive password verification, preferably as part of the route's authentication guard. Verify that changing source IPs does not reset the account bucket, while avoiding an easy persistent account-lockout mechanism.

### A05 — Prize results bypass scoreboard restrictions

**Locations:** `apps/api/src/modules/contest/contest.controller.ts:187`; `contest.service.ts:303`. Route: `GET /contest/:contestId/prize`.

The scoreboard/history routes check contest timing and `scoreboardPolicy`. The prize route only checks whether an anonymous caller is accessing a contest containing hidden problems. It does not apply the scoreboard policy or timing gate. The service queries accepted submissions directly and returns first-blood/unique-solver information, submission IDs, problem IDs, and user identities.

**Offline proof:** for a fixture contest already started but not yet ended with `AFTER_CONTEST`, the actual scoreboard controller returned 403. The actual prize controller/service returned 200 with dummy accepted-submission and contestant information for the same anonymous caller when problems were public. For a hidden-problem contest, signing in passes the route's only visibility gate; the scoreboard policy is still absent.

**Impact:** competitors can learn who solved which tasks and acceptance/unique-solver information while that information is supposed to be withheld. This finding does not expose submission source code or an entire exact scoreboard.

**Recommended correction:** share one contest-results visibility decision across scoreboard, score history, prizes, and other derived result endpoints. Evaluate authorization before running the prize queries. Include `AFTER_CONTEST`, `DURING_CONTEST`, admin-only policy, and pre-start cases in regression fixtures.

### A06 — Public-problem submission listing omits contest-result visibility

**Locations:** `apps/api/src/modules/submission/submission.controller.ts:224`; `submission.service.ts:267`, contrasted with the centralized `visibility()` predicate at line 12. Route: `GET /submission/user/:userId/problem/:problemId`.

For an ordinary caller looking at another user's submissions, the controller permits the request if the problem is public. The service then filters only by target user, problem, and cursor. It does not exclude contest submissions or apply the contest timing/scoreboard policy used by `canRead()` on individual submission endpoints.

**Offline proof:** caller 1 requested user 2's public-problem submissions. The actual service built `where: { userId: 2, problemId: 9, id: { lt: 1000 } }`. There was no contest/visibility predicate; the fixture returned a private submission from contest 7. The actual controller returned 200.

**Impact:** when a public problem is also used in an ongoing restricted-scoreboard contest, another user's contest submission metadata/results are exposed through this list. This is conditional on such a public-problem/contest association; it does not bypass the hidden-problem gate. The selected projection excludes source code. Frontend response-schema stripping is not a server-side authorization fix.

**Recommended correction:** apply the existing viewer-aware visibility predicate to list queries too, or explicitly exclude contest rows for other users unless contest result policy permits them. Test list and detail routes against the same dummy submission and viewer matrix.

### A07 — A worker can hang before its per-job watchdog exists

**Locations:** `D:\otog-grader\src\mainWorkers.py:67`, `:82`, `:89`; `src\postgresql\dbInit.py:10`; `src\worker_queue.py:93`.

Database connection, startup locking/registration/recovery, and each queue claim occur outside the job watchdog. The main database constructor does not itself supply connection/statement/lock deadlines. The separately implemented heartbeat and queue-listener connections have explicit timeouts, but they do not supervise the main claim thread.

A main-connection network wait or database lock can therefore leave the worker alive indefinitely or for transport-defined timeouts before a job watchdog is armed. A separate heartbeat can remain healthy for some classes of main-thread blockage. Server/role-level PostgreSQL timeouts might mitigate particular waits, but their current configuration could not be checked. This is a **source-confirmed reliability gap**, not a reproduced submission-triggered database hang.

**Recommended correction:** bound the main connection and claim/startup operations, including network failure behavior, and supervise main-loop progress independently of whether a job has been claimed. Distinguish expected low-memory/pause waits from unhealthy loss of progress. Avoid restarting every legitimately paused worker. Test with a disposable database and a deliberately stalled/locked main connection while the heartbeat remains responsive.

## Existing protections checked and remaining boundaries

| Area | Current evidence | Remaining boundary |
| --- | --- | --- |
| Directory depth / poisoned cleanup | Native iterative traversal patch, bounded Python cleanup fallback, 4,096-inode recorded mount; current source matches retained manifests | Fresh hostile-tree/native execution was unavailable today; quotas do not count each hard-link name separately |
| Compilation | Isolate required; private `/usr/src` mask, clean environment, CPU/wall/memory/process/file limits; unsafe fallback disabled | Compiler/kernel/Isolate correctness remains part of the security boundary |
| Runtime/output | Per-testcase reset, private temporary paths, wall/file limits; output copied only from regular files using no-follow/nonblocking opens | Final-job retention is A01; runtime quotas alone do not reclaim finished scratch files |
| Standard answer checker | Bounded chunk comparison; **37 fresh offline long-line/Unicode/invalid-text fixtures passed** | No fresh full Linux judging suite today |
| Custom checkers | 60-second execution deadline, 512 MiB per-process virtual-address limit, bounded captured diagnostics/file sizes | Checkers still run as trusted host-side worker code, outside contestant Isolate; no checker-only aggregate child-process memory boundary; checker compilation does not request that 512 MiB limit |
| Unexpected failure / retry | Stage watchdogs; exception recovery; durable counter allows two interrupted executions before quarantine | Watchdog requires Python/OS scheduling; a frozen kernel/host or uninterruptible task is outside its guarantee; claim/startup gap is A07 |
| VM memory | 1.5 GiB free-memory admission guard and recorded container limits | Admission samples availability without reserving future allocations. Six simulated checks at 1,800 MiB all admitted. This is not a new OOM reproduction; simultaneous compilations/runtime/checkers may still pressure a small VM |
| API identity / sessions | Signed JWT strategy, current identity/session lookup, atomic conditional refresh consumption, bounded scrypt derivations, logout/session revocation visible in current source | Today's production behavior was not retested; alias/body-order throttle gaps remain |
| Hidden resources / archives | Current authorization checks, streamed staged ZIP path/size checks, and upload limits remain present | Contest result policy is inconsistent across derived/list routes; see A05/A06 |
| Worker restart authority | Admin guard plus fixed worker identities and restricted broker operations in reviewed source | Restart is recovery, not prevention; current broker/container state was not inspected |

Additional hardening observations, **not established exploits or newly reproduced worker failures**:

- Chat's bracket-link formatter passes user text directly as `href` (`apps/web/src/components/chat.tsx:441`), unlike the announcement renderer's scheme allowlist. The shared link component does not validate schemes. Apply the same URL policy. Script execution was not browser-tested, so this review does not label it confirmed XSS.
- Archive extraction budgets are checked per upload against a disk-space snapshot. Concurrent uploads for different problems do not reserve a shared expanded-byte budget. Administrators are required; no concurrent disk-exhaustion test was run. Cleanup exceptions can also prevent `activeArchives.delete()` because it occurs after awaited removal in `finally`; protect the in-memory release with a nested `finally`.
- The legacy HTTP-sync worker uses network requests without explicit timeouts and an unbounded result-post retry loop (`src/httpSync/httpQuery.py`). The reviewed recorded six-worker deployment uses `mainWorkers.py`, so this is a latent issue if legacy modes are re-enabled, not evidence that current workers use that path.
- Error-reporting HTTP requests likewise lack individual timeouts if Discord error reporting is enabled. The active worker's stage watchdog can bound ordinary blocking while it remains schedulable; legacy entrypoints lack the same protection. No messages were sent or external integration enabled.

## Evidence and reproduction

All new evidence is under [`docs/security-audit-20261021`](../../security-audit-20261021):

- `offline-api-checks.cjs` and `offline-api-results.json`: four alias checks, middleware order, actual prize/list code paths with dummy state, and resolved package versions. All eight recorded checks passed.
- `offline-worker-checks.py` and `offline-worker-results.json`: actual worker-loop/low-memory-claim ordering with inert data, reservation observation, 37 standard-checker fixtures, deployment-manifest comparison, and cleanup/watchdog source assertions. All recorded checks passed.
- `source-inventory.json`: paths and SHA-256 hashes of the scoped first-party source inventory. Contains no environment-file contents or credentials.

Run from `D:\otog`:

```powershell
node docs/security-audit-20261021/offline-api-checks.cjs
python docs/security-audit-20261021/offline-worker-checks.py
```

The dependency-drift assertions intentionally describe this audit snapshot and will need adjustment after dependency synchronization. The Python script uses the neighboring grader checkout and retained 17 October manifests, with `OTOG_AUDIT_GRADER` available to select another local grader root. These are offline audit fixtures, not a substitute for isolated Linux sandbox/end-to-end verification.

Previously retained deployment/evidence files were read as historical evidence, including `CHECKER-MEMORY-HARDENING-20261017.md`, `DIRECTORY-DEPTH-FIX-20261017.md`, `INODE-CAP-4096-20261017.md`, and their manifests. Earlier successful sandbox/production tests are not presented as newly executed tests.

## Suggested order of work

1. Validate A01 in a disposable Linux worker, then introduce bounded finished-job/idle reclamation and verify ordinary follow-up grading.
2. Synchronize the local installed dependency tree with the reviewed release lockfile and verify the actual resolved versions before local exposure or a build.
3. Fix both authentication-throttle placement/matching issues, keeping password-hash concurrency bounds.
4. Centralize contest-result authorization and apply it to prizes and every submission-list route.
5. Bound startup/main-claim waits and add main-loop health reporting; separately plan aggregate VM memory admission and checker isolation.

No fixes or deployment were performed as part of this assessment.
