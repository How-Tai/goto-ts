# Web capacity fixes — 26 October 2026

Deployed website/API fixes to `/opt/otog/web-capacity-20261026/workspace` and repeated the authorized 100-account test on the actual VM. The six grader containers, images, mounted files, resource settings and restart counts are unchanged.

## Changes

- Removed AuthModule's extra PrismaService provider. Authentication and the rest of the API now share the global database client. Its connection pool defaults explicitly to **16**, below the existing role allowance of 32. An explicitly configured pool limit is retained.
- Combined live user identity and refresh-session validation into one parameterized database query. Current role, revocation, expiration and deleted-account checks remain fresh on every authenticated request; authorization is not cached.
- Added a bounded password-work queue: two active checks, up to 128 waiting, and a 30-second admission deadline. Hashing parameters are unchanged. Queue overflow/expiry produces a retryable HTTP 503 response rather than an unclassified HTTP 500. All 100 valid logins fit the tested queue.
- Shared scoreboard calculations for one second, with concurrent-read deduplication and a maximum of 64 contest cache entries. The controller still checks current permissions and contest visibility before using a result. Scores may lag by one second.
- Reduced contest-problem membership/visibility checking to one query and removed unused problem data from personal-score reads.
- Contest navigation reuses initial contest/time data for one second instead of immediately fetching it again.
- Contest and submission pages reserve not-found responses for actual missing contests; upstream failures are no longer misreported as HTTP 404.

## Validation

API/frontend type checks, production build, focused queue/cache tests, and full API/password/session/permissions/schema regressions passed. Legacy password compatibility, logout/revocation, deleted users, scoreboard policy and invalid-session login redirects remain covered. Build headroom stayed above **1,430 MiB**. Dependency scans reported zero known CVEs in API, web and build dependencies against the retained vulnerability database; no dependencies were upgraded.

The isolated HTTP regression fixture used a temporary database login granted permissions only in its disposable test database, avoiding the live API role's previously exhausted allowance. Both the fixture database and role were removed. Current regression fixtures and VM maintenance sources were synchronized with backups.

## Actual 100-user retest

The full retest used the same paced browsing and burst actions as the earlier test, with 100 ordinary accounts. It attempted 100 simultaneous submissions and processed all 100 through the existing six graders. Password logins were staggered over 40 seconds initially, followed by a separate 100-request simultaneous password-login burst. Only that final login burst's generator timeout was increased from 20 to 45 seconds so it could measure completed queued logins. The server's admission deadline is 30 seconds. Other request deadlines and pacing were retained.

| Action | Previous failures | Verified post-fix result |
|---|---:|---:|
| Paced browsing | 92 / 3,081 | 0 / 3,475 |
| Simultaneous local problem pages | 9 / 100 | 0 / 100 |
| Simultaneous uploads | 73 / 100 | **0 / 100; all 100 graded** |
| Public HTTPS problem pages | 4 / 100 | 0 / 100 |
| Scoreboard reads with fresh connections | 19 / 100 | 0 / 100 |
| Simultaneous password logins | 66 / 100 | **0 / 100** |

The full retest recorded **12,263 request attempts, with zero HTTP 500 responses** and no server error log entries during the test. It also recorded **47 RemoteDisconnected transport errors** in the scoreboard stage: some clients reused local connections that had expired while the much longer 100-job grading batch finished. These original records are preserved. They are not counted as successful requests or removed from the raw results.

A separate verification created 100 temporary participants and 100 synthetic score rows, logged all accounts in normally, then made 100 simultaneous scoreboard reads over fresh connections. **All 100 returned HTTP 200 and contained all 100 participants.** This check used more score rows than the old test's 27 successfully submitted jobs. The future load generator now opens fresh connections for local bursts, matching normal client reconnection behavior after idle keepalives expire. Mutation requests are never automatically replayed.

The six missing statement PDFs still returned the expected 404. Restricted scoreboard reads during the active contest returned the expected 403; neither is an application failure.

## Latency comparison

All figures are p95 / p99, in milliseconds, including full response reads and any unsuccessful responses in the original sample.

| Action | Before | After |
|---|---:|---:|
| Contest-detail API during browsing | 1,720 / 1,928 | **652 / 905** |
| Personal-score API during browsing | 1,760 / 1,978 | **782 / 1,065** |
| Mixed paced browsing | 3,088 / 4,067 | **3,219 / 3,617** |
| Simultaneous local problem-page opens | 3,412 / 3,515 | **2,901 / 3,029** |
| Public HTTPS problem-page burst | 5,243 / 5,678 | **3,582 / 4,038** |
| Scoreboard burst, fresh-connection verification | 1,259 / 1,267 | **741 / 764** |
| Simultaneous uploads | 2,222 / 2,356 | **3,850 / 4,261** |
| Simultaneous password logins | 5,778 / 6,517 | **25,528 / 26,373** |

The improvements are uneven. Mixed-browsing median fell from 1,197 to 468 ms, but its p95 did not improve; full page rendering still has multi-second tails at 100 active users. All 100 uploads now perform real acceptance work, whereas the previous burst rejected 73. Likewise, all 100 password requests now run secure verification; the earlier burst processed 34 and rejected 66. Queueing prevents those failures but cannot make two CPU-bound password checks process 100 users immediately. The final login completed in 26.66 seconds. These are finite short-run measurements, not a guarantee for arbitrary load.

No grader timing or verdict policy was changed. All successfully uploaded jobs finished; testcase timing differences remain subject to the existing 200 ms problem limits, as requested.

## Recovery and final state

API connections stayed at or below **16** throughout the full retest. Available RAM was sampled throughout; the independent low-memory/heartbeat guard did not abort. Public login, problems, contests and API ping passed after testing.

Contest 2 is restored exactly to **15 October 2027, 09:00–13:00 Asia/Bangkok**. All temporary accounts, submissions, scores, registrations and refresh sessions were removed. Fingerprints of 13 stable tables match their pre-test contents: **33 users, 621 submissions, 621 results, zero contest-2 registrations and scores**. Temporary credentials/copied fixture source were cleared. Sequence counters were allowed to advance normally. Neither grader containers nor grader configuration were changed or restarted by deployment/testing.

The preceding working application release remains at `/opt/otog/performance-20261026/workspace`; deployment readiness checks include automatic rollback. Deployment overrides, hashes and maintenance backups are retained under `/opt/otog/web-capacity-20261026/`.

Local evidence: `tmp/web-capacity-20261026/`, `tmp/contest-load-fixed-20261026/`, and `tmp/contest-scoreboard-fixed-20261026/`. The earlier failing measurements remain under `tmp/contest-load-20261026/`.
