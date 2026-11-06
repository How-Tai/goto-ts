# Measured compiler budgeting — 22 October 2026

The subsequent [selective compilation pipeline](COMPILATION-PIPELINE-20261022.md)
now separates compilation and execution reservations for applicable larger-memory
jobs. The 384 MiB compiler limit and 256 MiB padding described here remain current;
the old requirement to reserve execution ML during those compilations is superseded.

Deployed and verified on all six graders. Ordinary first-attempt compilation
now has a **384 MiB per-process address-space limit** and a minimum **640 MiB
scheduling reservation**, down from 512 MiB and 768 MiB respectively. The
existing 256 MiB job padding is unchanged. This reduces the ordinary minimum
reservation by 128 MiB (16.7%). Only `FAST_COMPILE_MEMORY_KIB` and its explanatory
comment changed in the runtime sources; all other source hashes match the
previous adaptive-compilation release.

The actual first allowance remains `max(640 MiB, problem ML + 256 MiB)`. A
512 MiB problem therefore still reserves 768 MiB. Large problems (ML >=768 MiB),
custom checkers, per-problem compilation commands, unknown metadata and remembered
full-compilation profiles retain the original compiler limit of 768 MiB and
reservation of `max(1024 MiB, ML + 256 MiB)`.

The one-time original-limit fallback is preserved: a failed smaller compilation
cleans its sandbox, requeues with the full profile, and does not emit a contestant
verdict or consume the interrupted-worker retry allowance. More complicated
sources can need that retry and take longer; this policy does not promise that
every program compiles within 384 MiB.

## Measurements

There were 34 isolated compilation measurements: 17 programs at both 512 MiB and
384 MiB. These included the supplied segment tree solution, graph/DSU code,
regular expressions, policy-based trees, nested tuple templates, constexpr work,
large static BSS, C, Python and five existing accepted reference sources.

All **16 supported programs** compiled at both limits. The extra Boost integer
example failed equally at both limits because this existing compiler image does
not contain Boost headers; no packages were installed or removed.

At the candidate limit, the largest measured individual compiler-process peak
RSS was **274.7 MiB**, and the largest kernel cgroup `memory.peak` charge was
**257.6 MiB**. The latter covers the isolated measurement container, including
its interpreter, compile process tree, page cache and temporary files charged to
that cgroup. It can be lower than process RSS because shared pages may be charged
elsewhere; it is not a sum of process RSS or a measurement of every production
worker overhead. No cgroup OOM, OOM-kill or memory-limit events were recorded.
The diagnostic container's overall cap was 768 MiB, with no extra swap allowance.

Measurement data:
`vm-setup/compiler-budget-measurements-20261022.json`.

## Regression and concurrency tests

- 62 real PostgreSQL claim/recovery checks, including 40 base race rounds,
  30 phase-transition race rounds and 20 adaptive race rounds with six workers.
- 11 sandbox/worker lifecycle checks, eight actual compilation pipeline checks,
  six worker-loop fallback checks and 15 verdict/custom-checker checks.
- All five known accepted references remained AC/100 when tested using the
  candidate compilation profile, without production test submissions/rejudges.
- With the same 2027.414 MiB test budget, three ordinary compilation reservations
  fit instead of two. Held-phase race tests admitted five small evaluation jobs
  over successive transitions instead of four. These are capacity checks, not a
  promise that five real jobs will always run concurrently.

Four actual six-job compilation/judging batches used a disposable database and
the same two diagnostic CPUs, in previous/candidate/candidate/previous order:

| Policy | Batch 1 | Batch 2 | Median | Peak simultaneous compilers |
| --- | ---: | ---: | ---: | ---: |
| Previous 512 + 256 MiB | 8.949 s | 8.762 s | 8.855 s | 2 |
| Candidate 384 + 256 MiB | 8.943 s | 8.926 s | 8.935 s | 3 |

All 24 jobs received AC, with zero fallbacks and zero leaked reservations.
Batch elapsed time was effectively unchanged (candidate median 0.9% higher);
there is **no demonstrated speed improvement on these two test CPUs**. The
demonstrated improvement is lower reserved memory and greater admission capacity,
not a universal throughput or contestant-runtime improvement. Minimum guest
MemAvailable during this benchmark was 1,840,552 KiB, above the existing guard.

## Deployment and preserved protections

Active release: `/opt/otog/compiler-budget-20261022/source/`.
Source hashes, tests, benchmark and postflight evidence are saved in
`vm-setup/compiler-budget-evidence-20261022/`.

New claims were paused, active leases and memory reservations drained, and only
the six idle grader containers recreated. Original enabled states were restored.
All six mounted source sets matched the tested hashes, all heartbeats were fresh,
and historical results/policies were unchanged. Existing database migration and
privileges were reused; no production schema changes were made.

The 1536 MiB fresh pre-claim guard, fixed shared budget, 512 MiB pool growth
buffer, full-profile compiler limit, evaluation reservations, sandbox cleanup,
container resource limits, compiler flags, contestant execution limits and
checker rules are unchanged. API/web/nginx/ngrok were not restarted. Six guest
localhost/ngrok HTTP/authentication checks passed. No production test accounts,
submissions or verdicts were created by these tests.

Reservations remain conservative scheduling estimates, not an absolute OOM
guarantee: background services can grow, and the compiler address-space limit is
per process rather than a hard aggregate compiler-tree RSS cap. Padding and the
existing container/sandbox limits are retained for that reason.

## Rollback

Pause new claims and drain both active jobs and their memory reservations.
Restore `/opt/otog/compiler-budget-20261022/compose.before.yml` to
`/home/otog/otog/docker-compose.vm.yml`, recreate only the six idle graders and
restore the prior enabled states. The previous active runtime remains under
`/opt/otog/adaptive-compilation-20261022/`. The previous maintenance source copies
are under this release's `maintenance-before/`. No schema rollback is necessary.
Never delete a live reservation to force admission capacity.
