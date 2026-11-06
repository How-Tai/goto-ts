# Mixed contest/practice traffic and per-user fairness — 30 October 2026

Completed two matched runs on the existing production VM, nginx, website, API, PostgreSQL and graders. The user had selected **five active graders** before preflight, so that selection and its CPU allocation were preserved throughout. Configured per-user limits of seven (effectively five with this allocation) and three were compared. Custom checker sources, compile commands and compilation behavior were unchanged; no checker cache was added.

Each run used 100 temporary ordinary accounts, a 40-second real NextAuth login ramp, 500 complete problem-page HTTP journeys over a two-minute browsing schedule, own scores/submission lists and staggered result polling. Users browsed all six problems in contest 2. Accepted submissions comprised 100 contest solutions across problems 67/69/70/71/72 and 109 practice solutions for public problem 14. One account attempted an initial burst of 11 practice uploads: ten were accepted and one was deliberately throttled. The other 99 users each submitted one practice solution, and all 100 submitted a contest solution. Both passes used identical reference-source hashes.

Traffic passed through nginx via an SSH port forward from Windows outside the VM. Page timing includes HTML followed by parallel session and problem-data requests. It excludes ngrok/internet latency, browser rendering, static assets and PDFs. Poll counts differ slightly because polling is staggered and stops when each result is observed. This is one sequential pass per cap, not randomized repeated trials; small timing differences do not establish a general speed benefit or regression.

| Metric | Per-user cap 7 (effective 5) | Per-user cap 3 |
| --- | ---: | ---: |
| Page journey p50, ms | 227.70 | 223.71 |
| Page journey p95, ms | 429.36 | 421.52 |
| Page journey p99, ms | 519.62 | 525.38 |
| Login p95 / p99, ms | 341.29 / 355.63 | 346.41 / 385.00 |
| Contest upload p95 / p99, ms | 63.75 / 76.08 | 86.80 / 131.45 |
| Practice upload p95 / p99, ms | 469.02 / 575.41 | 991.01 / 1142.35 |
| Contest queue-to-verdict p50, s | 46.392 | 46.478 |
| Contest queue-to-verdict p95, s | 83.526 | 83.111 |
| Contest queue-to-verdict p99, s | 87.889 | 87.691 |
| Practice queue-to-verdict p95, s | 112.198 | 113.091 |
| Practice queue-to-verdict p99, s | 112.451 | 113.477 |
| Practice queue wait p99, s | 111.330 | 112.333 |
| Burst account peak occupied graders | 5 | 3 |
| Burst account last initial practice result, s | 2.495 | 5.733 |
| Accepted / total submissions | 209 / 209 | 209 / 209 |
| Complete / failed page journeys | 500 / 0 | 500 / 0 |
| HTTP attempts | 7,670 | 7,818 |
| Unexpected HTTP responses | 0 | 0 |
| Deliberate HTTP 429 responses | 1 | 1 |
| Failed uploads / verdict mismatches | 0 / 0 | 0 / 0 |
| Watchdog/recovery events | 0 | 0 |
| Minimum sampled available RAM, MiB | 3,439.2 | 3,434.2 |

Across measured runs: **418 accepted submissions, 1,000 completed page journeys, 15,488 HTTP attempts, zero unexpected HTTP responses and two intentional 429 responses**. Every accepted submission had only accepted testcase results. Each 429 returned `Retry-After` and the expected Thai message `กรุณารอสักครู่แล้วลองใหม่`; unrelated users continued normally.

Claim records cover all 418 submissions. In each run all 100 contest submissions were claimed while practice work was waiting. A reconstruction of claim/queue/completion times found no eligible higher-priority contest work bypassed by practice claims, allowing a 200 ms margin for transaction/log timing and accounting for per-user occupancy. This complements the isolated scheduler transaction tests; it is an observation of these runs, not proof for all possible concurrent schedules. All practice jobs eventually completed. Continuous contest traffic can still delay practice work; no aging or reserved practice slot was added.

The cap of three bounds how many graders one account occupies. It was adopted for that fairness property. Aggregate contest result timing was nearly unchanged in these runs, while upload tails varied and the burst account took longer to finish its own batch. This test does not establish an overall latency improvement from lowering the cap.

An initial attempt incorrectly targeted private contest problems with practice uploads. The API rejected those uploads. That attempt was stopped, its temporary records removed, its schedule/settings/counter restored, and its evidence archived as `cancelled-private-practice-attempt`. It is excluded from the measured comparison. The corrected workload uses an existing accepted solution to public problem 14 without changing problem visibility.

Final state: **five active graders, per-user limit three**, original individual pause flags retained. Contest 2 restored to **15 October 2027, 09:00–13:00 Bangkok**. Original table fingerprints matched after each measured cleanup. Production returned to **33 users and 632 submissions/results**, no pending work, and next submission ID **780**. No existing submission IDs or code were changed. Temporary accounts, copied reference source/password files and recovery timers were removed or sanitized. Web/API processes and grader container identities/restart counts were unchanged; public HTTPS login and backend ping returned 200. Custom checker source/command hashes matched the preflight snapshot.

Scripts and local evidence: `tmp/contest-fairness-20261030/`, including `comparison.json`, raw request rows, resource/claim samples and recovery reports. VM evidence: `/opt/otog/contest-fairness-20261030/`. No application or grader source changes were required for this task; only the existing per-user setting was changed through the authenticated admin API.
