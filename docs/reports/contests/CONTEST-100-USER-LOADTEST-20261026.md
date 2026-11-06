# Contest 2: 100-user load test — 26 October 2026

The actual VM, deployed website/API, PostgreSQL instance and six production graders were tested. No alternative application or grader deployment was used. The workload exposed substantial errors at 100 active users.

Contest 2 was temporarily activated with the user's authorization. Its original schedule was restored exactly after each pass: **15 October 2027, 09:00–13:00 Asia/Bangkok**. Test accounts, submissions, results, contest registrations, scores and refresh sessions were removed. The original 33 users, 621 submissions and 621 results remain; contest 2 again has zero registrations and scores. Fingerprints of 13 stable application tables match their pre-test contents. All six grader container identities and restart counts are unchanged.

## Workload and boundaries

Two passes used 100 separate ordinary-user accounts each, with at most 100 test accounts active at once. Both used real password verification, NextAuth login/session cookies, per-user API tokens, multipart submissions and live grading. The generator ran on Windows outside the VM with persistent connections and gzip responses.

The first pass included a 40-second login ramp and roughly 45 seconds of browsing: each user attempted a five-request cycle every five seconds, visiting contest/problem pages and reading contest details, personal scores and the restricted scoreboard. A simultaneous 100-page burst followed, then 100 simultaneous submission attempts with one-second status polling and occasional score/submission-page reads.

The first pass exposed upload errors and the collector initially stopped the remaining phases after an unsuccessful upload. Its recovery completed successfully. A second, shorter pass retained unsuccessful-upload measurements and completed the grading, public HTTPS, scoreboard and simultaneous-login phases. No application, pool, role, password-cost, grading-limit or CPU-affinity changes were applied between passes.

All six contest problems have ten testcases and a 200 ms limit. Test code came from existing ordinary graded submissions. Five reference solutions had previously scored 100; p2's highest available reference scored 60, so its partial verdict was expected. All submitted fixtures were C++. Browser rendering, JavaScript execution and chat/WebSocket traffic were not simulated. The six missing statement PDFs returned the expected 404; PDF reads were excluded from browsing cycles. Scoreboard 403 responses during the contest were also expected and excluded from failure counts.

## HTTP results

| Activity | Requests | p50 | p95 | p99 | Unexpected responses |
|---|---:|---:|---:|---:|---:|
| Logins staggered over 40 seconds, first pass | 100 | 298 ms | 349 ms | 377 ms | 0 |
| 100-user browsing, first pass | 3,081 | 1,197 ms | 3,088 ms | 4,067 ms | 92 |
| 100 simultaneous local problem-page opens | 100 | 2,058 ms | 3,412 ms | 3,515 ms | 9 |
| 100 simultaneous submissions, second pass | 100 | 1,406 ms | 2,222 ms | 2,356 ms | 73 |
| 100 simultaneous public HTTPS problem-page opens | 100 | 3,827 ms | 5,243 ms | 5,678 ms | 4 |
| 100 simultaneous scoreboard reads after temporary contest end | 100 | 946 ms | 1,259 ms | 1,267 ms | 19 |
| 100 simultaneous API password logins | 100 | 495 ms | 5,778 ms | 6,517 ms | 66 |

Latency includes receiving the full response, including failed responses. Most tests used direct local port forwarding through localhost:3030; the explicitly marked public HTTPS burst used the actual ngrok address and includes connection/TLS/WAN costs. Each 100-request burst has a small tail sample; its p99 is descriptive, rather than a stable capacity guarantee.

There were **6,051 requests and 363 unexpected responses across both passes**, including polling and login setup. The first submission burst failed 71 of 100 uploads; the second failed 73. The second pass's 73 failed uploads did not enter grading; this is not a measurement of 100 completed submissions.

## Findings

1. **The API exhausts its database role's connection allowance.** Logs repeatedly report Prisma P2037 and `too many connections for role "otog_api_runtime"`. The role allows 32 connections, and all 32 were observed in use. PostgreSQL's overall limit is 100, so this is a per-role failure. The connection URL has no explicit `connection_limit` or `pool_timeout`. Source inspection also found a separate PrismaService provider in AuthModule alongside the global PrismaModule, which creates another client/pool. Sharing one client and explicitly budgeting its pool under the role allowance is the first corrective action to investigate and retest.
2. **Some backend failures appear as misleading page-not-found responses.** Browsing produced 77 HTTP 500 responses and 15 unexpected 404 responses. Contest SSR handlers return not-found when their upstream contest read is unsuccessful, including HTTP 500. Those 404s are not the missing statement PDFs.
3. **The password-verification queue is bounded, but overflow becomes HTTP 500.** Source permits two active verifications and 32 waiting. The final 100-login burst produced exactly 34 successes and 66 HTTP 500 responses; server logs contain 66 `Password verification is busy` errors. The expensive hashing safeguards should remain. Overflow needs a deliberate retryable response/backpressure policy instead of a generic server error.
4. **The test reproduced testcase timing variation.** Of the second pass's 27 accepted uploads, 25 used previously fully accepted reference code. Three of those received one TIME_LIMIT_EXCEEDED testcase each and scored 90. They were p1 once and p6 twice, with recorded maximum times of 213, 203 and 223 ms against the 200 ms limit. Four other p6 copies passed at 131–198 ms. This establishes observed variation within the batch; it does not isolate thermal, host scheduling, virtualization, input or other timing causes. No problem limits or verdict rules were changed.

## Grading and resources

All **27 successfully uploaded jobs in the second pass completed**: 22 full accepts, two expected partial p2 results, and three unexpected time-limited partial results. Server-side creation-to-final-update times, including queueing, compilation and judging, were p50 **19.01 s**, p95 **34.91 s**, p99/max **35.34 s**. Client polling observed completion at p95 **37.70 s** and p99 **38.56 s**. These timings apply only to the successful uploads.

Six graders were concurrently active. No grader container restarted, no watchdog recovery was observed, and no memory/time safety settings were changed. Minimum sampled available VM RAM was **1,316.9 MiB** in the first pass and **1,631.0 MiB** in the second; the test's 768 MiB abort threshold was not reached. During browsing, the monitored API/web/PostgreSQL/nginx/ngrok work averaged approximately **1.92 CPU cores**, close to the two CPUs assigned to supporting services. Thus database connection failures are confirmed, while CPU headroom is also limited under this workload.

## Final state and evidence

Both recovery checks passed. The exact contest schedule and original stable table contents are restored. All temporary accounts and their submissions/scores/sessions are gone. Copied fixture source text and temporary credentials were removed after verification. Normal database sequence counters were allowed to advance; they were not reset. Measurement files and normal server logs remain as evidence.

Final checks returned HTTP 200 for login, problems, contests and API ping; six graders remain connected. Approximately **2,533 MiB RAM** was available after cleanup. Supporting services remain on CPUs 6–7, and grader CPU/resource configuration is unchanged.

Local evidence: `tmp/contest-load-20261026/results-round1.json`, `results.json`, `summary.json`, `round1-evidence/`, and `evidence/`. VM evidence: `/opt/otog/contest-load-20261026/`. The report records observed failures; no permanent fixes were deployed as part of this load test.
