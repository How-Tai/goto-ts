# Selective compilation pipeline — 22 October 2026

The [dedicated compiler service](DEDICATED-COMPILER-20261022.md) now supersedes the shared-worker arrangement below. This report records the earlier implementation.

Deployed and verified on the existing six workers. There is no seventh worker
or additional always-running compiler container. The six workers can switch
between compilation and execution stages. Up to three eligible jobs can be in
the separate compilation stage, subject to the same shared memory budget and
existing per-user/per-problem controls. This does not mean nine simultaneous
jobs or six executions plus three compilations.

## Behavior

For eligible standard C/C++ problems, compilation can finish, clean its sandbox,
publish a private binary, and release its RAM reservation. The submission then
waits for any worker to acquire its execution reservation. The next worker
copies and verifies the binary into a fresh sandbox and executes the testcases
without recompiling it. Ready binaries occupy disk and reclaimable cache pages,
not a reserved contestant heap. Execution still reserves the full current ML
plus the existing padding; disk caching is not a promise of zero RAM usage.

The stage is used only when it reduces the reservation:

- Ordinary compilation: 384 MiB compiler address-space limit plus 256 MiB padding
  =640 MiB reservation. A 512 MiB problem can compile with this reservation, then
  wait without a RAM lease until 768 MiB is available for execution.
- A 1024 MiB standard problem can likewise compile with 640 MiB, then requires
  1280 MiB for execution. Problem ML no longer forces a 768 MiB compiler profile
  merely to cover the program's later execution memory in this separate stage.
- Compilation needing the remembered full profile uses the original 768 MiB
  compiler limit and 1024 MiB compiler reservation. Smaller-allowance failures
  retain the existing one-time full-profile retry and crash-attempt accounting.
- Small-memory problems remain on the direct path when the existing initial
  reservation already covers both compilation and execution. They do not incur
  an unnecessary binary-store/queue round trip.
- Python, custom checkers/commands, auxiliary source/library inputs and
  unavailable metadata retain the existing coupled path. No custom checker or
  compiler command is silently replaced.

At the deployment snapshot, standard problems **5 and 38** had ML512 MiB, and
problem **55** had ML1024 MiB. These were the three existing applicable problems.
Problem55 retains its **one active worker** policy, including compilation; a
batch consisting only of this restricted problem does not gain three-way
compilation. Other limits and original per-user FIFO checks remain enforced.

## Isolation, integrity and recovery

The cache is a root-owned mode0700 flat directory, mounted below `/usr/src`,
which contestant Isolate namespaces mask. Each artifact belongs to exactly one
submission and is identified by a random token; binaries are never shared
across submissions/users. A fingerprint binds submission ID, problem ID,
source, language, compiler command and image version. SHA-256 and regular-file
size checks protect the copied executable. Source filenames are retained so
the compiled source name and sandbox source remain consistent. The copied
binary is independent, with no writable hard link to the stored artifact.

Missing, changed, stale, symlinked, FIFO or oversized binaries are never executed:
the worker cleans its sandbox and requeues the job for normal compilation.
Per-test baseline restoration remains in place. A compiled program cannot see
the shared store or retain its created files into the next testcase.

The store is limited by 12 pending/active artifact records and 256 MiB of
accounted binary bytes, with 64 MiB reserved per compilation until its actual
binary size is known. Individual binaries are capped at 64 MiB. Ready artifacts
expire after 15 minutes; garbage collection checks at most every 30 seconds,
removing orphan directories and completed/stale ready entries. Active artifacts
are not reclaimed on heartbeat age: worker recovery must acquire the original
exclusive worker lock and stop/clean its sandbox first. Unexpected corruption
outside the expected flat store layout fails closed rather than recursing into
arbitrary paths. Abrupt deletion/power loss can temporarily leave orphan files
until collection; the byte accounting is not an ext4 hard filesystem quota.

Compilation publication occurs after sandbox cleanup. It atomically releases
the job's lease/RAM and its deliberate stage-attempt charge. An older ready
job/full-profile retry can let current allocations drain instead of being
starved by newer compiles. Permanently unfit problems cannot block later
fitting work. When compiler/store capacity is full, workers check ready work
directly rather than scanning 64 more uncompiled jobs.

The queue-time trigger now preserves `queuedAt` for deliberate worker stage
handoffs/full-profile retries using a transaction-local, grader-role-checked
flag. Manual/API rejudges still reset queue entry time, as do ordinary worker
recovery operations. Original submission creation dates are unchanged.

## Verification

The exact deployed source and migration hashes match the locally saved files
and isolated test evidence.

- 62 PostgreSQL queue/recovery checks, with 40 base six-worker race rounds,
  30 phase race rounds and 20 adaptive-compilation race rounds.
- 11 existing lifecycle, eight real compilation, six worker-loop fallback and
  15 verdict/checker regression checks.
- 19 new pipeline checks, including another 20 simultaneous six-worker race
  rounds; separate compilation/execution memory; cross-worker C/C++ transfer
  without recompilation; per-user/Tull/pause/low-memory policies; store size/count
  bounds; stale/damaged/missing/symlink/FIFO/oversized artifacts; per-test
  filesystem/cache isolation; expiry; exclusive owner recovery; the actual main
  loop's low-memory fallback; queue-age preservation; and 70 unfit older jobs
  followed by a fitting same-user job.
- Five existing accepted references remained AC/100 in the direct regression
  runner and again through their applicable new/direct stage paths.
- Prisma schema validation passed with a dummy URL and no database connection.

All tests used disposable databases, private sandboxes and the existing compiler
image; they did not create production users/submissions or rejudge user results.

## Controlled benchmark

Eight real six-job batches used the same 2027.414 MiB reservation pool and two
diagnostic CPUs (6–7). Order was current/pipeline/pipeline/current for each ML.
Programs included `bits/stdc++.h`, sorted a tiny vector and printed a fixed
answer: this is a **compilation-heavy, small-execution-memory workload**, even
when configured with a large ML. It is not a measurement of six actual 1 GiB
allocations, a Tull-only queue, all problem types, or a runtime speedup.

| Problem ML | Current median | New median | Change in batch elapsed time |
| --- | ---: | ---: | ---: |
| 64 MiB | 8.694 s | 8.886 s | 2.2% higher; no demonstrated improvement |
| 1024 MiB | 15.797 s | 10.017 s | **36.6% lower** |

All **48 jobs received AC**, with zero full-profile fallbacks and no remaining
reservations. The large-ML batches admitted three compilers instead of one.
Small jobs stayed on the direct path; their measured timings include scheduling
variation and the new scheduler checks, so this is not a zero-overhead claim.
Minimum observed guest MemAvailable was 1,831,452 KiB, above the unchanged guard.
The actual benefit depends on memory limits, source complexity, available RAM,
CPU load and user/problem policies.

## Deployment and rollback

Active source: `/opt/otog/compile-pipeline-20261022/source/`.
Store: `/opt/otog/compile-pipeline-20261022/cache/`.
Operational migration: `20261022030000_compilation_pipeline`.
Evidence: `vm-setup/compile-pipeline-evidence-20261022/`.

New claims were paused, existing leases and memory reservations drained, and
only the six idle graders recreated. All enabled states were restored. Each
worker's source hashes, image, resource limits, existing mounts and new private
cache mount were checked. All heartbeats were fresh and all six workers were
enabled. The API has no access to the new artifact table; the grader role has
the specific table privileges needed for the pipeline. Historical results and
policies were unchanged. Six localhost/ngrok HTTP/authentication checks passed.

The API/web/nginx/ngrok services were not restarted. VM/Windows settings,
compiler optimization flags, testcase CPU/wall limits, score calculation and
checker rules remain unchanged. The existing 1536 MiB fresh admission guard,
shared budget, 512 MiB pool-growth buffer, job padding, container limits,
watchdog and sandbox cleanup protections remain. Reservations are conservative
estimates, not an absolute OOM guarantee or aggregate compiler-tree RSS limit.

To roll back, pause claims and drain active leases/reservations, restore this
release's `compose.before.yml` to `/home/otog/otog/docker-compose.vm.yml`, recreate
the six idle graders and restore the prior enabled states. The prior runtime
under `/opt/otog/compiler-budget-20261022/` is retained. Ready submissions remain
waiting and can be compiled normally by the previous workers. Additive artifact
metadata can remain unused; clean unowned stored binaries only after confirming
no pipeline worker is using them. The updated queue-time trigger behaves like
the original when older workers do not set the transaction-local handoff flag.
Maintenance source/schema backups are under `maintenance-before/` and
`schema.prisma.before`. Never delete a live RAM reservation to force admission.
