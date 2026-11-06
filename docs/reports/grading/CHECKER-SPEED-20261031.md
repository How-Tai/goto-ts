# Faster isolated custom checking — 31 October 2026

Custom checker jobs previously ran native Isolate cleanup and initialization before every testcase. The checker now initializes once per submission, restores an empty private working directory between cases, and tears down the native box at the end of the job. This removes two trusted helper process launches from each subsequent case.

The compiled custom checker remains private to that submission. It is compiled again for the next submission; there is no cross-submission checker cache.

## Boundaries retained

- Every native `--run` still creates fresh PID, IPC, network and mount namespaces. Reusing Isolate's initialized working-directory setup does not reuse a running checker or its namespaces. See the [Isolate manual](https://www.ucw.cz/isolate/isolate.1.html) and the pinned upstream `isolate.c` implementation of `run()`.
- Before resetting checker files, the trusted worker kills and drains only its own checker cgroup. It removes and recreates that cgroup before each compiler/checker invocation, so peak memory and OOM counters start fresh. Memory caps are set before launch, swap remains disabled, and OOM kills apply to the group. See the [kernel cgroup v2 interface](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html).
- Checker working files and private `/tmp`, `/var/tmp` and `/dev/shm` directories are replaced between cases. Cleanup accepts only the exact current worker's checker box path, with the existing descriptor-safe deletion checks and bounded fallback.
- Read-only helper mounts, current-case-only input/answer visibility, separate non-root identity, cleared capabilities, syscall filters, private checker diagnostics and watchdogs remain active.
- Contestant CPU timing and problem TL/ML settings are unchanged. This optimization targets total grading latency, especially custom/interactive problems with many cases. It does not fix host-dependent contestant runtime variance.

## Validation and deployment

Candidate release: `/opt/otog/checker-speed-20261031`. Only `checker_sandbox.py` and `sandbox_security.py` change in production workers; application services, queue selection and native Isolate remain the existing versions. Persistent Compose mounts select the immutable candidate files after testing. Workers drain and restart individually, preserving concurrent manual pause and CPU-count changes.

The checker suite verifies accepted/wrong/partial verdicts, fresh files and temporary directories, per-case memory peak reset, private diagnostics, recovery after checker error, one initialization/cleanup per submission, and recompilation on the next submission. Additional validation covers the existing 16 verdict/MLE scenarios, restricted-container properties, and accepted reference submissions for nine custom problems (208 cases).

The benchmark runs the same 72-case Bottle Match reference submission under baseline and candidate code in alternating order (baseline, candidate, candidate, baseline). Each run compiles contestant and checker afresh, uses the same image/security settings, and writes no production verdicts. Benchmark containers run sequentially on guest CPU 7, which also hosts ordinary services. All seven production graders were busy throughout, with 403–410 submissions waiting at the start of each run. Results measure end-to-end grading excluding queue wait. No synthetic workload runs on the production grading CPUs.

| Run | Baseline seconds | Candidate seconds |
| --- | ---: | ---: |
| First | 46.5327 | 21.8803 |
| Second | 45.8043 | 23.0074 |
| Median | **46.1685** | **22.4439** |

The candidate used **51.4% less wall time**, approximately **2.06 times the speed**, for this workload. Median checker-box setup/reset time fell from **23.2917 s to 0.2593 s**. All four benchmark runs passed all 72 cases with 100 points. Two samples per version establish a substantial improvement for this problem; they are not p95/p99 estimates or a universal speedup for all problems.

All **15 checker regression scenarios**, **16 verdict/MLE scenarios**, restricted-container checks, and **208 reference testcases across nine custom problems** passed. The checker peak-memory test fell from 37,093,376 bytes in one case to 3,534,848 bytes in the next, demonstrating fresh per-case counters. The existing 200 ms CPU-timer control reported 204 ms. The supported checker styles, per-submission compilation, private diagnostics and non-root filtered identity were verified.

Deployment completed at approximately **11:10 Bangkok time**. All seven workers run the verified candidate modules, retain the existing native binary and security settings, and have fresh heartbeats with zero container restarts since recreation. No watchdog or recovery-restart messages were observed. Their logs record **128 production jobs completed since their updates** at the final check; these are jobs from the user's existing queue, not diagnostic submissions.

The selected count remains seven: grading CPUs 0–6, ordinary services CPU 7, allocator revision 65 with no draining workers or errors. Per-user cap seven, disabled memory reservations and compiler-job setting ten were preserved. Public login and API ping returned HTTP 200. About 3849 MiB RAM and 19.34 GiB disk were available. Test containers and private reference fixtures were removed. VM and Windows grader maintenance copies match the tested module hashes.

Helpers and non-private evidence are under `tmp/checker-speed-20261031/`; remote helpers are under `/home/otog/checker-speed-candidate`. No bulk rejudge was triggered by the deployment.

Rollback: `python3 /home/otog/checker-speed-candidate/release.py rollback` as root. It changes only the two affected mounts back to their recorded sources and rolls workers individually; it does not restore a dated copy of CPU settings or rewrite submissions.
