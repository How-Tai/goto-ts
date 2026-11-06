# Faster standard batch checking — 31 October 2026

The standard checker spent substantial time comparing matching output one line at a time. Profiling accepted reference submissions found 6.67 of 11.90 seconds in comparison for Scary Spider (Hard), and 30.67 of 123.26 seconds for Beautiful Number. Filesystem reset and memory-group reset were small fractions of each run. Normal batch execution already initialized its contestant sandbox once per submission.

The new standard checker first compares decoded text in bounded 65,536-character chunks. UTF-8 validation and the existing universal-newline decoding remain active. Exactly matching decoded streams accept immediately. On any difference or decoding failure, both streams rewind and use the original comparison. This preserves trailing-whitespace rules and the existing ordering of contestant rejection versus reference-file errors. No output hashes, reference-output cache or cross-submission checker cache are introduced.

Only `evaluate/verdict/standard.py` changes in workers. Compilation, case execution, per-case filesystem/memory reset, native sandbox settings, TL/ML accounting and watchdogs keep their existing behavior. The earlier custom-checker optimization remains deployed.

## Validation

- **4,199 comparisons** matched the deployed standard checker, including random text, Unicode, CR/LF/CRLF, whitespace tails, long lines around chunk boundaries, mismatches and malformed UTF-8 in either stream.
- The **16 existing verdict/MLE integration scenarios** passed, including accepted, wrong-answer, RE, TLE, CE, actual-memory enforcement, per-case reset and CPU timing.
- A 2,000,000-byte identical multiline comparison took median **0.7919 seconds** with the deployed checker and **0.00212 seconds** with the candidate in the VM. This measures the comparison function alone, not whole-job speed.

Real-submission profiling uses unchanged accepted sources, actual problem testcases and production-equivalent container controls. Tests run in separate network-disabled containers on CPU 7 with distinct sandbox UIDs and no production database credentials. Queue callbacks are disabled and no production verdicts are written. The Scary Spider benchmark alternates baseline, candidate, candidate, baseline, compiling afresh each time. Beautiful Number has a longer baseline/candidate full-run comparison; that single pair is indicative rather than a controlled percentile estimate. Metrics contain nested categories and should not all be summed.

| Workload | Before | After | Wall time reduction |
| --- | ---: | ---: | ---: |
| Scary Spider (Hard), median of two full runs/version | 12.3144 s | 5.5853 s | 54.6% |
| Beautiful Number, one full run/version | 123.2623 s | 85.2456 s | 30.8% |

Scary Spider raw wall times were 12.0841/12.5446 seconds baseline and 5.0409/6.1297 seconds candidate. Output comparison took 7.2597/7.1654 seconds baseline and 0.0181/0.0210 seconds candidate. All four runs passed all 10 cases and scored 100. All 67 Beautiful Number cases also passed with 100 points; comparison time fell from **30.6681 s to 0.0425 s**. Its maximum reported contestant CPU time was **2191 ms before and 2163 ms after**, while summed contestant CPU changed from 70.948 to 67.496 seconds. Most of this optimization's benefit comes from eliminating comparison overhead; different machine/load conditions also contribute to whole-run differences. All seven production graders were busy when the Scary Spider runs began, with 70–72 jobs waiting.

The common fast path matched all 10 Scary Spider cases and all 67 Beautiful Number cases. For outputs that differ in accepted whitespace, or for mismatches/decoding failures, the original checker remains the fallback. Such cases may gain little and can incur an additional bounded-buffer scan. No contestant algorithm speedup, different time allowance, percentile improvement or resolution of host runtime variance is claimed.

Deployment and live verification completed at approximately **11:30 Bangkok time**. All seven graders serve the verified standard-checker module; the earlier custom-checker modules and all other mounts/security settings are unchanged. Worker heartbeats are fresh, all seven enable flags remain true, and all containers have zero restarts since recreation. Updated workers had completed **32 existing production jobs** at the final check, with no watchdog/recovery-restart messages observed. No bulk rejudge was initiated by this work.

The allocator remains at seven graders on CPUs 0–6, ordinary services on CPU 7, revision 65 without error or draining workers. Existing per-user, memory-reservation and compiler-job preferences were preserved. Public login and API ping returned HTTP 200. About 3772 MiB RAM and 19.31 GiB disk were available. Private fixtures and test containers were removed; VM and Windows maintenance copies match the tested module.

The initial final-health assertion was too strict about Docker's sticky `OOMKilled` flag. A running worker had that flag after contestant memory-limit kills. Kernel logs identified `otog-sandboxes/box-1`, while both the worker and Docker parent had zero local OOM/kill events and the worker had not restarted. Final verification now checks `memory.events.local` at both levels, along with liveness, restart counts and heartbeats, instead of interpreting descendant OOM events as worker failure. This corrects verification only; contestant memory enforcement/classification was not changed.

Release: `/opt/otog/batch-speed-20261031`; helpers: `/home/otog/batch-speed-candidate`, with local copies/evidence under `tmp/batch-speed-20261031`. Initial profiling evidence is `tmp/timing-variance-20261031/batch_profile_remote.json`. Deployment drains/recreates workers individually, changes only the standard-checker mount, and preserves current CPU-count selection and manual pause changes.

Rollback: `python3 /home/otog/batch-speed-candidate/release.py rollback` as root. It restores only this module's previous mount and rolls workers individually. It retains the earlier checker isolation/setup improvements and current operational settings.
