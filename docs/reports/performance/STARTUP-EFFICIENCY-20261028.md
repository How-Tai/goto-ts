# Frontend startup and background scheduling — 28 October 2026

Deployed build: `Q9DbOD4T5okft8XCOe0Os`, at `/opt/otog/startup-efficiency-20261028/workspace/apps/web/.next/standalone/apps/web`. Immediate rollback: `/opt/otog/announcement-editor-fix-20261027/workspace`.

## Changes

The contest problem page loads its editor form and submission-history dependencies only when opened. Monaco was already deferred. The global search launcher and keyboard shortcut remain available immediately; the combobox and matching dependencies load on opening search, and the new input receives focus.

For a direct contest problem visit, a valid access-token cookie with more than 30 seconds remaining can start the existing authorized page GET alongside session resolution. The result is owned by the mounted application provider, so it survives the existing account-subtree remount when the session resolves. The page consumes that same request only after authentication, when the route, session token and current cookie match. It checks the cookie again after awaiting the response. Nothing from the early response is displayed before session resolution. Route changes, logout and unmount cancel it. Near-expiry credentials keep the existing session/refresh sequence; an early 401 delegates to the existing normal authentication path. This changes startup sequencing, not password verification or server permission checks.

Shared metadata deduplication was already implemented in the API and is retained. The existing service regression confirms that 100 simultaneous page requests load contest metadata once and problem metadata once, while making 100 fresh access-gate reads and 100 separate personal-submission reads. Frontend request reuse avoids adding a duplicate page request to obtain that overlap. No API code or database schema changed.

Background visibility refetches are coalesced and delayed by 100–749 ms. Submission reconnect/visibility watch synchronization is spread by 50–749 ms. Fallback snapshot deadlines, retry waits and polling ticks receive bounded positive jitter. Hidden tabs still skip fallback requests, live progress still avoids polling, and foreground page requests are immediate. Resource-dashboard interval settings remain unchanged.

## Bundle measurement

Compared the unique initial JavaScript resources in the current and preceding production build manifests, using the same gzip measurement for both:

| Initial JavaScript | Before | After |
| --- | ---: | ---: |
| Uncompressed bytes | 1,966,047 | 1,672,030 |
| Gzip bytes | 568,870 | 474,324 |

Compressed initial JavaScript decreased **16.62%**, or about 92.3 KiB. JavaScript plus CSS gzip totals decreased from 583,531 to 488,985 bytes. These are build-manifest resource sizes, excluding fonts and deferred feature chunks; they are not a measured browser-rendering improvement.

## HTTP request-path comparison

Same VM, normal production website/API/database and unchanged six graders. Each version used 100 distinct temporary ordinary users, a 40-second login ramp and 20 rounds of 100 simultaneous complete request paths: generic problem HTML, session resolution and the authorized page API. The before driver performs session/data requests consecutively; the after driver overlaps them, matching the sequence verified in the actual page/provider React test. Responses are fully read. There are no source uploads or grading jobs in this targeted comparison.

| Complete HTTP path | Before | After | Observed reduction |
| --- | ---: | ---: | ---: |
| p50 | 708.05 ms | 698.02 ms | 1.42% |
| p95 | 1,176.68 ms | 1,141.57 ms | 2.98% |
| p99 | 1,555.32 ms | 1,250.28 ms | 19.61% |

All **2,000 journeys per version completed with zero failures**. There are three GETs per journey. The median and p95 differences are small and may include ordinary run-to-run variance. This is a short sequential comparison with a changed request sequence, not a randomized A/B test. It excludes JavaScript download/execution, hydration, rendering, PDF display, public internet/ngrok overhead and simultaneous grading load. It therefore does not establish a new browser-readiness p99, or quantify the separate benefits of deferred JavaScript and background jitter.

The attempted browser measurements were incomplete and are not used as performance results. Chrome iframe tests did not complete, and the browser tool subsequently stopped because it could not establish the current URL reliably. Browser automation was not resumed after that stop. Earlier browser-readiness measurements from 27 October are historical and do not measure this build.

## Validation

- Separate production typecheck and optimized build passed. Temporary build flags left by an interrupted candidate build were detected and removed from the saved source configuration; dependencies, lockfile and original Next configuration match the previous release. The final build used the same effective temporary build settings as the established build helper, and its separate typecheck was enforced.
- Real React 18.3.1 and TanStack Query render the actual page and startup provider: no problem appears before authentication; one request survives session resolution; account/token changes discard prior results; route changes abort and hide the preceding problem; near-expiry credentials and early 401s use the existing path; forbidden contents remain hidden; logout cancels and redirects. The renderer is isolated test tooling and was not added to production dependencies.
- 100-viewer request-reuse/isolation tests, jitter/visibility cleanup tests, existing submission tracking/upload-idempotency checks, lazy SSR auth-isolation checks, the announcement placeholder regression and existing session/refresh regressions passed.
- The session smoke test initially encountered the expected `/contest` redirect while the load fixture temporarily made one contest current. It passed after restoring the original schedule; no product code was changed to accommodate that fixture state.
- Generic problem HTML is identical for anonymous and invalid-cookie requests, has empty page props and writes no session cookie. Anonymous protected page API access returns 401. Static HTML size is 9,776 bytes.
- Public HTTPS login/ping and local login/problems/contests/ping passed. API bundle remains `fca784afd76c2a2697d3dae797aac89e8337b6c1481351ea061d7715d3d0f921`, with one database notification listener. All grader identities, mounts and restart counts are unchanged.

## Restoration and evidence

Every fixture restored original table fingerprints and the contest schedule. Final verified state: **33 users, 622 submissions/results, maximum submission ID 769, next submission ID 770**, no queued grading, no contest-2 test participants/scores. Contest 2 remains **15 October 2027, 09:00–13:00 Bangkok**. Temporary account credentials and copied fixture source bodies were removed. The live idempotency row belongs to a real submission and is preserved.

All 12 changed production source files match the maintenance checkout. Evidence: `tmp/startup-efficiency-20261028/evidence/`; HTTP comparisons: `tmp/startup-http-before-20261028/summary.json` and `tmp/startup-http-after-20261028/summary.json`, with recovery/final evidence in their corresponding `evidence/` folders. Incomplete browser runs remain diagnostic evidence only under `tmp/startup-burst-before*`.

After successful deployment/retesting, the superseded `problem-shell-20261027/workspace` copy was retired following process/service/container and retained-symlink checks. The preceding announcement-editor release remains the immediate rollback. This reclaimed about 2.07 GiB, keeping roughly 29.93 GiB available. Live file hashes, service PIDs and all container state were unchanged during cleanup. Receipt: `tmp/disk-cleanup-startup-20261028/evidence/`.
