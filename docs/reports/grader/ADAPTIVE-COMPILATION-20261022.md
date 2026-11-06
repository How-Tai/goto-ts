# Adaptive compilation — 22 October 2026

Implemented, tested, benchmarked and deployed on all six graders. This updates
the compilation admission policy from PHASED-MEMORY-20261022.md. The shared
pool, 512 MiB available-memory growth buffer, total-RAM ceiling and two fresh
1536 MiB pre-claim checks are unchanged.

The actual observed pool was 2027.414 MiB. Two previous 1024 MiB compilation
allowances did not fit, even though ordinary compiler processes used much less
RAM. The new ordinary first attempt enforces a 512 MiB compiler address-space
limit through Isolate and reserves at least 768 MiB including the existing
256 MiB padding. Thus two ordinary compilers fit the same actual pool without
reducing the memory headroom or merely assuming they will stay small.

Initial reservation is `max(768 MiB, problem ML + 256 MiB)` for eligible smaller
C/C++/Python submissions. Problems with ML >=768 MiB, custom checkers, custom
per-problem compile commands, unknown languages or unavailable problem metadata
use the original profile immediately: the original 768 MiB contestant compiler
limit and `max(1024 MiB, ML + 256 MiB)` reservation. Private problem preparation
is checked again before compilation to catch a newly added checker/command.
Custom-checker compilation/execution behavior remains as in the prior release.

Successful compilation proceeds normally. After both compilation phases have
ended, evaluation reservations still become ML+256 MiB for standard checking,
or max(ML,512 MiB)+256 MiB for custom checking. Contestant execution limits,
CPU/wall timing, compiler optimization flags, checker rules, score calculation,
per-user limits and the Tull one-worker policy are unchanged.

If the smaller compilation fails or reaches its compilation limit, it does
not produce a contestant verdict. The worker stops the compiler and cleans its
private sandbox first. One transaction records the original-memory profile,
returns the submission to waiting, releases its lease and entire reservation,
and removes only this deliberate attempt from the crash-attempt count. Real
prior interruptions remain counted. An existing completed result cannot be
discarded this way. A transaction failure rolls back all metadata changes.

The next claim uses the original compiler allowance. A duplicate deliberate
fallback is rejected; the original-memory profile is remembered for subsequent
rejudges of that submission. The metadata stores only submission ID and its
creation timestamp, with cascade deletion when the submission is deleted.
No source code or binary is cached in this table.

The retry holds no partial RAM while waiting to grow. When an eligible older
original-memory retry needs more room, younger claims wait for running jobs
to release enough space rather than starving the retry indefinitely. Existing
user/problem eligibility restrictions still apply. Fallback does not restart
the worker, consume the infrastructure crash retry, reset queue timestamps or
alter measured contestant runtime. If a worker actually crashes, the existing
bounded recovery policy still applies.

The smaller attempt is retried on any ordinary compilation failure rather than
guessing whether an error message proves memory exhaustion. Consequently,
invalid or memory-hungry code can take longer on its first grading because it
may compile twice. The original-limit attempt retains the existing compilation
CPU/wall limits, and its result determines the final compilation verdict.
Infrastructure failures remain infrastructure failures. Reservations remain a
conservative scheduler estimate, not a guarantee against all VM-wide OOMs;
the existing container limits, watchdogs and cleanup safeguards remain active.

Validation against the exact activated source hashes:

- 62 real PostgreSQL queue/transaction checks, retaining 40 earlier six-worker
  claim races, 30 phase-transition race rounds and adding 20 adaptive rounds at
  the exact 2027.414 MiB pool. That pool admitted one original compiler versus
  two ordinary smaller compilers, then four small evaluation jobs when their
  execution phases were held active in the controlled test.
- Coverage includes fallback atomicity and rollback, no false saved verdict,
  remembered original-memory claims, no unbounded retry loop, preservation of
  real crash-attempt history, release-before-growth and retry progress.
- Eight actual compiler/pipeline checks cover C++, C, Python, compilation
  failures, and subsequent healthy grading. A diagnostic first attempt was
  deliberately capped at 64 MiB so a normal C++ source exercised fallback
  without a huge allocation; the same source was accepted at the original
  768 MiB limit. Production first attempts use 512 MiB, not 64 MiB.
- Six real main-loop checks confirmed cleanup before retry, no intermediate
  false verdict, original-limit AC/compileError, later smaller-profile AC in the
  same worker, and restoration of per-job contexts.
- Eleven prior main-loop/sandbox lifecycle checks, fifteen ordinary
  verdict/checker checks and five accepted reference solutions passed. References
  for problems 48, 52, 53, 54 and 56 each scored 100 in the separate sandbox.
- Prisma schema validation passed using a dummy URL without a DB connection.

Four real six-job C++ compilation batches ran in separate temporary workers and
a network-isolated dummy PostgreSQL server. The order was original, adaptive,
adaptive, original; all used the same 2027.414 MiB pool and diagnostic CPUs 6–7.
Each worker had its own diagnostic Isolate identity 20–25. All 24 jobs were AC,
with no fallback in this workload and no reservation exceeding the pool.

| Mode | First batch | Second batch | Median | Maximum simultaneous compilers |
|---|---:|---:|---:|---:|
| Original | 15.347 s | 15.954 s | 15.651 s | 1 |
| Adaptive | 8.701 s | 8.913 s | 8.807 s | 2 |

This was **43.7% less elapsed time** for this isolated compilation-heavy workload,
not a promise of the same improvement for every problem or a change to reported
contestant execution times. Real active-job counts peaked at two to three in
these short-running batches. All six workers remain enabled, with actual
concurrency determined by their memory/policy eligibility. Benchmark guest
MemAvailable stayed at or above 1,894,984 KiB, above the 1.5 GiB abort threshold.
No production test submissions or rejudges were created.

Deployment drained both active jobs and cleanup reservations before recreating
only the six graders. Source hashes, image identity, resource limits and all
other hardening mounts matched the reviewed release. Existing result and policy
fingerprints were preserved, prior enabled states restored, and website services
were not restarted. All six workers passed postflight. Localhost/ngrok home,
health and protected admin routes passed six checks; Windows localhost:3030
returned HTTP 200. Temporary test/benchmark containers were removed.

Migration `20261022020000_grading_compilation_profiles` adds only the operational
`otogCompilationProfile` table. The grader role has SELECT/INSERT; the API has
no permission on that table. The exact checksum is recorded in Prisma migration
history. Maintenance sources/schema were synchronized. No API/web build or
restart, VM resource change, Windows setting change, or dependency download was
needed.

Active source mounts are under `/opt/otog/adaptive-compilation-20261022/source/`:
`mainWorkers.py`, `worker_queue.py`, `memory_reservations.py`,
`sandbox_security.py` and `evaluate/main.py`. The native Isolate binary,
filesystem-depth fix, inode quota, per-testcase reset and checker hardening
remain unchanged. Preserve this directory as active runtime storage.

Rollback material includes the previous phase-aware compose file, all five
prior sources, maintenance-source backups, previous Prisma schema, pause states,
historical fingerprints and test/benchmark evidence. Activation had automatic
compose rollback on failed verification. For a later rollback, pause and drain
jobs/reservations, restore `compose.before.yml`, recreate only the six graders,
and restore their prior enabled states. The profile table/migration can remain
unused; never delete a live memory reservation to force capacity.

Sanitized evidence:
`D:\otog-grader\vm-setup\adaptive-compilation-evidence-20261022\`.
# Current policy update

The ordinary first-attempt limit and minimum reservation below were subsequently
reduced from 512/768 MiB to 384/640 MiB after broader measurements and regression
tests. The original-limit fallback remains unchanged. See
[the current compiler budget report](COMPILER-BUDGET-20261022.md).

