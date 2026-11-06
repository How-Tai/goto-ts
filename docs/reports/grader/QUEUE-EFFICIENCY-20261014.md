# Queue overhead optimization — 14 October 2026

## Changes

The previous claim query recalculated each candidate user's active-worker count inside its search over waiting submissions. A long backlog for a user already at the worker cap could make idle workers perform expensive searches repeatedly.

The new claim query computes saturated user IDs from the at-most-six active leases once, excludes those users before searching, and combines the worker-enable and concurrency-setting reads into one statement. Existing FIFO ordering by creation timestamp and ID, `SKIP LOCKED`, short per-user advisory locks, and the fresh post-lock cap/order check remain. Result and contest-score persistence is byte-identical to the previous implementation.

Idle workers now use a separate PostgreSQL LISTEN connection. Transactional notifications wake them on new/requeued work, lease creation/release, and changes to worker enabled flags or the per-user cap. Lease creation also wakes other workers so a same-user backlog can fill all permitted slots. Testcase status/progress updates and heartbeats do not send wakeups.

Notifications are hints; jobs remain in the durable database queue. There is a five-second safety check, a 0.5-second polling fallback if the listener fails, and reconnect backoff. Notifications are coalesced and repeated empty checks are limited to the previous maximum of two per second per worker during bursts. In a quiet queue, fallback checks drop by roughly 90% compared with the previous 0.5-second polling. Executing solutions, CPU allocation, worker count, sandbox time limits and verdict accounting are unchanged.

Migration: `20261014090000_queue_wakeup`. Trigger names: `otog_submission_queue_notify`, `otog_worker_slot_notify`, `otog_worker_enabled_notify`, and `otog_worker_limit_notify`. Triggers are installed in one transaction with bounded lock and statement timeouts.

## Testing

Tests ran in disposable databases, with an isolated container bounded to CPU 6 and 256 MB. Test databases were dropped afterward; no production accounts, problems or submissions were created.

Passed: exact old/new FIFO claim sequences with caps 1, 2, 3 and 6; equal-timestamp ID ordering; pause/resume; locked-row progress for other users; six concurrent claimers respecting a cap of two without duplicate claims; cap reduction leaving running work intact; committed-only notifications, rollback silence, requeue and lease handoff wakeups, heartbeat/progress silence, burst coalescing, and listener disconnect/reconnect fallback.

Latest synthetic benchmark, median of five calls where completed:

| Waiting backlog for a capped user | Previous claim | Optimized claim |
| --- | ---: | ---: |
| 0 | 2.434 ms | 2.816 ms |
| 100 | 9.085 ms | 3.589 ms |
| 5,000 | exceeded 5,000 ms safety timeout | 3.779 ms |

This fixture uses equal creation timestamps and a user already at the worker cap. It demonstrates an expensive queue-search case, not a direct measurement or promise of contestant execution-time improvements under all workloads.

## Deployment verification

New claims were paused and active jobs allowed to finish before recreating the six worker containers. Original enabled flags were restored. Existing submission-result counts and fingerprints and the per-user worker cap matched before/after. API, website, nginx, ngrok and monitor process start times were unchanged. Public/hidden/regular/admin access checks passed.

All six live workers loaded the same verified queue code hash. Six listeners were active, and all six idle workers reacted to a signal-only notification without creating test jobs. Grader images, sandbox mounts, CPU sets, keyword policy and other compose settings were preserved.

Backup, previous compose/source, database dump, test results and live evidence: `D:\otog-grader\vm-setup\queue-efficiency-backup-20261014.tgz`. The current guest release and backup paths are recorded in `/home/otog/worker-setup/queue-efficiency-current.txt` and `queue-efficiency-backup.txt`.

This targets queue management overhead. Simultaneous executions can still compete for shared physical CPU caches, memory bandwidth and host resources; no change to that concurrency was made.
