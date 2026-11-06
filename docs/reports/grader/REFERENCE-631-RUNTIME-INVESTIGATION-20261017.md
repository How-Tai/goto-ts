# Reference 631 runtime-error investigation — 17 October 2026

> Current deployment: the later [directory-depth correction](DIRECTORY-DEPTH-FIX-20261017.md) retains runtime diagnostics and stage-aware watchdogs. Its report identifies the active source/native mounts and rollback. That separate cleanup fix does not explain this incident.

## Status

The original cause remains unconfirmed. This report does **not** claim that repeating successful tests explains or repairs the original runtime errors.

The failed isolated regression on problem 48 returned 30 runtime-error verdicts (`XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`) for accepted reference 631. Its harness raised an assertion after processing the cases. The disposable container was automatically removed, and that version of the harness did not preserve per-case sandbox metadata or stderr. That was a test-harness evidence-retention gap.

## Established facts

- The failing harness called `judge.startJudge` directly and never constructed or attached a `JobWatchdog`. It processed all 30 testcase attempts and reached its score assertion. A watchdog timeout would terminate that process with code 71 rather than complete 30 cases. Therefore the observed failure was **not a watchdog timeout**. This does not establish the underlying execution failure or exclude every unrelated infrastructure problem.
- Kernel records in the failed-test window contain no recorded OOM kill. The invalid-opcode record corresponds in timing to the deliberate `__builtin_trap` ordinary-runtime-error test earlier in the pipeline. It is not evidence identifying reference 631's exit cause.
- The exact reference subsequently passed paired old/current-candidate tests and the complete five-reference rerun.
- A deeper bounded probe freshly compiled the exact reference 20 times and executed all 30 cases each time: **600 successful executions**, alternating with/without an attached watchdog. Per-case status, CPU/memory, stderr, execution duration and executable-prefix/full-small-binary hashes were retained. No runtime failure or unexpected binary change was reproduced.
- The 600-case probe completed before the request to stop the named diagnostic container. No live worker was stopped by that request.
- Sandbox-ID/user-ID collision was investigated rather than assumed. A separate controlled test used only IDs 20 and 21. A sleeping program ran under Linux UID 60020; reference 631 then passed both in another container sharing ID 20 and in the distinct-ID 21 control. That experiment did **not** reproduce the failure and does not establish UID collision as its cause. Subsequent diagnostic validation used an unused diagnostic ID rather than a live worker ID.

The original exit signal/code, sandbox message, output-copy status and stderr cannot be recovered from the deleted container. Passing reruns do not reconstruct that missing evidence. There is currently no defensible exact root-cause statement.

## Preventing another evidence loss

Tested and deployed bounded, private runtime-error capture on all six workers:

- Capture occurs when testcase execution returns a nonzero, non-TLE result, including failures caused by invalid/missing output files.
- Records include submission attribution when a worker watchdog is attached, worker/problem/case/language, native sandbox metadata, returned exit code, output-file validation flags, a bounded stderr excerpt and executable file mode/ownership/size plus a hash of its first 64 KiB.
- Records do not copy the full submitted source, testcase input files or normal stdout. A stderr excerpt can naturally contain program-generated text or Python traceback lines; it is admin-only.
- At most 16 fixed JSON slots per worker, each capped at 16 KiB, plus one fixed temporary slot. Total record payload is bounded to roughly 1.6 MiB across six workers, excluding filesystem metadata. Restart does not erase them because they use the existing worker Logging bind mount on the VM disk on D.
- Directories use mode 0700; files use 0600. No HTTP endpoint or UI exposure was added. Executable symlinks are not followed, diagnostic-directory symlinks are refused, and ordinary permission/storage capture errors return failure without changing the contestant verdict.
- Correct answers, WA and normal TLE do not generate runtime-error records. No code is rejudged automatically to obtain evidence. Existing stage deadlines, sandbox limits, scoring, memory guard and durable retry policy are unchanged.
- Future reference runs through the current diagnostic test runner bind their private capture directory to a separate retained evidence folder before automatic container removal. This closes the disposable-harness retention gap as well as improving live-worker diagnostics.

Only `grader_safety.py` and `evaluate/verdict/main.py` changed from the stage-aware release; the same 12-file release bundle retains the other tested modules unchanged. Active overrides are `/opt/otog/grader-runtime-diagnostics-20261017/source/`. Previous compose is `/opt/otog/grader-runtime-diagnostics-20261017/compose.before.yml`.

## Validation and deployment

- Four diagnostic safety checks covered bounded retention/private modes/job attribution, executable-symlink rejection, directory-symlink rejection and non-propagating capture errors.
- Fourteen actual grading/checker tests preserved normal verdicts and captured real C++ invalid-opcode and Python exception details.
- Five accepted references passed using diagnostic box ID 20. Only test copies of the startup/box-ID whitelist were adapted; production remains restricted to IDs 1–6.
- Deployment drained existing jobs, preserved result/score/policy/retry-counter fingerprints, verified source hashes and container settings, and verified that all six private capture directories were writable without creating fabricated error records. Website/control services were not restarted.
- After deployment all six workers had fresh heartbeats; localhost and ngrok returned HTTP 200. No production submissions were rejudged during the investigation.

Evidence on D: `vm-setup/reference-investigation-evidence-20261017/` and `vm-setup/runtime-diagnostics-evidence-20261017/`.

The appropriate next step on recurrence is to inspect the preserved native status and stderr first, distinguish a real program crash from a sandbox/file-copy failure, and reproduce that specific cause. This deployment improves diagnosis; it is **not presented as a proven fix for the original unexplained event**.
