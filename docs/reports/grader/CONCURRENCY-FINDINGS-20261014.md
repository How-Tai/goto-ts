# Grader concurrency investigation — 14 October 2026

## Result

Keep the existing six workers. These short synthetic tests found the greatest throughput at six concurrent programs. They also measured a modest per-program CPU-time increase compared with solo execution. No automatic throttle, changed worker count, physical/virtual CPU assignment, priority change, or time-limit change was justified or deployed.

| Concurrent programs | Compute CPU time vs solo | Compute jobs/s | Sorting CPU time vs solo | Sorting jobs/s |
| --- | ---: | ---: | ---: | ---: |
| 1 | baseline | 3.09 | baseline | 4.20 |
| 4 | +3.8% | 11.87 | +7.6% | 14.79 |
| 5 | +2.2% | 14.97 | +8.7% | 19.15 |
| 6 | +11.6% | 16.42 | +7.5% | 22.38 |

Six-way throughput exceeded four-way throughput by approximately 38% for compute and 51% for sorting. The small non-monotonic differences between four/five/six are not grounds for claiming a universal optimal scheduling policy.

## Method and limits

Trusted synthetic C++17 programs compiled with `-O2` in the existing `otog-grader:glibc-20261012` image. Workloads were a deterministic integer-compute loop and sorting one million 64-bit integers. Work per process was calibrated to roughly a quarter-second of CPU time. Cohort members started together, pinned to VM CPUs 0 through N-1 to match the grader CPU layout.

Three rounds interleaved/reversed concurrency levels 1, 4, 5 and 6 to reduce ordering bias. Results use medians. Each process reported its own Linux CPU time, wall time, peak memory and deterministic checksum. Checksums matched within cohorts. Peak memory was about 11.4 MB per process; these were not memory-pressure tests or sustained thermal tests.

The container had networking disabled, a read-only root, dropped capabilities, the VM user's identity and a 256 MB memory limit. It used only the dedicated probe directory. The first compilation attempt encountered a write-permission error under dropped capabilities; it was corrected by running under the directory owner's identity before any load testing occurred.

No contestant code, testcases, submissions or verdicts were used or changed. These are CPU-contention probes, not exact isolate grading/verdict benchmarks. They do not establish how all real submissions, longer workloads or memory-heavy programs scale, nor a fixed supported-user count.

## Continuity

Original enabled flags were saved. New grading claims were paused, active grading was allowed to finish, and the bounded probes ran while real graders had no jobs. Flags were restored immediately afterward. All six grader container identities and start times matched before/after, and the website services were healthy. The website remained available; new jobs could wait briefly during the controlled comparison.

Previous queue-efficiency improvements remain active. A separate load balancer or resource throttle was not added. Raw samples, probe source, saved flags and verification are in `D:\otog-grader\vm-setup\concurrency-probe-evidence-20261014.tgz`.
