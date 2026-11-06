# Automatic worker recovery — 16 October 2026

> Superseded by the tested and deployed [17 October hardening](GRADER-RECOVERY-HARDENING-20261017.md), which propagates evaluator failures and adds bounded infrastructure waits, a progress watchdog and durable crash-retry limits. The text below records the earlier implementation.

> Coverage correction, verified against deployed source on 17 October: the testcase evaluators in `evaluate/classic.py` and `evaluate/codeforces.py` intercept exceptions and return Judge Error results. These exceptions do not reach the outer worker restart handler. Thus a testcase sandbox failure can still leave the worker alive until a later failure outside those evaluators triggers recovery (for example, the next submission's sandbox initialization). The isolated recovery integration test used a substitute judging callback with real Isolate; it did not exercise the complete evaluator interception path. The broader coverage implied below was overstated. See `RECOVERY-EXCEPTION-GAPS-20261017.md`. No production change was made during that follow-up review.

Implemented and deployed to all six graders. This addresses detected grading exceptions, including the nested-directory sandbox poisoning incident. It is not a general detector for every deadlock or a remedy for a frozen VM.

## Incident

The 1,100-level directory submission caused Isolate's post-run traversal to report “Too many open files.” Subsequent sandbox initialization failed on worker 1. The Python worker remained alive and continued heartbeats, so Docker's existing restart policy did not activate.

Submissions 688 and 689 had Judge Error results. Worker 1 was paused, confirmed idle, restarted and verified to have a fresh sandbox, heartbeat and exclusive queue lock. The other five workers were not restarted during that recovery. Neither failed submission was automatically rejudged.

## Behavior

The existing unexpected-exception handler saves a Judge Error and releases the job lease transactionally. It now exits with code 70 afterward, rather than continuing with possibly damaged private state. The existing `unless-stopped` container policy automatically restarts it; stopping the container removes its sandbox tmpfs. The next claim starts with a fresh sandbox.

Normal AC/WA/TLE/runtime/compilation results do not trigger recovery. Existing missing-testcase administrative results that return normally also do not trigger it. A late exception after a result has already committed preserves that result and still restarts the worker. Failed submissions remain completed with Judge Error, rather than being automatically retried indefinitely. An administrator can still manually rejudge one.

If the database cannot commit a result, existing database-disconnection recovery still applies; this change cannot promise quarantine without durable storage. Process deaths before saving a result retain existing interrupted-job recovery. Repeated manual submission/rejudge of hostile programs can still cause repeated restarts. This is availability recovery, not a complete repair of Isolate's deep-tree traversal or Python recursive cleanup.

## Validation

- Six checks on the actual worker loop, with isolated queue/database substitutes: normal completion, Isolate exception, recursive cleanup failure, I/O failure, exception after a committed result, and failed persistence.
- A disposable container with the real worker loop, real Isolate and the production box-ID wrapper ran a nested-directory C++ program. Its Judge Error was saved before exit; Docker automatically restarted it exactly once; a normal C++ program then compiled and ran successfully in the fresh sandbox.
- No production submissions, credentials or database were exposed to that test. Network disabled; memory 512 MiB; CPU affinity and process limits applied.
- Production deployment drained active jobs, preserved result and scoring/policy fingerprints, verified all six mounted source hashes, and preserved sandbox, queue, memory guard, resource limits and restart policy. Website/control services were not restarted. Pause flags restored conditionally to respect concurrent administrator changes.
- After deployment all six workers were enabled with fresh heartbeats and no active leases. Both localhost and ngrok returned HTTP 200. Submission 688 remained Judge Error; 689 was observed as rejected afterward (the deployment preserved result fingerprints while workers were drained and did not rejudge either submission).

## Files and rollback

- Source: `D:\otog-grader\src\mainWorkers.py`
- Active root-owned read-only override: `/opt/otog/grader-worker-recovery-20261016/mainWorkers.py`
- SHA-256: `543205c42118ebfacebbd81ac09a6c6d97d3ab4030a6e0178b3514479b82a2a5`
- Compose: `/home/otog/otog/docker-compose.vm.yml`
- Backup: `/opt/otog/grader-worker-recovery-20261016/compose.before.yml`
- Evidence: `vm-setup/case-reset-evidence-20261016/worker-auto-recovery-tests.json`, `worker-auto-recovery-deployment.json`, `live-worker-recovery.json`.

To roll back, drain/pause workers first, restore only that compose backup, and recreate only the six grader services, preserving pause flags. Do not restore the database. The website/API and the earlier sandbox filesystem-isolation correction remain separate.

## Limits

This handles **exceptions detected by the worker**, including execution-wrapper timeouts that raise exceptions. A process stuck forever without an exception requires an independent watchdog with a carefully calculated job deadline and durable handling of its interrupted submission. A VM-wide CPU/kernel freeze requires host-side detection and controlled VM recovery; a watchdog inside the frozen VM is insufficient. Docker health status by itself does not implement the restart path tested here.
