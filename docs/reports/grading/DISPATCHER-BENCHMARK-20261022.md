# Compiler dispatcher benchmark

Completed on the OTOG VM on 22 October 2026. The single dispatcher was slower
than the previous two persistent compiler workers in all three tested workloads.

Each row is the median time to finish a 12-submission burst, from two trials per
configuration. Order was persistent/dispatcher/dispatcher/persistent per workload.

| Workload | Two persistent workers | Single dispatcher | Longer elapsed time |
| --- | ---: | ---: | ---: |
| Compilation-heavy | 23.18 s | 28.82 s | 24.3% |
| Execution-heavy | 12.74 s | 15.85 s | 24.5% |
| Mixed | 20.87 s | 24.32 s | 16.5% |

All **144 submissions** were accepted at 100 points, with exactly 12 compilation
invocations per trial and no higher-memory retries. All artifacts and reservations
were cleared. Both configurations allowed two compilations at once with exactly
512 MiB reserved per job: 384 MiB compiler address-space limit and 128 MiB padding.
Both used CPUs 6/7 for compilation, six graders on CPUs 0–5, and the same fixed
1792 MiB reservation pool, container limits, compiler commands and problem data.
The GCC/budget/sandbox implementations were shared; budget source hashes matched.

Peak concurrent GCC processes were two in all compilation-heavy/mixed trials.
Both persistent execution-heavy trials reached two; dispatcher execution-heavy
trials reached two and one respectively. Short compilation jobs can finish before
the other assigned job reaches GCC startup.

| Workload | Compiler CPU seconds, persistent → dispatcher | Peak compiler-container memory, persistent → dispatcher |
| --- | ---: | ---: |
| Compilation-heavy | 36.00 → 44.15 | 391.1 → 393.4 MiB |
| Execution-heavy | 4.57 → 12.36 | 60.9 → 68.0 MiB |
| Mixed | 25.32 → 33.08 | 386.4 → 344.5 MiB |

Idle compiler-container memory was approximately **45.7 MiB → 12.8 MiB**. These
are cgroup memory measurements of the compiler container, separate from the
scheduling reservations and other VM services. CPU measurements cover the
compiler container, including dispatcher/worker processes and job setup.

Summed measured compiler wall time stayed similar: 35.38 → 35.86 seconds for
compilation-heavy, 2.29 → 2.20 for execution-heavy, and 23.96 → 23.94 for mixed.
These sums include overlapping compilations. The extra 7.8–8.2 CPU seconds per
batch, with similar time inside compiler invocations, points to job-process setup
and dispatch overhead as the main regression candidate; the test does not isolate
each contributing operation.

This comparison runs the actual old/new worker main loops and dispatcher. Both
use the same private result-store adapter and instrumentation, bypassing keyword
policy lookup and testcase-progress writes identically. Real compilation,
sandboxing, binary handoff, execution, cleanup and queue scheduling are measured.
Persistent workers and the dispatcher are ready before the start gate; the new
dispatcher's per-job process/import/startup cost is inside the timed burst.

Workloads match the previous benchmark's synthetic compilation-heavy,
execution-heavy and mixed programs. They use distinct users, and the database
uses identical private resource settings across configurations. Two repeats per
case support the observed difference, not a universal latency guarantee. These
results should not be compared directly to older absolute timings from the
simplified custom benchmark worker loop.

Production queue/result counts, enable flags and container identities matched
before/after. No production writes, restarts or configuration changes occurred.
The minimum guest MemAvailable was 1683.2 MiB, above the unchanged 1536 MiB guard.
All diagnostic containers were removed, and local/public page and API checks
returned 200. The live single dispatcher remains deployed.

Evidence: `D:\otog\tmp\dispatcher-benchmark\evidence\benchmark.json` and
`source-hashes.json`; source, logs, trial details and resource measurements on the
VM: `/opt/otog/dispatcher-benchmark-20261022/`.
