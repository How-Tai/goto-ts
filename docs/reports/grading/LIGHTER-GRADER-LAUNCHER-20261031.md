# Lighter grader launcher — 31 October 2026

Trusted infrastructure operations previously started another Python interpreter, imported `grader_safety.py`, set resource limits and then executed Isolate or another trusted command. Repeating that startup for every custom-checker case consumed measurable grading time.

The launcher now uses the existing **`/usr/bin/prlimit` from util-linux 2.41.5** in all seven grader images. It sets the same soft/hard file-size limit (64 MiB), core limit (zero), and optional address-space limit, then executes the command with a literal argument delimiter. No packages or native binaries were installed or changed. See [the util-linux manual](https://github.com/util-linux/util-linux/blob/master/sys-utils/prlimit.1.adoc).

The Python parent still owns the watchdog stage, bounded diagnostic files/reads, timeout, process session and process-group cleanup on both success and failure. Native launches preserve the worker's inherited Python signal dispositions; tests confirm matching ignored/blocked signals with the old Python helper. Images lacking `prlimit` retain the old limited Python path. Missing commands fail with a nonzero status; no unbounded fallback is used.

Only **`grader_safety.py`** changes in worker mounts. Contestant/checker limits, native sandbox controls, per-case files/memory reset, CPU accounting and queue policy remain the existing implementations. Custom checker compilation remains once per submission, with no cross-submission cache. Standard-header precompilation and contestant binary caching were not part of this change.

## Validation

All **11 launcher checks** passed: stdout/stderr/exit and literal arguments; native limit reporting; optional AS cap; inherited signals; working directory; explicit soft/hard resource values; timeout process-group cleanup; successful-command cleanup of delayed children; invalid memory-limit rejection; missing executable failure; and limited legacy fallback.

Twenty alternating no-op commands per version measured median launcher wall overhead of **72.44 ms before and 2.21 ms after**. This isolates launcher overhead; it is not a whole-grading speedup.

All **15 checker scenarios**, **16 verdict/MLE scenarios**, restricted-container checks and **208 reference testcases across nine custom problems** passed under the candidate. Tests used bounded, network-disabled containers with distinct sandbox UIDs and no production database credentials. Fixtures were private and removed after completion. No production test submissions or verdict writes were performed.

## Matched whole-grading benchmarks

Each workload ran baseline, candidate, candidate, baseline with the same source, real test data, image and security configuration. Each run compiled afresh. Tests used CPU 7 and excluded queue wait. These comparisons use the current machine conditions and five-grader configuration; older timings from different loads should not be substituted for their baseline.

| Workload | Baseline runs | Candidate runs | Median before → after | Wall time reduction |
| --- | --- | --- | --- | ---: |
| Bottle Match, 72 cases | 10.7295 / 11.0578 s | 5.2359 / 5.6094 s | **10.8937 → 5.4227 s** | **50.2%** |
| Scary Spider (Hard), 10 cases | 3.5718 / 3.6139 s | 3.4212 / 3.4432 s | **3.5929 → 3.4322 s** | **4.5%** |

Every benchmark run passed all cases with 100 points. For Bottle Match, checker launch/execution time fell from 6.1001/6.2448 seconds to 0.8412/0.8098 seconds across 72 calls. For the standard batch problem, initial sandbox setup fell from 0.1479/0.1515 seconds to 0.0091/0.0089 seconds. Standard case execution already used the direct bounded path, so its improvement is smaller.

Two samples per version demonstrate the measured change for these workloads, not p95/p99 estimates or guaranteed speedups on every submission. This targets trusted launch overhead; it does not resolve host-dependent contestant execution-time variance.

## Deployment and maintenance

Release: `/opt/otog/launcher-speed-20261031`; remote helper: `/home/otog/launcher-speed-candidate/release.py`; local helpers/evidence: `tmp/launcher-speed-20261031/`. Persistent Compose mounts select the immutable tested `grader_safety.py`. The rollout drains each configured worker before recreating it and uses compare-and-set restoration for pause flags. Current selected counts, CPU routing and manual operational changes are preserved.

Live verification completed at approximately **12:12 Bangkok time**. All seven configured workers have the verified module and fresh heartbeats, zero container restarts since recreation, and no observed watchdog/recovery-restart messages. Worker/container local OOM counters are zero. The queue was idle after deployment, so no additional production submissions were created to manufacture a live test; the offline reference tests cover full grading without persistence.

The selected count remains **five**: CPUs 0–4 for graders, 5–7 for ordinary services and movable kernel work. Allocator revision 66 is settled with no errors or draining workers, and unselected graders 6–7 remain disabled. All existing container limits, security controls and other source mounts were verified unchanged. Public login and API ping returned HTTP 200. About 4462 MiB RAM and 19.31 GiB disk were available. Private fixtures and disposable containers were removed; VM and Windows maintenance sources match the tested deployment.

Rollback, as root: `python3 /home/otog/launcher-speed-candidate/release.py rollback`. It restores only this module's prior mount and rolls workers, retaining the newer standard/custom checker and kernel-isolation improvements. Inspect newer changes before using an old rollback.
