# Quiet TLE verification — 15 October 2026

**REVERTED at the user's request on 15 October 2026.** Automatic TLE rechecks and their global coordination barrier are no longer active. All six VM workers and local `src/mainWorkers.py` have been restored byte-for-byte to the original worker code; the helper was removed from runtime mounts and local `src`. Current worker enabled flags, time limits, per-user settings and existing scores were preserved. Website service processes were unchanged. Rollback evidence: `D:\otog-grader\vm-setup\quiet-recheck-reverted-20261015.tgz`. The remaining sections below document the historical implementation, not current behavior.

Six workers remain available for ordinary parallel grading. CPU assignments, sandbox limits, language multipliers, worker priorities, per-user concurrency setting and website configuration remain unchanged.

## Behavior

1. Each worker runs the original grading attempt normally. Passing submissions, WA without a TLE, compilation errors, judge errors and keyword-policy rejections do not trigger a retry.
2. A result containing a typed `TIME_LIMIT_EXCEEDED` testcase receives at most one additional full grading attempt. The first result remains private until the final decision; scores and verdict rows are committed only once.
3. Before retrying, the worker releases its normal execution lock, acquires a shared coordination barrier exclusively, and lets already-running grading finish. New grading claims wait. No existing solver is interrupted to make a quiet slot.
4. The same submission, testcases, sandbox, CPU assignment, compiler and unchanged time limits run in a child process. It cannot write queue/scoring results or start another retry. A valid AC or reject result from that complete quiet run becomes the final result, including all subtask details and measured times; results are not merged or artificially multiplied.
5. Waiting for the quiet slot is limited to 30 seconds. The child retry has a 45-second wall-clock supervisor budget. A busy system, shutdown request, timeout, child failure or invalid retry result retains the original TLE result. Cleanup kills the retry process group and cleans this worker's sandbox before other judging resumes. If sandbox cleanup cannot be verified, the worker exits for Docker to restart its container and recover its unfinished lease.
6. The quiet barrier is released and idle workers are notified immediately afterward. Six-way normal grading resumes. Multiple TLE workers serialize their retries; all release normal execution before competing for the barrier, preventing lock-upgrade deadlocks.

The budgets bound the additional attempt; they are not changes to contestant testcase time limits. Database/network/host stalls can still delay operations. A worker killed or restarted during grading recovers its unfinished job through the existing lease recovery; that creates a new grading attempt, as before.

## Coordination and failure safety

- PostgreSQL session advisory locks, scoped to the current database: normal shared execution `(140013,1)` and quiet intent `(140014,1)`. Session locks survive intermediate result/progress commits and disappear when a worker loses its connection.
- Normal work briefly holds intent shared while acquiring execution shared, closing the race with a coordinator beginning to drain. The quiet owner holds intent exclusive while waiting for execution exclusive.
- No new persistent database schema, changes to enabled flags during quiet operation, changes to FIFO/per-user eligibility rules, or changes to atomic result/contest-score persistence.
- Worker heartbeats continue while draining or retrying. The current admin page continues showing the submission as grading until the final result; detailed quiet-recheck phases are written to worker logs.

## Validation

- Seven real PostgreSQL/DTO tests passed in a disposable database: six ordinary workers allowed, drain blocks new work, six simultaneous TLEs do not deadlock, only one quiet execution at a time, bounded wait, shutdown cancellation, automatic session-lock release after failure, pause flags unchanged, typed TLE detection and full result serialization.
- Six real sandbox checks passed in an isolated temporary container: AC, WA, genuine TLE, supervisor deadline killing an active infinite-loop solver, no solver left running after cancellation, subsequent sandbox reuse, and rejection of an unusable compilation result.
- Full actual worker-loop integration passed using a schema-only copy in another disposable database: a simulated first-attempt TLE became a real sandbox AC; normal WA did not retry; genuinely slow code received exactly one retry and remained TLE; exactly one final result per submission, correct testcase verdicts, no leftover leases, three contest-history entries and the correct BEST contest score of 100.
- The first integration fixture used a different Python import path from deployment and could not load the child harness; it retained the original TLE safely. Correcting the fixture to the production path made the complete integration pass. No live submissions or test accounts were created or changed by tests.
- The original `worker_queue.py`, including atomic result and contest-score persistence, was checked byte-for-byte unchanged.

## Deployment and rollback

The deployment saves the original compose configuration, mounted worker code, original worker enabled flags, test evidence and fingerprints of existing results/subtasks/verdicts/contest scores/history. New claims pause, active grading drains, and only the six worker containers are recreated with a read-only helper mount. All original enabled flags are restored afterward. The API, web, nginx, ngrok and monitor processes are checked unchanged. A failed deployment restores the previous compose configuration after draining.

Local backup: `D:\otog-grader\vm-setup\quiet-recheck-backup-20261015.tgz`.

Deployment completed and verified: all six workers enabled with fresh heartbeats and six queue listeners; no leftover quiet-exclusive locks, active jobs, disposable test databases or temporary test containers. Local and ngrok public-page checks returned HTTP 200 (about 32 ms and 272 ms respectively). Existing results/subtasks/verdicts/contest scores/history fingerprints matched, and website service process start times were unchanged. All six mounted code hashes matched local source: `mainWorkers.py` SHA256 `60683835d47a00452ca1d11e0f8b0e91bcabcc6b771b0d6734805aff5c19883e`, helper SHA256 `2cd6e1feddeb49ea4e1beed3f50c8df54d6aea7410320e11b9423c8d6b5218d6`.

Guest release marker: `/home/otog/worker-setup/quiet-recheck-current-20261015.txt`.
Guest backup marker: `/home/otog/worker-setup/quiet-recheck-backup-20261015.txt`.

To roll back later, pause and drain all jobs, restore `compose.before.yml` from the saved backup to `/home/otog/otog/docker-compose.vm.yml`, recreate only the six graders with the existing image, and restore the saved enabled flags. Do not restore historical database results or scores for a code rollback.

## Limits

This reduces load-related false TLE risk; it does not guarantee perfect runtime consistency. The VM still shares physical hardware with Windows, and background services continue running. Six simultaneous executions are deliberately suspended during a quiet verification. Genuine TLE traffic adds work and can increase queue latency; wait/retry budgets prevent unlimited retries, and some TLEs may retain the original result when no bounded quiet attempt is available. No existing submission is automatically rejudged retroactively.
