# 100-user mixed contest retest — 26 October 2026

Tested the currently deployed website, API, PostgreSQL and six graders, including the shared password queue with two active operations and ten waiting slots. No application or grader settings were changed for these tests.

Two complete runs used 100 ordinary accounts each, with at most 100 temporary accounts present at once. Accounts logged in through real NextAuth/password verification, then spent three minutes navigating contest/problem pages, reading their own submission history and scores, revisiting finished submissions, uploading ordinary C++ solutions and polling pending results. Each account attempted two submissions, staggered at 15–65 and 85–140 seconds after mixed activity began. Navigation pauses varied from three to eight seconds. Pending jobs were drained afterward.

These are accelerated HTTP user journeys, not 100 browser renderers. JavaScript execution, static asset downloads, chat/WebSocket traffic and statement reading were not simulated. Contest 2's six missing PDFs still return 404. Restricted scoreboard responses during the active contest are expected 403 responses. These known responses are retained and distinguished from unexpected errors. Existing graded reference code was reused; p2's reference intentionally scores 60, while the other references score 100.

## Direct-VM repeat

The main workload reached the actual VM through a local SSH port forward to the same production nginx, avoiding the public TLS path. The timings below exclude Internet/TLS costs.

**All 100 users logged in, all 200 uploads succeeded, and all 200 jobs finished.** The normal journeys made 19,229 requests, including 18,929 during mixed browsing/submission activity. There were zero unexpected responses, HTTP 500 responses, transport errors or read retries in these journeys. The six PDF checks and separate stress bursts are outside that count.

| Activity | Requests | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Problem-page navigation during mixed activity | 1,568 | 141 ms | 336 ms | 472 ms |
| Contest-page navigation | 741 | 113 ms | 264 ms | 400 ms |
| Contest-detail API | 2,309 | 82 ms | 362 ms | 496 ms |
| Own submission history for a problem | 1,568 | 70 ms | 336 ms | 527 ms |
| Own scores | 1,466 | 76 ms | 340 ms | 488 ms |
| Submission upload acceptance | 200 | 183 ms | 511 ms | 593 ms |
| Pending-result polling | 9,625 | 90 ms | 386 ms | 523 ms |
| Revisiting a submission page | 327 | 174 ms | 398 ms | 585 ms |
| All mixed requests, including drain polling | 18,929 | 95 ms | 373 ms | 522 ms |

Submission completion includes queueing, compilation and judging. Server creation-to-completion was p50 **57.21 s**, p95 **89.53 s**, p99 **93.54 s**, maximum **93.66 s**. Client-observed completion was p50 57.82 s, p95 89.77 s, p99 94.52 s and maximum 94.71 s. The sampled waiting queue peaked at **87 jobs**, and all six graders were active concurrently. Upload acceptance time is separate from final-verdict time.

The 200 results comprised **166 full accepts and 34 expected p2 partial results**. All results matched the reference scores: 1,864 accepted testcases and 136 expected rejected testcases. There were no extra time-limit, compile-error or crash verdicts. Grader logs contained no watchdog recovery, retirement or low-memory admission messages, and container identities/restart counts were unchanged.

Available VM memory stayed above **1,455 MiB**, and the API connection pool never exceeded **16** connections. The independent low-memory/heartbeat guard was not triggered.

## Separate simultaneous bursts

These follow mixed activity and are intentionally harsher than paced browsing.

| Burst | Result | p95 | p99 |
|---|---|---:|---:|
| 100 simultaneous problem-page opens | 100 HTTP 200 | 3.381 s | 3.496 s |
| 100 simultaneous scoreboard reads after temporary contest end | 100 HTTP 200 | 533 ms | 551 ms |
| 100 simultaneous password logins | 12 HTTP 200; 88 HTTP 503 busy | 2.011 s | 2.720 s |

The login burst's percentiles above include both accepted and rejected requests. Accepted logins had p99 2.871 s; busy responses had p99 625 ms. No login-burst HTTP 500 responses occurred. The 88 busy responses are deliberate admission refusals caused by the requested smaller queue; they remain recorded as unsuccessful login attempts, rather than being counted as completed logins. All 100 staggered logins succeeded earlier.

## Public HTTPS run and limitations

The first run sent the same journeys through the public ngrok URL. All 100 staggered logins succeeded, but mixed public activity was not clean. Of 200 submission attempts, **118 were accepted and graded, 76 failed with client/transport errors, and six received HTTP 429**. All 118 accepted jobs finished and matched their reference scores.

Across 12,272 mixed public request attempts, the generator recorded 5,395 HTTP 200 responses, 261 expected HTTP 403 responses, **298 HTTP 429 responses**, and **6,318 client/transport errors**: 2,379 `SSLEOFError` and 3,939 `FileNotFoundError`. These failed attempts are retained in the raw evidence. Public latency percentiles are not presented as successful site performance because many attempts failed before producing an HTTP response.

During that public test interval, nginx logged HTTP 200/403/404 responses and the separate local login burst's expected 503 responses, **but no HTTP 429 responses**. Its configuration has no `limit_req` or `limit_conn` directives. This places the observed public 429 responses upstream of the VM nginx. The tests do not identify the exact origin of the upstream throttling or client TLS/filesystem errors, nor establish that real browsers would exhibit the same failures. Subsequent fresh-connection probes succeeded. Public browser reliability therefore remains unverified by this run; the clean direct-VM results alone do not establish that the whole public path is failure-free.

Follow-up diagnosis: the 82 failed upload attempts split into **73 `SSLEOFError`, six HTTP 429 responses and three `FileNotFoundError`**. The last category is a client-side failure and cannot establish a website fault. The ngrok service remained active, and its journal showed no relevant error/reconnection event during the test. Current agent counters recorded 264 connections and 5,987 HTTP requests at the follow-up check.

Connection-rate limiting is a plausible explanation for the upstream 429 responses: ngrok's current [Free Plan Limits](https://ngrok.com/docs/pricing-limits/free-plan-limits) lists 100 new TCP connections/minute, separately from 4,000 HTTP requests/minute. Its [error 702 documentation](https://ngrok.com/docs/errors/err_ngrok_702) explains that inbound connection-rate violations produce HTTP 429 responses. The generator opened 100 user connections over roughly 40 seconds and deliberately reopened connections after ten seconds of idle time; this could exceed a connection-rate budget despite moderate request throughput. The account's actual plan and a historical ngrok response error code have not been verified, so this remains an inference rather than a confirmed explanation for every failed attempt. The password queue limit applies only to login/registration hashing and does not admit submission uploads.

## Restoration and evidence

Both recovery checks passed. Contest 2's exact original schedule is restored to **15 October 2027, 09:00–13:00 Asia/Bangkok**. Temporary accounts, submissions, results, scores, contest memberships and sessions were removed. Fingerprints of 13 stable application tables match the originals after each run. Final counts remain **33 users, 621 submissions and 621 results**, with zero contest-2 participants and scores. Normal sequence advancement was retained.

Temporary credentials and copied fixture source were removed. Test connections/monitors were stopped. Six grader identities and restart counts match preflight, all public health checks passed, and the final VM had 2,481 MiB available memory.

Evidence: `tmp/contest-mixed-20261026/` for the public run and `tmp/contest-mixed-direct-20261026/` for the direct repeat. Each includes original request records, summaries, grading/resource samples and restoration checks. Earlier benchmark results used a different workload and queue size; their latency differences cannot be attributed solely to the queue change.
