# Dedicated compiler throughput benchmark

The previous shared-worker pipeline completed all three tested workloads faster. The dedicated configuration took 7.0–15.4% longer at the controlled memory budget below.

Controlled 12-submission bursts on the existing 4 GiB, eight-vCPU OTOG VM. Each workload ran in shared/dedicated/dedicated/shared order: two measured runs per configuration. All 144 comparison submissions were accepted with 100 points.

Both configurations used the same **1792 MiB reservation pool**, existing compiler allowances, 256 MiB per-job padding and fresh memory guard. Six diagnostic graders were pinned to CPUs 0–5. The dedicated configuration additionally ran the actual two-slot compiler supervisor on CPUs 6–7. The shared configuration used the previous six-worker scheduler and selective pipeline, with a three-compilation ceiling; this pool admitted at most two concurrent compilers.

| Workload | Shared median batch | Dedicated median batch | Dedicated elapsed change |
| --- | ---: | ---: | ---: |
| Compilation-heavy | 22.83 s | 25.46 s | +11.5% |
| Execution-heavy | 13.03 s | 13.94 s | +7.0% |
| Mixed | 17.77 s | 20.50 s | +15.4% |

Positive elapsed change means a slower dedicated batch. Batch time ends at the final saved result; container startup and teardown are excluded.

| Workload / configuration | Batch range | Throughput from median batch | Median of per-run p95 completion | Median initial queue wait |
| --- | ---: | ---: | ---: | ---: |
| Compilation-heavy / shared | 22.56–23.10 s | 31.5 jobs/min | 22.68 s | 9.39 s |
| Compilation-heavy / dedicated | 24.40–26.52 s | 28.3 jobs/min | 25.31 s | 10.95 s |
| Execution-heavy / shared | 12.95–13.10 s | 55.3 jobs/min | 12.67 s | 4.45 s |
| Execution-heavy / dedicated | 13.51–14.38 s | 51.6 jobs/min | 13.57 s | 4.97 s |
| Mixed / shared | 17.74–17.80 s | 40.5 jobs/min | 17.36 s | 6.63 s |
| Mixed / dedicated | 20.48–20.52 s | 35.1 jobs/min | 19.73 s | 7.28 s |

The sum of recorded compiler wall-times differed by less than 1% between configurations in each workload. Overlapping compilations are counted separately in that sum. The longer dedicated batches therefore appear to come mainly from pipeline coordination, including stage transitions, wake-ups and role-specific scheduling; this benchmark does not isolate each cause.

Completion and queue waits are measured from a simultaneous burst release. These p95 values describe the 12-job batches; they are not a production latency SLA. Two repetitions per configuration provide a small controlled sample rather than a statistical guarantee.

The compilation-heavy workload includes `bits/stdc++.h`, sorts a tiny vector and prints a fixed answer. Its configured memory limit is 1024 MiB; it does not allocate 1 GiB. The execution-heavy workload uses short C++ source, touches 32 MiB of heap and consumes 1.5 CPU seconds on each of two testcases, with a 64 MiB limit. The mixed workload interleaves four compilation-heavy jobs, four execution-heavy jobs and four jobs that include `bits/stdc++.h`, touch 128 MiB and consume 0.5 CPU seconds on each of two testcases, with a 256 MiB limit. All users are distinct; additional per-user and per-problem contention was not simulated.

Both paths run the actual compiler, Isolate sandbox, scheduler, queue-notification code, memory transitions, artifact handoff and testcase judge. Disposable result persistence replaces the full production scoring tables; HTTP uploads, authentication, keyword-rule lookups and heartbeat overhead are outside the timed workload. Small diagnostic event writes are included in both configurations.

An initial higher-budget comparison used 2076072 KiB (about 2027.4 MiB). One shared compilation-heavy batch completed in 16.34 s with three compilers; two dedicated batches completed in 22.29 s and 22.20 s with two compilers. The next shared run crossed the diagnostic memory floor and was stopped. Those incomplete higher-budget trials are excluded from the main comparison. The guard was kept at 1536 MiB of guest MemAvailable; it was not lowered to finish testing. This guard event occurred with extra diagnostic processes alongside the live services and does not establish a production OOM.

Minimum guest MemAvailable across completed comparison runs: 1601.1 MiB. No comparison job needed a full-memory compilation retry. All leases, reservations and artifact metadata were cleaned after each batch. The benchmark was configured to stop on real queue activity; no real queue work was observed during the completed comparison. Production result counts and enabled flags matched before and after, and all six grader containers plus the compiler container retained their identities. Localhost and ngrok page/ping checks passed afterward.

Raw evidence: `tmp/grader-benchmark/evidence/benchmark-safe.json`. The earlier completed higher-budget trials are preserved in `partial.json`. Runtime source and harness hashes are in `source-hashes.json`. VM evidence and individual logs remain under `/opt/otog/dedicated-comparison-20261022/`. Only diagnostic containers and their disposable database were removed.
