# Beautiful Number submission 377 — 12 October 2026

Read-only diagnosis completed around 11:03 Bangkok. No production submission, limit, result or worker setting was changed by this investigation.

## Confirmed verdict and identical-source comparison

Problem 4, Beautiful Number, has a 3,000 ms limit, 256 MiB memory limit and 67 testcases.

Submission 377 was already being regraded when inspected; this investigation did not start that regrade. It completed at 11:01:51 Bangkok with score 40 and a maximum testcase time of 3,070 ms. Subtask 4 case 10 timed out at 3,053 ms; subtask 5 case 14 timed out at 3,070 ms. Completed non-timeout cases were accepted; later cases in the affected subtasks were skipped.

Its exact source SHA-256 is `fc015bd5db2e5ccb792a2af85ef520b8d724aa46c7a18d718e2dbceea9fb60b0`. The same source occurs in earlier AC submissions including 176 (2,295 ms), 355 (2,298 ms), 356 (2,339 ms), 369 (2,487 ms), 373 (2,549 ms), 372 (2,630 ms), 371 (2,669 ms) and 357 (2,879 ms). Identical-code submissions also have TLE results, including recent regrades 365 and 367. The observed verdict difference is a timing issue, not a source-code difference. Historical results alone do not prove unchanged hardware, compiler, testcase contents or load at each execution.

The program builds divisors and pair-product counts up to the maximum query and then examines pairs of divisors. It uses fast C++ stream settings. This is meaningful computation and allocation, rather than a missing fast-I/O setting. Earlier diagnostics tested the identical source on three copied heavy cases using the current glibc image, and it took approximately 2.87–2.93 CPU seconds: already close to the production 3-second cutoff.

At one point in the current regrade, only one worker job was active and no submissions were waiting. Guest memory had about 2,524 MiB available and zero swap usage. No kernel lockup or OOM warnings were found in the inspected current boot. These are snapshots, not proof of the absence of all transient interference.

## The approved backend change did not take effect

Windows was restarted at 10:53:20 Bangkok, after the boot-setting change at 10:50. The current boot entry matches the saved entry and still has `hypervisorlaunchtype Off`. However, Windows reports HypervisorPresent=true, running VBS and running Memory Integrity. Memory Integrity's registry Enabled value remains 1.

The VM started afterward. Its current VirtualBox log still reports AMD-V unavailable and NEM fallback with `Snail execution mode is active`. All six graders use `otog-grader:glibc-20261012` with guest CPU affinities 0–5. Consequently, the program has not yet been tested under direct AMD-V following the approved change.

Microsoft explains that [VBS can force the hypervisor on despite the boot setting](https://devblogs.microsoft.com/oldnewthing/20180130-00/?p=97925/). Oracle documents [VirtualBox performance problems with the Windows hypervisor](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/Troubleshooting.html). This supports explicitly addressing the remaining Memory Integrity configuration, but does not prove that this backend alone caused every testcase slowdown.

## Additional step — applied after explicit approval

The prior application changed only the boot flag, as promised. The user subsequently explicitly approved switching Memory Integrity off without restarting. The separate helper `vm-setup/set-memory-integrity-native-amdv-20261012.ps1` changed only the Memory Integrity registry Enabled DWORD from 1 to 0 at 11:08:54 Bangkok. The new value was independently read back as 0. This explicitly disables the protection after a Windows restart. The original value and a 418-byte export of the relevant registry key are saved on D in `vm-setup/native-amdv-20261012`. Disk-encryption protection, lock/mandatory and enforcing-policy checks passed. Defender and all firewall profiles remain enabled. Secure Boot and firmware AMD-V were not modified; Windows features were not uninstalled. The VM was not stopped and Windows was not restarted.

The helper supports `-Mode Restore` to restore Enabled=1. To restore the entire performance experiment, also run `set-native-amdv-20261012.ps1 -Mode Restore` to return the original boot flag to Auto, then restart Windows. No full-registry or full-boot-store import is needed.

The setting is applied but awaiting a coordinated Windows restart. The current running Windows session still reports Memory Integrity and VBS active; changing the configuration does not unload them immediately. After the restart, verify that Windows no longer reports a running hypervisor and the new VM log confirms direct AMD-V. Then repeat a diagnostic with copied inputs and measure submission 377's source before deciding whether to rejudge live results. No time limit was raised and no manual AC verdict was assigned.

After the Memory Integrity setting was applied, API, website, nginx, ngrok and monitoring services were active, all six grader containers were running, PostgreSQL was healthy and MinIO was running. The website returned HTTP 200. The administrator helper completed and exited, with no ongoing diagnostic task.

## After the second Windows restart

Direct AMD-V with nested paging is now confirmed, and Windows no longer reports running VBS or a hypervisor. The user's subsequent regrade of 377 completed at 11:34:24 Bangkok with AC, 100/100 and 2,128 ms maximum testcase time, compared with the previous TLE at 3,070 ms. Source hash is unchanged. This read-only check did not initiate that regrade or alter the time limit. Other matched-source improvements are recorded in `D:\otog-grader\NATIVE-AMD-V-RESULTS-20261012.md`.
