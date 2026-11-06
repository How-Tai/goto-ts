# Grader concurrency benchmark — 17 October 2026

Compared 6 and 12 independently sandboxed jobs on the same six VM CPUs, using the active grader image and source overrides. Production worker settings were not changed.

Each configuration graded the same 24 synthetic C++ submissions per workload, three times with alternating order. Each submission compiled once and ran three testcases with filesystem resets and the standard checker. All 288 submissions (864 testcases) were accepted under a deliberately generous 5-second testcase limit.

| Workload | Concurrent jobs | Batch time, median (s) | Jobs/s | Job service time, median (s) | Job service p95 (s) | Testcase CPU median (ms) | Testcase CPU p95 (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| sort | 6 | 10.740 | 2.235 | 2.543 | 2.787 | 489.500 | 509.000 |
| sort | 12 | 10.136 | 2.368 | 4.814 | 5.015 | 500.000 | 526.000 |
| stdio | 6 | 11.057 | 2.171 | 2.603 | 2.968 | 164.000 | 209.000 |
| stdio | 12 | 10.545 | 2.276 | 5.061 | 5.363 | 172.000 | 236.000 |

Service time starts when a diagnostic worker receives a job and excludes its queue wait. Batch time includes completing all 24 jobs. Testcase CPU time is the grader’s reported contestant execution time; compilation and checker overhead are included in job service time but excluded from testcase CPU time.

- sort: throughput +6.0%; median active-job latency +89.3%; median reported testcase CPU time +2.1%. Paired throughput changes across three trials: +5.8%, +9.7%, +2.4%.
- stdio: throughput +4.9%; median active-job latency +94.4%; median reported testcase CPU time +4.9%. Paired throughput changes across three trials: +0.7%, +11.4%, +4.9%.

Minimum VM available RAM during the test: 1.78 GiB. Total benchmark duration including warm-up and startup: 146.8 seconds.

Limitations: this measures execution-slot concurrency using separate containers as a safe proxy for concurrent tasks inside a worker. It does not implement or test a thread-safe multi-task production worker. All twelve diagnostic containers remained alive for both settings, providing the same idle-process overhead. Live graders stayed idle. Input caches were warm. Network downloads, production database scheduling/results, custom checkers, memory-heavy problems and real user traffic were excluded. Three repetitions characterize this short test, not every workload. A 5-second test limit was used to collect timing rather than induce TLEs.

Safety: diagnostic sandbox IDs 20–31, no network or production data mounts, automatic abort for pending real submissions, stale live heartbeats or available RAM below 1.5 GiB. Disposable diagnostic containers removed afterward. Production worker identities, enabled flags and compose hash checked unchanged.

Raw evidence: [report.json](../../../grader/vm-setup/concurrency-benchmark-evidence-20261017/report.json).
