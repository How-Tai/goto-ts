# Testcase filesystem isolation — deployed 16 October 2026

## Correction after Crystal Mine infrastructure failures

The initial release contained an integration error: its path guard accepted only `/var/local/lib/isolate/0/box`. The live worker entrypoint wraps Isolate with `--box-id=$OTOG_WORKER_ID`, selecting IDs 1–6. Initial disposable tests invoked Isolate directly with its default ID 0, so they missed this difference. Live compilation was refused before any testcase ran, causing Judge Error for Crystal Mine submissions 663, 664 and 665.

The corrected release is **`/opt/otog/grader-case-reset-20261016-v2`**. It validates the sandbox against the configured worker ID, retains the exact canonical path and symlink checks, and rejects another worker's sandbox. The file-reset behavior and compilation-once design remain intact.

All 17 isolation checks passed through the actual production entrypoint for **each of IDs 1–6** (102 checks). All 15 complete reference suites were then repeated through that entrypoint, including Crystal Mine's 49 cases and the 726 private cases overall. Only after these tests were all six live workers updated. Scores/policies remained unchanged during deployment; concurrent administrator pause/resume changes were respected.

The three affected submissions had already been requeued by an administrator. Their actual completed results were verified without duplicate rejudges: **664 and 665 accepted with 100 points; 663 rejected with runtime errors (`X`)**, with no Judge Error remaining. This report does not diagnose the separate runtime failures in 663.

Final health checks found all six workers enabled/connected, the control broker accepting all six, localhost/ngrok responding, and the memory admission/per-problem limits intact.

Corrected `sandbox_security.py` SHA-256: `5db6cb0178de5dd35af4eda16f088710762e4f2ebdd61b582f085e6bf008254d`. `execution.py` hash is unchanged. Updated evidence: `hotfix-adversarial-tests.json`, `hotfix-real-grader-regression.json`, `hotfix-deployment.json`, `hotfix-live-status.json`, `crystal-rejudge.json`. The initial performance results below are measurements of the algorithm with default ID 0; the production-wrapper checks measured reset-only medians of approximately 1.5–1.8 ms on this later run.

**Do not roll back to the initial reset release**, which has the incorrect ID-0 guard. For a full pre-reset rollback, use the earlier `/opt/otog/grader-case-reset-20261016/compose.before.yml` after pausing and draining workers. The v2 backup contains the defective v1 overrides and is retained for forensic comparison.

The original reproduction printed `0 1 0 1 0 1 0 1`: contestant-created files survived between testcases of the same submission. A fresh submission cleared the file. The grader initialized Isolate once and reused its writable directories for all cases.

## Deployed behavior

Compilation still occurs once per submission. After a successful compile, the grader saves an independent baseline of the compiled program, source and permitted problem libraries. It excludes stdout, stderr and compiler diagnostic logs. The baseline is root protected, outside the contestant's accessible mount view, and inside the existing bounded Isolate tmpfs.

Before each testcase, the grader removes the previous writable box and copies the clean baseline back in-process. This avoids launching Isolate cleanup and initialization again. It preserves directory/file permissions and ownership, copies symlinks without following them, and does not use hard links. Restoring includes executable and library contents, rather than trusting filenames or timestamps.

`/tmp`, `/var/tmp`, `/dev/shm`, `TMPDIR` and the main working directory now use the testcase's private files. The earlier tests found that `/tmp` and `/dev/shm` could otherwise retain files even after resetting `/box`.

Output collection refuses symlinks, FIFOs, directories, devices and oversized files, avoiding privileged reads outside the sandbox or blocking on an unsafe output file. An unsafe contestant output produces a runtime failure. Missing or failed filesystem baseline restoration refuses execution.

## Measured overhead

Thirty paired samples per executable, alternating reset/no-reset order after warmup, inside a disposable container on VM CPU 6 at nice 19:

| Executable | No reset median | Reset median | Median paired added time |
|---|---:|---:|---:|
| 15,960 bytes | 6.723 ms | 7.866 ms | 1.100 ms |
| 8,404,640 bytes | 6.929 ms | 17.000 ms | 9.643 ms |

The normal small-executable test adds about 0.033 seconds across 30 cases, or 0.11 seconds across 100 cases. These are measured examples; larger compiled trees and concurrent host load can change overhead. Filesystem setup is outside the submitted program's reported CPU time. Time limits and scoring were not changed.

## Verification

- Sixteen adversarial and compatibility checks passed, including C/C++/Python alternating-bit programs, nested directories with zero permissions, temporary storage, modified source/executable/library files, symlinks, unsafe outputs, timeout recovery and missing-baseline rejection.
- All three alternating-bit programs printed zero on every testcase after the fix.
- Fifteen complete reference solutions received full marks, including existing custom-checker coverage and all 726 private testcases for problems 57–66.
- Validation containers had no network or production database credentials; real testcase mounts were read-only. No production submissions were created or rejudged for validation.
- New claims were briefly paused; active jobs completed normally before all six workers were recreated. Original pause states were restored with timestamp guards that preserve concurrent administrator actions.
- Historical results, contest scores and grading policy fingerprints matched before/after replacement. Website services did not restart.
- Final checks confirmed all six workers enabled and connected, all six accepted by the worker-control broker, localhost/ngrok home and public problem endpoints returning 200, the 1.5 GiB memory admission guard retained, and NPK Tull (55) restricted to one worker.

## Deployment and recovery

Root-owned runtime files: `/opt/otog/grader-case-reset-20261016/sandbox_security.py` and `execution.py`. All six compose services mount these files read-only over the existing security image. This preserves the worker image identity accepted by the API and narrow worker-control broker. Other mounts, credentials, CPU allocations, restart policies and resource limits remain unchanged.

The pre-change compose file is retained root-only at `/opt/otog/grader-case-reset-20261016/compose.before.yml`. The rollout automatically restores it if replacement verification fails while claims remain paused. A later manual rollback must also pause and drain workers before restoring the compose file and recreating only graders; never restore a database backup to undo this filesystem fix.

Source hashes:

- `sandbox_security.py`: `942a1e5d1894857f99fa36001eb6c00ae4e846251179428bc6cafc24c6a07c94`
- `execution.py`: `02b583e7bac7752fa0c295c359449539cb3dcaa10e4fb0e04be9e051c9a31456`

Sanitized reports are in `vm-setup/case-reset-evidence-20261016/`: `adversarial-tests.json`, `real-grader-regression.json`, `paired-benchmark.log`, `deployment.json`, and `live-status.json`.

This fixes filesystem persistence between testcase processes. It does not claim to eliminate hardware contention or every possible timing channel.
