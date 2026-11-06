# Static contest problem layout — 27 October 2026

Live frontend build: `mNqO6nwvQqeOKq8G8vJPn`. Supersedes the rendering pass documented in `PAGE-RENDER-EFFICIENCY-20261027.md`.

The contest problem route now serves one prepared HTML layout. After hydration, it resolves the session and fetches the existing authenticated combined page API. No API, database schema, grader, CPU assignment, watchdog or memory setting changed.

The static HTML contains empty page props and no access tokens, submitted code, contest contents, or user identity. Invalid-cookie and anonymous requests receive identical generic HTML without session-cookie writes. The protected data API still returns 401 to anonymous requests and retains `private, no-store`. Private browser queries include viewer identity and are removed when their final observer unmounts. Navigation can retain the same viewer's contest frame but hides the previous problem/editor while new contents load.

## Matched burst measurement

Each round started 10 actual browser documents and 90 other authenticated complete page journeys. Ten rounds produced 100 browser visits and 900 background journeys per version. Browser pages used one synthetic viewer; the background journeys used 90 other synthetic viewers. This is a single-machine browser test, not 100 independent client devices. The first round includes asset loading; later rounds have warm assets. The same VM, route, test code, and service configuration were used before/after, except suppression of expected local socket-write errors when completed browser frames were removed.

| Measurement | Before p50 / p95 / p99 (ms) | After p50 / p95 / p99 (ms) |
| --- | ---: | ---: |
| Complete request path | 836.24 / 1601.35 / 2066.27 | 698.54 / 1180.71 / 1345.26 |
| Browser interface ready | 3603.00 / 5837.00 / 5841.70 | 2849.20 / 3664.70 / 3745.60 |

The new complete request path includes HTML, session resolution and authorized problem data. Browser readiness waits for the hydrated route, problem embed element, and two animation frames. Browser CPU/rendering is included. PDFs for contest 2 are absent, so PDF availability/display is not measured. Public ngrok latency/quotas are excluded. All 100 browser visits and all 900 background journeys completed for both versions. These measurements show about 35% better p99; they do not meet an under-one-second p99 target.

Evidence: `tmp/shell-burst-before-20261027/browser-results.json`, `tmp/shell-burst-after-20261027/browser-results.json`. The browser result screenshot is `tmp/shell-burst-after-20261027/browser-results.png`. Connection-aborted messages in the local harness occurred during deliberate iframe teardown; all recorded readiness checks and complete background journeys succeeded. They are not a claim of zero cancelled resource requests.

## Mixed browsing and submissions

100 distinct synthetic users, 200 ordinary C++ uploads, the original 180-second browsing workload, and a grading drain. The driver now records complete page journeys separately from individual HTTP requests, so quick generic HTML alone is not reported as a complete page load.

| Measurement | Previous retained build p95 / p99 (ms) | New build p95 / p99 (ms) |
| --- | ---: | ---: |
| Problem request path | 175.84 / 240.37 | 117.22 / 187.02 |
| Contest page | 150.83 / 223.00 | 108.28 / 145.21 |
| Submission upload | 153.44 / 191.59 | 164.15 / 203.04 |
| Own score | 59.64 / 88.41 | 51.17 / 76.55 |
| Submission page | 184.74 / 243.46 | 160.66 / 196.51 |
| 100 problem opens after grading | 2243.06 / 2490.68 | 1432.96 / 1471.71 |

Single before/after runs include scheduling variance. Upload tail latency was slightly higher in this run; not every metric improved. The new problem path includes extra session/data requests rather than counting only HTML.

13,360 normal HTTP requests and 1,646 complete problem journeys had zero unexpected failures. All 200 uploads succeeded; all 200 submissions finished at their reference scores (166 accepted, 34 expected partial). No new time-limit verdicts, watchdog recovery, worker restarts, or memory guard events. Minimum available VM RAM: 1807.5 MiB; maximum API DB connections: 17. Grading queue-to-result p99: 83.86 seconds. The separate deliberate 100-login overload test returned 12 successes and 88 expected busy responses under the existing queue limit. Six statement checks returned the known missing-PDF 404s.

Evidence: `tmp/contest-shell-20261027/summary.json`. Aggregate journey rows are excluded from actual HTTP request counts.

## Verification and restoration

Production build/typecheck passed with the VM's matching installed dependencies. Local dependencies are stale and were not used as production validation. Session/refresh regressions, request-efficiency tests, lazy-client auth isolation, and real QueryClient tests with 100 concurrent viewer identities passed.

Observed browser checks passed: direct entry, client problem navigation, editor draft preservation across tabs, 403/404 concealment, malformed route handling, exact Thai busy message, working retry after recovery, anonymous/401 login redirection, and valid sign-in recovery. The preview used only a fake API, generated secret, and synthetic user; it was stopped and its secret removed.

Every load fixture restored original schedule and data fingerprints: 33 users, 621 submissions/results, zero contest 2 participants/scores. Contest 2 remains 15 October 2027, 09:00–13:00 Bangkok. Test accounts, temporary credentials and copied solution bodies were removed. Live HTTPS login/ping return 200, the API bundle and grader identities/restart counts are unchanged, one notification listener remains, and all temporary preview/extra-renderer services are inactive.

Evidence: `tmp/problem-shell-20261027/evidence/`, including `static-shell.json`, `shell-browser-tests.json`, `public-shell-check.json`, `operational-check.json`, and `final.json`.

## Submission numbering correction

The original cleanup restored rows but omitted the submission sequence, leaving gaps from deleted load-test submissions. A subsequent real submission was assigned 2443 after the prior real maximum of 768. On 27 October, submission 2443 was moved transactionally to 769, all foreign references were preserved, and the sequence was restarted at 770. Exact code, timestamps, verdict and result were verified against a private before snapshot. The database now contains 622 real submissions. Earlier statements about restored data fingerprints did not include sequence state.

The shared fixture now snapshots the submission counter before mutation and restores it only after the original submission fingerprint is verified under a table lock. It preserves the counter if real submissions were added concurrently. Real PostgreSQL temporary-table tests verified successful restoration and refusal to rewind past a concurrent real insertion; they did not consume a production ID. Evidence remains on the VM under `/opt/otog/submission-numbering-20261027/`; the backup containing source code is private and was not downloaded.
