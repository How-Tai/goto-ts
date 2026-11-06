# Grader recovery hardening — 17 October 2026

> Later correction: the reproduced directory-depth failure is now fixed by the [native/Python cleanup update](DIRECTORY-DEPTH-FIX-20261017.md). Unexpected infrastructure failures still use the recovery described here.

> Deadline update: the later [stage-aware watchdog release](STAGE-AWARE-WATCHDOG-20261017.md) replaces the broad 360/180-second job timers with per-operation deadlines and one waiting monitor thread per job. Exception propagation and durable retry controls described here remain in effect. Its report identifies the current release and rollback.

Deployed successfully to all six workers, using the existing `otog-grader:security-20261016` image and new root-owned read-only source overrides. No hostile submissions were sent to the live queue.

## Changes

- Classic and Codeforces evaluators propagate typed infrastructure/sandbox-health failures to the outer worker. Other unexpected testcase exceptions are wrapped as infrastructure failures. They no longer silently return Judge Error while leaving a damaged sandbox available for another submission.
- The worker persists Judge Error and releases its lease before exiting with code 70. Docker's existing `unless-stopped` policy restarts it and clears its sandbox tmpfs. Normal AC/WA/TLE/runtime/compilation verdicts continue without a restart.
- Isolate cleanup and initialization each have 20-second wrapper limits. A failed cleanup is treated as unhealthy, never ignored before another initialization. Trusted checker compilation has a 120-second limit. Trusted checker execution retains its 60-second limit, with process-group termination and reaping on timeout.
- Infrastructure subprocess diagnostics go to temporary files, with at most 64 KiB per stream read into the parent. A separate single-threaded exec helper applies a 64 MiB per-file limit and disables core dumps. This avoids `preexec_fn` in the now-threaded worker. Contestant execution limits and measured testcase CPU time are unchanged.
- The standard checker reports filesystem/reference-text failures as administrative errors. Invalid UTF-8 from a contestant remains WA. Valid text and trailing-whitespace comparison behavior are preserved. The old C++ checker protocol now removes stale `grader_result.txt` before each invocation. Numeric checker scores must be finite and within [0,1].
- Each durable queue claim increments a per-submission attempt counter in the same transaction. After two interrupted attempts, the next claim records Judge Error without executing that job. Counters follow the job across workers. Result persistence removes the counter and lease together; explicit manual rejudge starts a fresh budget. Submission deletion cascades to the counter.
- A low-frequency job progress watchdog exits the worker with code 71 if grading stops progressing. The first deadline is `max(360, max(180,90+2*TL*factor)+180)` seconds. Later progress callbacks reset `max(180,90+2*TL*factor)` seconds, where TL is seconds and factor includes the language multiplier. The timer is active during preparation, retry lookup, grading, scoring/persistence and final queue cleanup. Cancellation uses a generation guard so a stale cancelled timer cannot kill a subsequent job.

## Recovery boundaries

Immediate restart requires the main worker to observe a failure. The watchdog is a separate Python thread in that worker, so it can detect ordinary blocking/no-progress states while Python can schedule the thread. It does not guarantee recovery from a native call holding the GIL indefinitely, a process in uninterruptible kernel sleep, a frozen guest kernel, or a frozen host. Docker restart also depends on a responsive guest and Docker daemon. A host-side VM watchdog was not installed.

OOM/native process death and watchdog exits can occur before a result is saved. Existing startup recovery requeues the interrupted lease; the new durable two-attempt budget prevents indefinite automatic execution of the same job. A job manually killed twice also reaches this safeguard. Database unavailability can delay recovery/result persistence. Explicit rejudges can intentionally repeat a failing job.

This contains the deep-directory availability issue; it does not rewrite Isolate's directory traversal or Python's recursive cleanup. A triggering submission can still receive Judge Error and cause one affected-worker restart. Trusted checkers still share the container's memory budget; no new checker-only memory limit was imposed. No guarantee against every malicious program or VM-wide resource exhaustion is claimed.

## Validation

- 10 focused tests: infrastructure success/timeout, bounded diagnostics, watchdog cancellation and actual no-progress exit, standard checker behavior for whitespace/invalid contestant text/missing or invalid reference files, and the actual worker's exhausted-retry branch (no execution or restart loop).
- 14 complete `judge.startJudge` tests covering ordinary C++ and Python verdicts, testcase file isolation, and AC/WA for all three custom checker formats.
- Four disposable containers exercised the actual worker loop, `judge.startJudge`, evaluator and Isolate: C++/Python in classic/Codeforces modes. Each real nested-directory failure persisted Judge Error before exit, restarted automatically exactly once, and accepted a healthy follow-up submission for 100 points. Only queue/database/control callbacks were substituted; judging/evaluation was not substituted.
- Actual queue SQL was tested against a disposable PostgreSQL instance: cross-worker interrupted-job recovery, retry exhaustion, atomic result/counter/lease cleanup, and a fresh explicit rejudge budget.
- Five previously accepted production reference solutions passed against read-only testcases. No test jobs or fabricated results were written to the live database.
- Deployment drained active jobs, compared stored result/score/policy fingerprints before and after replacement, checked all 12 source hashes in all six containers, and preserved image, CPU affinity, memory/swap/process/tmpfs limits and restart policies. Website/control services were not restarted. Original pause states were restored conditionally to respect concurrent administrator actions.
- Postdeployment: all six workers enabled with fresh heartbeats and no active leases; retry table empty with expected runtime access restrictions; localhost and ngrok both returned HTTP 200.

## Deployment and rollback

- Active release: `/opt/otog/grader-recovery-v2-20261017/source/`
- Compose: `/home/otog/otog/docker-compose.vm.yml`
- Previous compose: `/opt/otog/grader-recovery-v2-20261017/compose.before.yml`
- Source hashes and test/deployment evidence: `vm-setup/recovery-v2-evidence-20261017/` on D.
- Additive table: `otogWorkerAttempt`, with submission foreign key and positive attempt-count constraint. Only the grader runtime role was granted access; API runtime privileges were explicitly revoked. No existing rows, identifiers, testcase files or historical results were rewritten.

To roll back, pause new claims while preserving prior pause flags, let active leases finish, restore the previous compose, recreate only the six graders, verify fresh worker registration, then conditionally restore pause flags. Do not restore the database. Leave the additive attempt table in place: old workers ignore it, and dropping recovery metadata during an incident is unnecessary. The previous compose contains the 16 October recovery handler, so the evaluator-interception gap would return after rollback.

Future builds must include all 12 updated local modules or preserve these verified overrides. The existing API, frontend and broker image identity rules remain unchanged.
