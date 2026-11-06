# Worker availability findings — 16 October 2026

## Confirmed: contestant filesystem structure can poison cleanup

Severity: high for availability of an affected grader. A worker can remain alive and send heartbeats while being unable to initialize sandboxes for later submissions.

This was reproduced only in a disposable container with no network, production data or credentials, a 512 MiB memory limit, 128-process limit, a 64 MiB Isolate tmpfs, and the actual worker startup script with worker ID 6. No live worker was attacked, stopped, restarted or modified.

A small submitted program created a deeply nested directory tree within its permitted working directory. The program exited successfully, but Isolate's post-run filesystem traversal failed with `Cannot open directory d: Too many open files` and reported infrastructure status `XX`. Attempting the next testcase's Python filesystem reset raised `RecursionError`. Initializing a sandbox for the next ordinary C++ submission also failed; that normal submission could not compile or run.

The Python worker process itself survived. In the production worker loop these exceptions are caught and recorded as Judge Error. An alive worker does not trigger Docker's process-exit restart policy, and its independent heartbeat can remain fresh. Therefore process health/heartbeat checks alone do not detect this failure mode. The earlier normal-verdict and shallow filesystem tests did not cover hostile directory depth.

Evidence: `vm-setup/case-reset-evidence-20261016/worker-resilience-probe.log`.

### C++ confirmation

At the user's request, the same bounded directory-depth test was repeated with C++, through the production startup wrapper in a separate disposable container with the same resource limits and no production mounts or credentials. It reproduced the failure: the C++ program exited zero after about 15 ms CPU time and 1,152 KiB peak RSS, but Isolate reported `XX` with `Cannot open directory d: Too many open files`. The next testcase reset raised `RecursionError`, and a fresh normal C++ submission failed sandbox initialization. The grader process survived. Python submission availability is therefore not required to trigger this issue.

C++ evidence: `vm-setup/case-reset-evidence-20261016/worker-resilience-cpp-probe.log`. No live grader was changed or attacked, and no fix was deployed as part of the confirmation.

## Additional risks identified by code inspection

These are exposure findings, not demonstrated live-worker crashes:

- Trusted custom checker processes run outside the contestant's Isolate limits. Their captured stdout/stderr uses `communicate()` without output bounds; no separate checker memory limit is applied. Malformed contestant output could exercise a resource-intensive path or bug in a checker. The container limit is a last boundary shared with the grader process, rather than a checker-only boundary.
- The standard checker reads whole lines. Output files are bounded, so this is bounded amplification, but large single-line outputs still allocate memory and add processing outside the contestant's measured runtime.
- All six containers have individual memory limits but share the VM's finite RAM. The existing 1.5 GiB admission guard checks available memory when claiming a job; it does not reserve each newly claimed job's possible future maximum. Concurrent large compilation/checking bursts can still create aggregate memory pressure. No global OOM or VM stress test was performed.
- Isolate, the guest kernel and the compiler remain part of the security boundary. This audit does not claim that sandbox escape is impossible or that one has been found.

The Python documentation confirms that `communicate()` buffers received data in memory: [subprocess documentation](https://docs.python.org/3/library/subprocess.html#subprocess.Popen.communicate). Linux documents resource enforcement and OOM handling at cgroup boundaries: [cgroup v2 memory controller](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#memory).

## Recommended next hardening

1. Treat failed sandbox cleanup/initialization as a worker health failure, with bounded recovery rather than continuing to claim ordinary submissions with an unusable sandbox.
2. Retire/restart an affected worker after safely persisting or quarantining the triggering job. Do not repeatedly requeue the same poisonous submission without a retry bound.
3. Replace recursion-dependent cleanup with a tested approach that remains bounded for hostile directory structures; include Isolate's own post-run traversal in the design, not only the Python cleanup function.
4. Give checkers separate memory/CPU/output budgets and bound captured diagnostics.
5. Consider explicit memory reservations/admission accounting for compilation and checking, while retaining the current minimum-free-memory guard.

No remediation was deployed during this investigation; the user's request was an assessment of whether submitted code could disable a worker.

## Subsequent live incident and recovery

After the original investigation, the user submitted the directory-depth Python probe themselves. Worker 1 became unable to initialize new sandboxes. It was safely paused while idle and restarted; the old tmpfs tree disappeared, and its heartbeat and exclusive worker lock recovered. The other five workers were left running during that recovery.

Automatic exception recovery was subsequently tested and deployed to all six workers: an unexpected grading exception now saves its Judge Error and releases the lease before exiting, allowing Docker's existing restart policy to recreate the sandbox state. A real isolated C++ depth failure was followed by exactly one automatic restart and a successful ordinary C++ run. Normal verdicts do not restart workers. This contains the poisoned-worker failure; it does not fix the underlying deep-tree traversal or detect every possible silent hang or VM freeze. See [automatic recovery report](WORKER-AUTO-RECOVERY-20261016.md).
