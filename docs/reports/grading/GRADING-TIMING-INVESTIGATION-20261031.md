# Grading timing investigation — 31 October 2026

The reported execution-time regression is real across the sampled problems. The investigation also confirms substantial custom-checker wall-clock overhead. These are different measurements and should not be conflated.

Follow-up: [the checker setup optimization](CHECKER-SPEED-20261031.md) was implemented and validated later the same day. Its alternating 72-case benchmark reduced median end-to-end grading from 46.17 to 22.44 seconds (51.4%). This addresses repeated checker setup, not the separate host-dependent execution-time variance described below.

A subsequent [standard batch-checker optimization](BATCH-GRADING-SPEED-20261031.md) was also deployed: Scary Spider (Hard) median grading fell from 12.31 to 5.59 seconds, and one Beautiful Number pair fell from 123.26 to 85.25 seconds. It removes matching-output comparison overhead while preserving the original fallback and contestant CPU timer. These results do not establish a fix for host-dependent execution-time variance.

No production verdicts, grader settings, CPU allocation, Windows power settings, or security controls were changed by these diagnostics. Tests used a separate network-disabled, resource-bounded container on guest CPU 7, distinct sandbox UIDs, and no database credentials. Private submission fixtures and test containers were removed afterward.

## Stored-results comparison

Compared current results with `tmp/rejudge-all-20261030/evidence/after.json`, matching submission ID and source hash. The table includes submissions accepted in both snapshots whose old time was at least 50 ms. It excludes TLE-censored values. Times are medians of those paired submissions, not a controlled benchmark with identical load conditions.

| Problem | Pairs | Previous median ms | Current median ms |
| --- | ---: | ---: | ---: |
| Beautiful Number | 12 | 2053 | 2868.5 |
| Scary Spider (Hard) | 28 | 173 | 350 |
| Omakaza | 15 | 267 | 411 |
| Scary Spider (Easy) | 11 | 74 | 203 |
| Fast Food | 5 | 168 | 654 |

The analysis contains 34 problems. This supports a broad regression, not a claim that every submission is slower. Some previously accepted sources now receive TLE. For example, Beautiful Number submissions 175 and 176 changed from accepted at 1591/1550 ms to TLE at 3088/3118 ms. Their source hashes match the baseline.

## Controlled native comparisons

First, one compiled CPU microbenchmark and one memory-access microbenchmark were alternated between the MLE-enabled Isolate 2.1.2 and current Isolate 2.7. All 12 runs passed and produced matching checksums. Reported CPU time exceeded the program's own process CPU clock by about 5–6 ms, with no large inflation in the current version. This is a narrow test, not validation of every timing/child-process scenario.

Next, submission 354 for Beautiful Number was compiled once with the existing `-O2 -std=c++17` settings. Its slowest stored case was resolved through the subtask description to actual input **14.in**. Database testcase indices are local to each subtask; they are not input filenames. The unchanged executable and input were alternated over three repetitions per version, rotating version order:

| Variant | Median reported CPU ms |
| --- | ---: |
| Pre-MLE Isolate 2.1.2, address-space memory limit | 1996 |
| Isolate 2.1.2 with actual-memory accounting | 1999 |
| Current Isolate 2.7 with actual-memory accounting | 2024 |

All nine runs completed with matching output hashes. Current versus pre-MLE median difference was about **1.4%**. An earlier two-version run gave 2022 ms for MLE-enabled 2.1.2 and 2037 ms for current 2.7. These short comparisons do not support attributing the much larger stored-result regression to the new timer or memory enforcement alone.

The same case's production rejudge stored **2867 ms**. The later isolated current-version median was **2024 ms**, about 29% lower. Production and isolated runs occurred at different times, CPU placements and loads; this is evidence of environment sensitivity, not a controlled proof of which host setting caused it. No artificial full-load burst was added to production grading cores during the investigation.

## CPU and memory observations

- Seven selected graders remain pinned individually to guest CPUs 0–6. Ordinary app services, PostgreSQL and MinIO are on CPU 7. The allocator reports applied revision 65 with no error.
- Sampled ordinary userspace processes consuming CPU were not allowed on the grading cores. This does not isolate kernel work or Windows host scheduling.
- Each grader has unlimited Docker CPU quota (`cpu.max = max 100000`) and zero quota-throttling events. VirtualBox has eight vCPUs with a 100% execution cap.
- Guest memory and I/O pressure averages were zero, with no swap-in/out activity during the sampling interval. Swap occupancy was only about 0.26 MiB. Available RAM was several GiB.
- The initial busy batch averaged about 85% guest CPU activity. Later, while remaining custom problems were being graded, recent CPU activity was about 16%. Queue size fell from 273 waiting to 4 during subsequent checks; changes reflect the user's existing rejudge, not diagnostic submissions.
- Windows exposes eight physical cores and sixteen logical processors. Six logical processors (0–5) were parked in two snapshots. Processor-performance counters were roughly 60–90% of nominal performance depending on logical processor/sample. The active Acer plan allows core parking (minimum 1%); its maximum CPU setting is 100% and the VM process mask allows all sixteen logical processors.
- These observations make host power/frequency, SMT resource sharing, and Windows/VirtualBox scheduling credible contributors. They do not prove thermal throttling, a fixed frequency cap, a specific physical-core mapping, or that changing one setting will eliminate variance. Guest affinity alone does not reserve physical host cores. See [VirtualBox VM configuration](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/working-with-vms.html) and [Microsoft processor power tuning](https://learn.microsoft.com/en-us/windows-server/administration/performance-tuning/hardware/power/power-performance-tuning).

## Overall verdict latency

The earlier isolated Bottle Match profile (problem 73, submission 779) passed all 72 cases and scored 100:

- Total wall-clock grading: **65.94 s**, excluding queue wait.
- Contestant CPU summed over cases: **0.872 s**; maximum case: **47 ms**.
- Checker box cleanup/initialization: **35.03 s** across 73 calls.
- Checker execution and its native sandbox launch: **18.10 s** across 72 calls.
- Contestant compilation: **5.81 s**.

Some profile categories are nested; do not sum every recorded field. This directly demonstrates a major cause of slow overall grading for this interactive workload: the checker sandbox is currently cleaned and initialized for each case. Checker execution is outside the contestant CPU measurement. It can still affect shared machine load indirectly.

A useful next optimization is to avoid repeated checker namespace/box initialization while retaining a fresh private filesystem, fresh resource counters, per-case file visibility and process cleanup. Checker compilation must remain once per submission, with **no cross-submission custom-checker cache**. Any implementation needs the existing isolation and checker regression tests before deployment; no such change was made during this investigation.

## Conclusion and limits

There are two actionable areas: stabilize host-level CPU performance under simultaneous grading, and reduce repeated isolated-checker setup cost. The newer native sandbox showed only a small CPU difference for the tested Beautiful Number case under comparable conditions. The precise contribution of host frequency, physical-core sharing and other load to the historical regression is not yet isolated by a controlled host-configuration experiment.

Do not weaken isolation or increase problem time limits based on these measurements. Do not treat load-sensitive TLE results as proof that the source became slower. A final grading baseline should be re-established under the intended sustained concurrency after performance conditions are stabilized.

Evidence: `tmp/timing-variance-20261031/` (stored-result pairs, guest/host snapshots, native microbenchmarks and Beautiful Number comparisons) and `tmp/interactive-timing-20261031/result.json`. The retained `beautiful-two-versions.json` and final `beautiful_remote.json` use the correct input mapping; initial failed diagnostic attempts were not performance results. All seven grader containers were running with restart count zero at final verification, and both diagnostic containers and private fixtures were absent.
