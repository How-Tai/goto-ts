# Web/API request efficiency — 26 October 2026

Implemented and deployed live submission updates, shared batched fallback, short metadata caching, one-read progress queries and retry-safe upload IDs. The API remains at `/opt/otog/request-efficiency-20261026/workspace`; a final frontend clock-freshness revision is recorded separately below. Grader images, code, limits, CPU assignments, watchdogs and verdict rules were not changed.

## Behavior

- PostgreSQL notifies the API when submission status, update time or sharing changes. The API uses one dedicated listener connection, coalesces notifications, and publishes authorized progress over the existing authenticated Socket.IO connection. Each publication rechecks the current session, user role and submission visibility. Browser and database-listener reconnects resynchronize the watched submissions.
- Visible submission observers share one tracker. Submission tables receive minimal result summaries without fetching code or testcase details. An open detail view fetches full results on completion. Rejudging clears old scores immediately; stale events and old detail responses cannot restore the preceding verdict.
- When live delivery is unavailable, the browser checks batches of up to 100 IDs: active grading every second, waiting jobs every three seconds, completed watches every fifteen seconds. Hidden tabs pause fallback requests. Subscriptions and snapshots are removed when no longer viewed and reset when the signed-in account changes.
- Contest/problem metadata is reusable for ten seconds, with existing invalidation after edits and at contest boundaries. Live clock data retains one-second freshness; it is not treated like static metadata. The admin resource-refresh cadence is unchanged.
- The progress endpoint combines visibility filtering and progress retrieval into one database read. Batched progress omits submissions the caller cannot inspect and exposes no source or testcase details.
- All five upload forms generate a unique request ID. A retry of the same payload retains that ID; a successful new attempt or changed payload gets a new ID. Within a database transaction, duplicate IDs are serialized and map to one submission. Reusing an ID with different code returns HTTP 409. IDs are scoped to the authenticated user. Uploads are not automatically replayed.

The existing pool still allows 16 connections. The new PostgreSQL listener uses one additional connection, giving a total budget of **17**, below the API role's allowance of 32. The shared password queue remains two active operations plus ten waiting.

## Verification

API/frontend type checks, production builds, existing login/registration/session/security regressions, focused tracker/hook tests and 52-route schema compatibility checks passed. The dependency inventory checks reported zero known vulnerabilities in the API, frontend and build dependencies against the retained vulnerability database.

Real HTTP + Socket.IO tests ran against a disposable database and confirmed:

- Six concurrent retries created one submission; changed content, invalid request IDs, distinct users and replay after eligibility changed behaved correctly.
- Batch and single-status access rules protected private and hidden submissions; oversized batches were rejected.
- Database notifications delivered grading/final updates; rejudging cleared the previous result.
- Both database-listener loss and socket reconnect resynchronized missed results.
- Role demotion and session revocation were checked before publishing updates.

An automatic approval review rejected copying the full private HTTP fixture source because it might contain credentials. The workflow instead read only function signatures and variable names and executed the new checks inside the disposable environment. No full private fixture source was copied. An unrelated legacy Zod-generator dependency could not regenerate; this release regenerated only the Prisma client, because the added operational model does not change any existing contract model fields.

## Same paced 100-user retest

Used the actual VM, current production website/API/database and six graders. The load generator and real Socket.IO clients ran on Windows outside the VM. Like the previous direct-VM run, it used 100 ordinary accounts, logins staggered over forty seconds, three minutes of mixed browsing with three-to-eight-second navigation pauses, and two ordinary C++ submissions per user. Remaining jobs were drained before the separate burst checks.

Browsing HTTP actions were retained, including the explicit contest-detail reads, so this benchmark does not measure the additional benefit of browser metadata caching. Pending-result HTTP polling was replaced with real socket subscriptions. These are HTTP/socket journeys rather than full browser rendering or asset-download measurements. Internet/ngrok overhead is excluded by the local port forward.

| Measurement | Previous | After |
|---|---:|---:|
| Mixed HTTP requests, including drain | 18,929 | **9,614** |
| HTTP progress polls | 9,625 | **0** |
| Mixed HTTP p95 / p99 | 373 / 522 ms | **207 / 352 ms** |
| Own-score API p95 / p99 | 340 / 488 ms | **126 / 198 ms** |
| Contest-detail API p95 / p99 | 362 / 496 ms | **117 / 215 ms** |
| Submission-history API p95 / p99 | 336 / 527 ms | **119 / 225 ms** |
| Upload acceptance p95 / p99 | 511 / 593 ms | **326 / 531 ms** |
| Problem-page navigation p95 / p99 | 336 / 472 ms | **320 / 464 ms** |
| Contest-page navigation p95 / p99 | 264 / 400 ms | **271 / 425 ms** |
| Server final-verdict time, including queue, p95 / p99 | 89.53 / 93.54 s | **83.88 / 87.30 s** |

Mixed HTTP traffic fell **49.2%**. The client received **996 progress messages carrying 997 updates** across 100 successful socket connections, with no recorded socket errors. Socket handshakes, watch commands and frames are counted separately from the HTTP request table: there were 100 connections and 300 watch commands. All connections were closed during normal test cleanup; the final zero live-connection count is expected.

All **200 uploads succeeded and all 200 jobs completed**. Mixed activity had zero unexpected HTTP responses, zero transport errors and zero read retries. There were 166 full accepts and 34 expected p2 partial results; all scores matched their references, with no extra TL or compile-error verdicts. Minimum sampled available RAM was **1,563.5 MiB**, the API used at most **17 connections including its listener**, and six graders ran concurrently. The waiting submission queue peaked at 83.

Separate bursts also succeeded for all 100 problem opens (p99 3.362 s) and all 100 scoreboard reads (p99 428 ms). The intentionally simultaneous 100-login burst admitted 13 over its duration and returned 87 HTTP 503 busy responses; no HTTP 500 responses occurred. All 100 staggered logins succeeded. The smaller password queue deliberately refuses excess requests; these refusals are retained as unsuccessful login attempts.

These are short-run comparisons with a changed request mix, not a guarantee that every route improves. Contest-page tails were slightly higher, while ordinary problem-page tails changed little. The modest grading-time difference is an observation under the same existing grader configuration, not proof of a grading optimization. The public-path TLS/client errors and upstream HTTP 429 responses from the preceding ngrok test were not retested or resolved by this direct-VM benchmark; ngrok plan limits still apply.

## Restoration and release evidence

The benchmark recovery passed. Contest 2 is restored exactly to **15 October 2027, 09:00–13:00 Asia/Bangkok**. Test accounts, submissions, results, scores, registrations and refresh sessions were removed; fingerprints of 13 stable tables match the pre-test contents. Final original counts are **33 users, 621 submissions, 621 results**, with zero contest-2 participants and scores. Temporary credentials and copied fixture source were removed. All six grader identities/restart counts match preflight, and logs showed no watchdog recovery, retirement or low-memory admission waits.

The final frontend revision is deployed at `/opt/otog/request-efficiency-clock-20261026/workspace/apps/web/.next/standalone/apps/web`, build `Le5NEocUZiUJg8B6H0s1b`. The API remains on the tested request-efficiency release, bundle SHA-256 `4eab2da3c90ca49f94bb5855a95271192efcbd10237e88badd146c96c4f2228b`; it was not restarted for this final frontend adjustment. Type checking, production build, invalid-session smoke checks, tracker/retry/cache-key regressions and dependency checks passed again. A test of the actual query-key factory verifies that metadata freshness survives key generation and invalidation prefixes remain intact. Clock freshness is one second; stable metadata freshness is ten seconds.

Final health checks passed, one notification listener remains connected, all grader identities/restart counts match preflight, available memory was 2,475 MiB, and the idempotency table contains zero leftover benchmark records. Maintenance sources and the four accompanying test files were synchronized with backups; the separately present origin restrictions were reviewed and retained.

Release evidence: `tmp/request-efficiency-20261026/evidence/`. Benchmark: `tmp/contest-live-20261026/`. Final frontend evidence: `tmp/request-efficiency-clock-20261026/evidence/`.
