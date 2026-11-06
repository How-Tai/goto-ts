# Grader isolation review — 31 October 2026

Read-only inspection of the live VM and grader sources, plus inert local fixtures. No contestant programs, attack submissions, rejudges, service restarts, package upgrades, or production configuration/database changes were performed. SSH helper files were staged under `/home/otog/grader-security-review-20261031`. Evidence is retained under `tmp/grader-security-review-20261031` without environment values or credentials.

The review found concrete hardening gaps and one unrelated availability fault. It did not demonstrate a sandbox escape, inspect every checker implementation, or constitute an exhaustive current CVE scan. An absence of a demonstrated exploit is not proof of safety.

**Remediation completed later on 31 October:** findings 1–4 were addressed by the [grader hardening release](GRADER-HARDENING-20261031.md); finding 5 was addressed by [CPU-allocation recovery](../operations/CPU-ALLOCATION-RECOVERY-20261031.md). The findings below retain the original pre-remediation evidence. The trusted worker's required setup capabilities and shared VM kernel remain architectural limits, as described in the hardening notes.

## Findings and recommended order

### 1. Sandbox binary lacks newer upstream security hardening

**Confirmed:** all workers mount the same native release; `isolate --version` reports **2.1.2**, with the existing cleanup and memory-only cgroup patches. The exact release source has no seccomp syscall filter. The outer worker processes also report `Seccomp: 0`.

Upstream's [release history](https://github.com/ioi/isolate/blob/master/NEWS) lists **2.7** as the newest published version in NEWS. Seccomp filtering arrived in 2.4, additional caller-privilege fixes in 2.5, and further shared-memory/filter hardening in 2.6. This is a compiled-from-source component, so upgrading Ubuntu packages alone does not replace this mounted binary.

Important qualifications: the current grader already supplies private `/dev/shm` and temporary directories, mitigating the documented shared-memory configuration problem. The live binary is root-owned mode 0755, without setuid. Contestants do not control the outer Isolate invocation. Upstream's caller-side privilege fixes therefore do not establish a reachable remote escape here.

**Next step:** build a maintained upstream version separately, reapply/review the narrow local cleanup and memory-only timing changes, and verify verdicts, MLE, CPU timing, startup, and teardown before rolling deployment. Avoid replacing the executable blindly: the current Python memory setup relies on exact native cgroup behavior.

### 2. Privileged Docker containers provide limited containment after an inner escape

**Confirmed on all seven workers:** `Privileged=true`, UID/GID 0 for the worker, full effective capabilities, writable root filesystem, and `NoNewPrivs: 0`. AppArmor is enabled on the VM, but privileged Docker mode weakens the normal container confinement. There is no Docker socket mounted in the workers, and PID/cgroup namespaces are private.

The contestant payload is separately switched to its sandbox UID/GID by Isolate. These worker-root observations do **not** mean ordinary contestant code currently executes as root. However, a bug that compromises the worker or its privileged setup code would have a much larger impact than a confined non-root process. Docker describes privileged containers as having broad device/capability access in its [runtime privilege documentation](https://docs.docker.com/engine/containers/run/#runtime-privilege-and-linux-capabilities).

**Next step:** reduce privileges only after a separate compatibility test of required mounts, namespaces, devices, and cgroup delegation. Longer term, a dedicated grading VM, separated from the web/database VM, provides a stronger boundary. Removing `privileged` immediately could break the current sandbox setup; upstream also discusses container limitations in its [manual](https://www.ucw.cz/isolate/isolate.1.html).

### 3. Custom checker execution is outside contestant isolation and inherits root

**Confirmed:** `evaluate/verdict/cppCheck.py`, `thaco.py`, and `ogogi.py` call `infrastructure_command`. The helper preserves credentials and ultimately calls `os.execvp`; the worker invoking it is root. Checkers read contestant-controlled output. A memory-safety error or unsafe parsing in a checker could therefore compromise a highly privileged process. No such checker exploit was attempted or demonstrated.

There are meaningful availability controls: checker execution has a 60-second deadline, a 512 MiB per-process address-space limit, bounded captured diagnostics/file sizes, and process-group cleanup. These are resource controls, not a privilege boundary. Checker compilation also remains trusted and outside contestant Isolate.

**Next step:** execute checkers under a separate unprivileged identity and restricted filesystem/network view, with only the required input, answer, contestant output, and result channel. Retain compilation per submission; this recommendation does not involve caching custom checkers.

### 4. Two custom checker source filenames are copied into contestant boxes

**Confirmed with an inert fixture using the exact live `handle.prepareEnv`:** `check.cpp` and `interactive_script.py` are excluded, but `thaco.cpp` and `partial.cpp` are copied into the contestant directory as readable files. Test `.in`/`.sol` files were not copied by this function.

This exposes those checker sources to a submission for relevant problems. The impact depends on whether they contain private constants, embedded answers, or logic intended to remain confidential. It is not itself a sandbox escape, and exposing ordinary checker logic is not automatically an incorrect verdict.

**Next step:** exclude all supported checker implementation filenames while preserving the libraries intentionally provided to contestants. Validate each checker style and problems with linked interactive libraries.

### 5. CPU-allocation controller is failing to start

**Resolved after this review:** the user requested this fix first. See [CPU-allocation recovery](../operations/CPU-ALLOCATION-RECOVERY-20261031.md). The original finding below describes the pre-repair snapshot.

**Confirmed live:** `otog-grader-allocation.service` repeatedly exits with systemd status **226/NAMESPACE**. The journal identifies the missing path `/run/systemd/system.control`; the unit requires this path in `ReadWritePaths`. The process fails before running the allocator program. This is an availability/configuration fault, not evidence of an attack.

The existing assignments remain installed: five active grader containers use CPUs 0–4, and the two unselected containers use CPUs 5–7. API, web, and monitor are active, and all seven grader containers are running without restarts. A newly requested grader-count change cannot reliably be reconciled while this controller is down.

**Next step:** create the required root-owned runtime directory through a boot-persistent mechanism, then restart and verify the allocator without changing the user's selected count. Preserve its existing systemd restrictions.

## Protections verified in the reviewed deployment

- Runtime uses Isolate, switches to sandbox credentials, and does not request host-network sharing or enable extra contestant processes. Compilation permits up to 64 processes under its separate wall and address-space limits.
- Docker limits remain 1536 MiB memory with no additional swap allowance, 128 processes, and 256 MiB scratch tmpfs with 4096 inodes per worker.
- MLE setup gives each testcase its own memory cap and checks fresh kernel OOM records. It does not expose the cgroup filesystem in the contestant's configured root.
- Output collection rejects symlinks/non-regular files and uses nonblocking opens. Cleanup restricts target paths and handles deeply nested trees.
- Startup, queue admission, grading stages, and cleanup have watchdog coverage. Scratch cleanup happens before the free-memory admission check, addressing the earlier retained-scratch stall pattern.
- Standard answer checking reads bounded chunks; invalid contestant UTF-8 becomes WA rather than a worker fault.
- The grader's seven live database sessions use `otog_grader_runtime`, whose role flags exclude superuser, role/database creation, and row-security bypass.
- Shared problem data and mounted grader code are read-only to the containers. Logs and the disabled compilation-pipeline store are writable, but are masked out of the contestant root.
- Host hardlink/symlink protections are enabled. Runtime diagnostics are bounded. No Docker socket is mounted in grader containers.

The memory and PID limits still do not reserve total future VM demand. Memory reservations are disabled by the user's current configuration; simultaneous allocations can cause pressure despite admission checks. This remains a shared-resource availability consideration rather than a newly reproduced fault.

## Evidence

- `evidence.json`: allowlisted live Docker/security configuration and grader source snapshot.
- `followup.json`: exact native source/version, runtime file permissions, role flags/session names, and sanitized allocator diagnostics.
- `offline-checks.json`: inert checker-file-copy fixture plus assertions about reviewed source controls; no untrusted programs executed.
- `live-source/`: allowlisted first-party source used for the review. No database configuration or secret environment files are included.
