# Isolated worker checks, 17 October 2026

The custom-checker memory and standard-comparison memory findings below were subsequently addressed in [the verified checker hardening release](CHECKER-MEMORY-HARDENING-20261017.md). This document records the earlier investigation.

No new submission-triggered worker crash was reproduced in this bounded run.

The final run exercised the deployed worker's actual main loop, judge, compiler, evaluator, Isolate binary, filesystem reset and watchdog. Only the queue/database/heartbeat adapter was replaced with local stubs, and the worker-ID whitelist in diagnostic copies was extended to reserved ID 20. No live credentials or problem data were mounted. No production configuration, queue, submissions or results were written.

Eight scenarios were each followed by a normal accepted C++ solution in the same worker process:

| Scenario | Expected and observed |
| --- | --- |
| Ordinary runtime fault | Runtime error |
| CPU timeout | TLE |
| Invalid C++ | Compilation error |
| Invalid UTF-8 output | WA |
| 192 MiB allocation against declared 128 MiB limit | Runtime error; subsequent normal job AC |
| At most 5,000 file-creation attempts, stopping at failure | AC; subsequent normal job AC |
| 48 MiB ASCII output line | WA |
| 48 MiB line followed by a four-byte Unicode character | WA |

All 16 checks matched both expected status and result symbol. The container exited normally with code 0, without OOM or a watchdog/recovery exit. All checks used the same worker process. The diagnostic container was removed afterward.

The diagnostic used CPU 6, network none, a 256 MiB private tmpfs with 4,096 inodes, a 128-process cap, and 768 MiB container memory. Live graders have 1,536 MiB each. This was a finite regression run rather than exhaustive fuzzing or proof that crashes are impossible. A host-side 150-second cap and 1.5 GiB available-RAM abort protected the live VM; neither abort condition triggered. The minimum sampled available RAM was 1,850,004 KiB. Some resource contention from any diagnostic is possible; no live worker was stopped or restarted.

The six live container identities remained unchanged and all were running. Final live health verification found six enabled workers with fresh heartbeats, no active jobs or retry rows, and HTTP 200 from localhost and ngrok.

## Remaining review findings, not reproduced crashes

- Custom checker subprocesses have wall-time and output/file limits, but do not have a separate memory cap; they share the worker's container budget. A buggy checker processing contestant output could therefore still exhaust that budget. No submission-only reproduction was established here.
- The standard checker reads whole text lines. The two 48 MiB line tests survived, but that does not establish a constant memory bound for all reference/output combinations.
- An inode cap limits allocated filesystem objects, not every hard-link directory entry. Hard-link entry growth was not tested in this run.
- The in-process watchdog cannot guarantee recovery if Python itself, the kernel, Docker or the entire VM stops scheduling. Docker restart and durable retry handling remain separate safeguards.

Raw final evidence: `vm-setup/defensive-worker-evidence-20261017-v2/report.json`, `runner.json`, `progress.json`, and `console.log`. An earlier preliminary run is retained separately; the final memory probe accepts only if an over-limit allocation unexpectedly succeeds, so a rejection meaningfully tests the limit. No changes were deployed.
