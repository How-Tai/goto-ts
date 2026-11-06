# Memory Limit Exceeded verdict — 31 October 2026

The grader now distinguishes kernel-confirmed testcase memory-limit kills from ordinary runtime errors. These results use `MEMORY_LIMIT_EXCEEDED`, display **Memory Limit Exceeded** in the submission dialog, and use **M** in the compact result string. Overall submission status remains `reject`, as with TLE and RE.

## Enforcement and classification

- Each testcase receives a fresh memory-only cgroup below its grader's existing Docker cgroup. The problem's limit is set before the payload starts; swap is disabled for that testcase.
- The sandbox's trusted Isolate metadata must report an OOM kill, and its own fresh `memory.events.local` must record a local OOM. Container or host memory pressure becomes an infrastructure error rather than a contestant MLE.
- Contestant stderr, exit code 137, and signals alone cannot produce MLE. Ordinary segfaults and aborts remain RE. Compiler failures remain CE.
- This changes runtime enforcement from virtual address-space reservation to charged memory. Large untouched virtual mappings can succeed; touched allocations, stack, and other memory charges count toward the limit. Displayed memory retains the existing peak RSS metric and can differ from cgroup memory charges.
- Every testcase starts with fresh counters, including the first testcase after compilation. Its cgroup is removed during sandbox cleanup.
- The native Isolate patch adds a memory-only cgroup mode while retaining the previous rusage CPU timer. Compiler address-space limit remains 384 MiB. Docker memory, swap, PID, and CPU limits remain in force above the worker and testcase groups.
- Telemetry reads the common Docker parent so resource charts include both the worker and its testcase.
- Custom checker compilation is unchanged; custom checkers are **not cached**.
- Existing verdicts are preserved. Rejudging is required to replace an old RE with MLE under the new enforcement.

## Validation

All 16 isolated sandbox checks passed, including bounded C/C++/Python heap exhaustion and stack growth producing MLE; accepted, wrong-answer, CPU-time-limit, syntax-error, segfault, abort, explicit exit 137, and forged OOM stderr controls; untouched virtual allocation; independent per-case peaks; recovery after OOM; and preservation of CPU timing.

The full worker → disposable PostgreSQL database → authenticated candidate API path passed for MLE, RE, and AC. The worker remained alive without a restart. Test containers, database, and temporary credentials were removed afterward.

API and frontend builds, generated database/contract schemas, schema/UI rendering tests, and existing account-rate-limit, performance, and announcement-editor regression checks passed. Monitor aggregation checks passed.

## Deployment and maintenance

Release: `/opt/otog/mle-verdict-20261031`; application workspace: `workspace` beneath that directory. All seven configured workers use the new memory modules and native binary through persistent Compose bind mounts and `OTOG_MLE_CGROUP=1`. Selected grader count, contest queue priority, per-user cap, and watchdog behavior are preserved. Workers are drained and restarted individually.

The additive database migration is `20261031010000_memory_limit_verdict`. The enum remains safe to retain during rollback. The rollback helper restores the original affected grader mounts and entrypoint, removes the feature flag, and drains/restarts each worker while retaining the newer API/frontend so previously recorded MLE results remain readable. Application overrides can be removed separately if required. Release backups are private under the release directory.

Helper: `tmp/mle-verdict-20261031/run.py`; deployment and validation evidence: the release's `evidence` directory. Do not delete active release directories or existing source mount parents.

Final live checks passed: build `Xp80V7inDgKeKYpEHYgq3` is served publicly; login and API ping return HTTP 200; all seven workers have fresh heartbeats and the new memory controller. Five remain selected on CPUs 0–4, with workers 6–7 disabled on the ordinary CPU pool 5–7. The per-user cap remains three, memory reservations remain off, and each Docker container retains its 1536 MiB limit. API, web, monitor, and graders are healthy. Local and VM grader maintenance source copies are synchronized.
