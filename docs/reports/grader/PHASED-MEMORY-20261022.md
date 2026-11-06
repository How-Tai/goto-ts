# Phase-aware grader memory reservations — 22 October 2026

Updated later on 22 October by [adaptive compilation](ADAPTIVE-COMPILATION-20261022.md).
That release reduces ordinary initial reservations with an enforced smaller
attempt and original-limit fallback. The following is the prior release record.

Implemented and deployed on all six graders. This supersedes the whole-job
1 GiB minimum described in MEMORY-RESERVATIONS-20261022.md. Compilation still
uses the conservative initial allowance; a successfully compiled small job no
longer holds that allowance throughout all its testcases.

Initial claims reserve `max(1024 MiB, problem ML + 256 MiB)`, atomically with
the queue lease, status and retry counter under the shared PostgreSQL lock.
After both contestant compilation and any custom-checker compilation have
finished, the evaluator reduces the reservation in a second short transaction:

| Problem ML | Standard checker: evaluation allowance | Custom checker: evaluation allowance |
|---|---:|---:|
| 16 MiB | 272 MiB | 768 MiB |
| 32 MiB | 288 MiB | 768 MiB |
| 64 MiB | 320 MiB | 768 MiB |
| 128 MiB | 384 MiB | 768 MiB |
| 256 MiB | 512 MiB | 768 MiB |
| 512 MiB | 768 MiB | 768 MiB |
| 1024 MiB | 1280 MiB | 1280 MiB |

Standard checking uses the existing bounded streaming comparison. Custom
checking retains the existing 512 MiB checker allowance plus 256 MiB padding,
or the problem ML plus padding if larger. Execution and checking are
sequential, so this uses their maximum rather than their sum. These amounts
are scheduling reservations, not preallocated RAM or new contestant limits.

Every evaluation allowance is less than or equal to its initial allowance.
The transition never waits for additional memory, and no reservation growth is
needed between testcases. This avoids a group of jobs holding some memory
while all wait for more memory to start their checker. Identical repeated
transitions are harmless; missing/wrong job ownership, growth, or changing an
already established evaluation envelope is rejected. A failed transaction
rolls back without releasing the larger reservation.

The phase hook runs once before the first testcase, after the checker-type
function has successfully returned (including checker compilation). It is
opt-in, scoped to the current main-loop job, and cleared on exceptions. Other
grader entrypoints keep their existing function interfaces. Contestant compile
errors and malformed checker compilation never invoke this reduction.

After evaluation, memory remains reserved through result persistence and
sandbox/scratch cleanup. Cleanup failure and container-crash recovery retain
the same ownership rules as the preceding release. A heartbeat timeout cannot
reclaim memory. Freed compilation capacity sends the existing queue wakeup
notification. Empty-queue/pause polls no longer issue a budget UPDATE; a new
budget epoch is written only with its first real claim.

The pool calculation, its 512 MiB available-memory growth buffer, its total-RAM
ceiling, and the two fresh 1536 MiB pre-claim checks are unchanged. Pool size is
still sampled when there are no reservations, then held fixed to avoid
double-counting memory already reflected in MemAvailable. See the preceding
report for that calculation and its limitations. This does not guarantee that
1536 MiB remains available at peak usage, or prevent unrelated services from
growing unexpectedly. Existing sandbox/container limits and watchdogs remain
active. No VM RAM, CPU, timing, compiler, checker or Windows settings changed.

Controlled admission tests with a 2048 MiB pool and six waiting 64 MiB problems
admitted two initial compilations, then four active evaluation jobs as those
compilations completed. The fifth compilation correctly waited because its
initial allowance would not fit alongside the four existing reservations.
This demonstrates increased scheduling concurrency, not a claim that real
judging throughput doubled. Actual concurrency depends on problem limits,
checker type, fresh RAM, per-user limits and when jobs finish. All six workers
remain enabled; large-memory problems still run with fewer peers.

Verification against the exact deployed sources:

- 44 real PostgreSQL transaction/queue checks with a restricted worker role in
  a disposable network-isolated database. Includes the preceding 40 rounds of
  six concurrent claimants and 30 additional six-worker phase-transition race
  rounds, preserving the pool ceiling and existing per-user/problem limits.
- Phase-update rollback, monotonicity, idempotence, wrong-job rejection,
  reduced-reservation recovery, pool refresh, idle polling and callback
  exception/thread isolation checked.
- Eleven real sandbox/main-loop lifecycle checks passed using controlled
  storage callbacks, including C++, Python, a custom C++ checker, finite 64 MiB
  scratch cleanup and post-commit cleanup failure. Phase callbacks observed
  completed compiler calls and the saved baseline before reducing allowances.
- Fifteen ordinary verdict/checker checks passed with phase callbacks enabled.
  Contestant compile errors and malformed custom-checker compilation produced
  no phase transition. AC, WA, RE, TLE, Python exception, filesystem isolation,
  invalid UTF-8 and all existing custom-checker interfaces retained behavior.
- Five accepted reference solutions (problems 48, 52, 53, 54 and 56) each scored
  100 in the isolated diagnostic sandbox. No production test submissions or
  rejudges were created.
- Prisma schema validation passed using a dummy URL without a DB connection.
- Deployment paused new claims, waited for both leases and cleanup reservations
  to clear, and recreated only the six graders. Source hashes, all existing
  mounts, image identity, resource limits, historical result/policy fingerprints
  and website-service identities passed verification. Original enabled states
  were restored.
- Six localhost/ngrok checks passed, including guest rejection from the admin
  API; Windows localhost:3030 returned HTTP 200. All six workers were healthy
  and idle at postflight. Temporary diagnostic containers were removed.

Active source mounts are under `/opt/otog/phased-memory-20261022/source/`:
`mainWorkers.py`, `worker_queue.py`, `memory_reservations.py` and
`evaluate/main.py`. All other security/hardening mounts remain unchanged.

Migration `20261022010000_grading_memory_phases` adds operational phase and
update-time columns and permits smaller evaluation reservations. The worker
role receives only the necessary column-update grant. The API still has no
write grant to this reservation table. Exact migration checksums are recorded
in Prisma history; the maintenance checkout and schema models are synchronized.
The API and frontend required no rebuild or restart.

Rollback material is retained in the active release directory: prior compose,
four prior sources, maintenance-source backups, prior schema and sanitized
verification reports. Automatic compose rollback protected activation. A later
rollback should pause and drain both jobs and reservations, then restore
`compose.before.yml`, recreate only the six graders and restore their prior
enabled states. This returns to the earlier whole-job reservation policy.
The additive database changes can remain; never delete an active reservation
to force capacity. Preserve both runtime release directories.

Sanitized evidence:
`D:\otog-grader\vm-setup\phased-memory-evidence-20261022\`.
