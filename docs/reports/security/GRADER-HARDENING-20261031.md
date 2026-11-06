# Grader hardening — 31 October 2026

Later on the same day, [checker setup was optimized](../grading/CHECKER-SPEED-20261031.md): native box initialization is once per submission, with files and memory groups reset for each case and fresh namespaces still created on every execution. The description below records the original hardening rollout; the later release replaces its checker and filesystem-cleanup Python mounts while retaining its native binary and container controls.

This release addresses the four remaining findings in `GRADER-SECURITY-REVIEW-20261031.md`. The CPU-allocation controller was repaired separately first. Application builds and database schemas did not need to change.

## Changes

- **Isolate upgraded from 2.1.2 to 2.7**, pinned to official commit `8f185bb37f3f23e29b33b0c7727c91c13429abe3`. The build retains the existing descriptor-bounded cleanup traversal and memory-only cgroup option. The original rusage CPU timer is preserved. Upstream syscall restrictions are enabled. See the [upstream release history](https://github.com/ioi/isolate/blob/master/NEWS).
- **Docker privileged mode removed.** Containers drop all capabilities and explicitly add only `SYS_ADMIN`, `NET_ADMIN`, `SYS_CHROOT`, `SETUID`, `SETGID`, `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, and `KILL`, which Isolate's setup requires. Docker's default seccomp filter, `no-new-privileges`, and an enforcing `otog-grader` AppArmor profile are active. The profile permits sandbox mount setup and private-cgroup remounting, while denying root-filesystem remounting and retaining protected `/proc` and `/sys` rules.
- **Container root filesystems are read-only.** Required runtime writes use bounded tmpfs mounts. Existing logs and the disabled compilation-pipeline store retain their existing scoped mounts; no Docker socket or host disk devices are exposed. The existing private cgroup filesystem is remounted writable inside its own cgroup namespace, rather than bind-mounting the host hierarchy.
- **Custom checkers compile and execute inside a separate Isolate box.** Checker IDs are `100 + workerId`, distinct from contestant boxes and UIDs. Checkers receive no database environment, have their own PID/network/filesystem namespaces, zero effective capabilities, and syscall restrictions. Their view contains trusted helper files and only the current testcase, contestant output, and submitted source. Legacy `check.cpp`, fractional `thaco.cpp`/`partial.cpp`, and Python postprocessing interfaces remain supported.
- **Custom checker compilation is not cached across submissions.** Its private binary is compiled once during each job, used for that job's cases, then removed. Compilation has a 120-second budget and 768 MiB address-space/group limit. Execution retains a 60-second budget and 512 MiB address-space limit, with an additional 512 MiB group cap. Fresh checker boxes/counters prevent case-to-case state retention. These budgets are separate from contestant TL/MLE accounting.
- **Private checker sources excluded from contestant compilation.** `check.cpp`, `thaco.cpp`, `partial.cpp`, and `interactive_script.py` are excluded; intended problem libraries remain available.
- **Checker diagnostics stay private.** A failing checker's stderr is not included in contestant-facing problem-error messages because it may contain hidden testcase data.

Stored testcase permissions are preserved. Files already readable by the checker can be bound read-only; owner/group-only input or answer files receive independent read-only copies of the current case inside bounded private scratch. No permission changes are applied to shared stored testcase data.

## Validation

- All **16** bounded verdict/MLE tests passed under the restricted container settings: AC, WA, RE controls, C/C++/Python/stack MLE, TLE, CE, virtual-memory reservation, per-case reset, recovery after MLE, and CPU timing. A 200 ms CPU workload still reported approximately 204 ms.
- **13 checker regression scenarios** passed, including supported checker formats, partial scores, accepted/wrong-answer results, compilation again on the next submission, private source exclusion, private-input permissions, unprivileged identity, empty capability set, seccomp/no-new-privileges, absent worker environment/network, current-case-only exposure, fresh filesystem state, and confidentiality of checker errors.
- Nine existing accepted submissions passed **all 208 testcases** across every custom problem with an accepted reference available: problems 1, 44, 48, 67, 69, 70, 71, 72, and 73. Results remained 100 points. This was offline grading with no production verdict writes. Problem 68 had no accepted reference; its legacy checker interface is covered by fixtures and related real problems.
- A real hardened worker processed MLE, RE, and AC jobs against a disposable PostgreSQL database. Persistence and authenticated HTTP response checks passed; the worker stayed alive without a restart. The disposable database and environment files were removed.
- Benign container probes verified enforcing AppArmor, seccomp/no-new-privileges, private cgroups, read-only root, denial of root remounting, absence of host disk devices, and absence of the Docker socket.

The reference runs confirm compatibility, not a controlled performance comparison. Checker isolation adds setup/copy overhead. Contestant time limits still use the same CPU timer and exclude checker execution; the reference wall-clock durations include compilation, checking, preparation, and shared VM service activity.

## Deployment and maintenance

Release: `/opt/otog/grader-hardening-20261031`. The official native source and binary are under `isolate/`. Initial Python sources are under `tools/grading/`; the final checker error-reporting revision is under `final/tools/grading/checker_sandbox.py`. Persistent Compose mounts refer to these immutable release files. The enforcing profile is installed as `/etc/apparmor.d/otog-grader` and is loaded by AppArmor at boot.

The rollout drains each worker's jobs and reservations before recreating it. Compare-and-set restoration preserves concurrent manual pause changes and current selected-count revisions. Existing memory/swap/PID limits, contest priority, per-user cap, memory-reservation preference, and CPU allocation are retained. The native version and container security properties are verified per worker afterward. API/web services are not restarted.

Final live validation passed on all seven configured workers: Isolate hash/version, enforcing filters, read-only root, nine allowed capabilities, fresh heartbeats, and unchanged Docker memory/swap/PID limits. The user changed operational settings during the work; the final selection is **seven graders** on CPUs **0–6**, with CPU **7** for ordinary services, and a per-user cap of **seven**. The allocator applied revision 65 without errors. These live preferences were preserved rather than restoring the older six-grader snapshot. Public login and API ping returned HTTP 200; no production results were rewritten. About 4531 MiB RAM and 21.46 GiB disk were available at final verification.

Canonical sources are under `tools/grading`. VM and local grader maintenance checkouts are synchronized after verification. Release helpers/evidence are under `tmp/grader-hardening-20261031` locally, `/home/otog/grader-hardening-candidate`, and the release's `evidence` directory on the VM. Private configuration and reference sources are excluded from fetched evidence.

Rollback helper: `python3 /home/otog/grader-hardening-candidate/release.py rollback`, as root. It restores only affected grader security settings and source mounts from the saved baseline, then drains/recreates workers individually while retaining current CPU selection. This returns to the previous, less restrictive isolation and is for recovery, not routine operation. The additive MLE schema and existing application remain unchanged.

## Remaining boundary

The trusted worker still runs as root with the capabilities required to construct Linux sandboxes, including `SYS_ADMIN`. Contestants and checkers run as separate non-root identities. Removing privileged Docker mode and narrowing mounts/devices/filtering reduces exposure, but containers still share the VM kernel. A separate grading VM would provide a stronger boundary from web/database services. This release is not proof against every kernel or sandbox vulnerability.
