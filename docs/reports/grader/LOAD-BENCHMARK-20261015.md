# Judging load benchmark — 15 October 2026

The six graders remain enabled. No worker count, priority, CPU assignment, time limit, service code, contestant submission or verdict was changed. New claims were temporarily paused for the controlled comparison; saved enable flags were restored and all six worker container IDs/start times matched afterward.

## CPU time under parallel load

Each cell is the median CPU time for this concurrency divided by the median solo CPU time, minus one. This directly compares the CPU-time metric read by the production grader.

| Simultaneous programs | Compute | Sorting | Text input/output |
| ---: | ---: | ---: | ---: |
| 1 | +0.0% | +0.0% | +0.0% |
| 2 | +2.1% | +0.6% | +8.4% |
| 3 | +2.6% | +0.1% | +20.3% |
| 4 | +4.2% | -0.1% | +28.0% |
| 5 | +4.5% | +0.6% | +32.1% |
| 6 | +8.5% | +7.1% | +37.5% |

## Individual times and total throughput

| Workload | Solo CPU median | Six-way CPU median | Six-way slowest CPU | Solo jobs/s | Six-way jobs/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| compute | 0.4765 s | 0.5170 s | 0.5890 s | 2.06 | 10.79 |
| sort | 0.4730 s | 0.5065 s | 0.5480 s | 2.08 | 10.96 |
| stdio | 0.5060 s | 0.6955 s | 0.9970 s | 1.85 | 6.09 |

The compute/sort medians increased about 7–9% at six-way concurrency, consistent with the earlier short probes. Text I/O was more sensitive: its median CPU time increased about 37%, while the median sandbox wall time rose from 0.4955 s to 0.8545 s.

The matched-VM-CPU median ratios were also calculated to check CPU-selection bias: compute +8.1%, sort +6.7%, stdio +37.7%. The largest six-way individual increases against the same VM CPU’s one solo sample were compute +23.7%, sort +13.7%, stdio +92.5%. These maxima are observed outliers, not predictions or upper bounds. At five-way concurrency sorting also had an isolated 0.702-second sample; a low median does not imply uniformly low variation.

Throughput includes synchronized launch, sandbox execution/teardown, checksum/output verification, and supervisor overhead, but excludes compilation, testcase download, queue claiming, scoring and database writes. Six-way throughput was compute 5.23× solo, sort 5.28× solo, stdio 3.29× solo. Faster throughput and slower individual runs can coexist.

## Method

- Same installed `otog-grader:glibc-20261012` image, C++17 `-O2`, isolate sandbox, no control groups inside isolate, and CPUs 0–5 matching the production grader assignments. Isolate CPU/memory/wall limits and stdout/stdin redirection follow the production approach. Test ceilings were raised to 5 CPU seconds / 11 wall seconds / 256 MiB so fixed work completed instead of being censored by TLE.
- Trusted deterministic workloads only: integer compute loop; repeatedly sorting one million 64-bit integers; scanf/printf integer text input/output. The last deliberately produces substantial output, so its result should not be generalized to every input-heavy solution.
- Fixed work calibrated once to approximately 0.5 CPU second: {"0": 9, "1": 4, "2": 1700000}. Every concurrency level ran exactly the same work and input. Six rounds with reversed/interleaved concurrency order and rotating workload order; CPUs rotated so all six CPUs contributed solo baselines.
- 108 timed cohorts / 378 sandboxed program executions. All deterministic checksums and output hashes matched. Sandbox-reported CPU time is process CPU accounting at its normal precision; small CPU/wall discrepancies reflect separate clocks and accounting granularity.
- One dedicated temporary container, six sandbox boxes, no network, read-only root, dedicated writable benchmark files, no production data/credentials mounted. Privileged container support matches the existing isolate requirement. Its outer 768 MiB safety limit differs from the unbounded production worker containers.
- No active/queued submissions before pause. A cleanup trap and an independent 190-second watchdog restore flags on failure. The successful timed comparison took 64.7 seconds. Recorded UTC window: 2026-10-14T17:35:17Z to 2026-10-14T17:36:26Z (15 October locally).
- Initial setup attempt failed on a hard link across bind mounts before any timed runs; cleanup restored workers. File copying and watchdog cleanup were corrected, and a separate short sandbox preflight passed before the successful comparison.

## System and continuity checks

- Available guest RAM stayed at or above 2492 MiB. Swap use was 0 MiB; swap-in/out page deltas were 0/0.
- Public problem-page checks: 33 HTTP 200 responses, median 29.3 ms, maximum 145.4 ms. This is a light availability check, not a website load-capacity test.
- API, web, nginx, ngrok and monitor active after the comparison. All six original grader containers remained running without restarting; all original enable flags restored. Submission counts remained exactly 242 accepted / 151 rejected / 16 compile errors / 19 judge errors, with no active or queued jobs afterward.
- Windows 25 samples over about 50 seconds: CPU mean 23.3%, peak 27.5%; available RAM minimum 3139 MiB. Host CPU is Ryzen 7 8845HS, 8 physical cores / 16 logical processors; the VM has 8 vCPUs and 4 GiB assigned RAM.

## Interpretation and limits

Cleanup removed 910.6 MiB of generated bulk input/output files and disposable sandbox/preflight folders from the two exact benchmark releases. Sources, all raw numerical measurements, metadata and the evidence archive were retained. No production data was removed.

Load can affect the CPU-time verdict even when waiting time is excluded: cache/memory contention, frequency changes, physical host scheduling, and I/O kernel work can change the time needed to perform fixed work. This benchmark measures the combined effect; it does not identify which mechanism caused any particular spike.
The I/O-heavy result means the previous 8–12% estimate was too narrow as a general statement. It was valid only for the compute/sorting workloads previously measured. There is no universal safe percentage margin for all submissions.
These are short synthetic sandbox runs on this PC under the conditions observed, not actual contest submissions, sustained thermal stress, low-memory tests, or proof of a particular false TLE. One solo sample per CPU and six cohorts per level limit tail estimates. Real compile/checker/database activity and other Windows workloads can change results. No automatic concurrency or time-limit changes were made.

Raw evidence: `D:\otog-grader\vm-setup\load-benchmark-evidence-20261015.tgz`. Trusted sources and transport helpers are in `D:\otog-grader\vm-setup\load-benchmark*20261015*`.
