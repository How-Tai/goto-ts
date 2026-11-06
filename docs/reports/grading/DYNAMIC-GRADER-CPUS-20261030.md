# Dynamic grader CPU allocation — 30 October 2026

Later benchmark: all counts 1–7 were measured with 100 users. See [CONTEST-GRADER-SCALING-20261030.md](../contests/CONTEST-GRADER-SCALING-20261030.md). Original count 6/pause settings were restored. Four concurrent real submissions were preserved; current real totals are 33 users, 626 submissions/results, next submission ID 774. Public ngrok connectivity was recovered using a runtime DNS correction.

Deployed to `/admin/grading/`, frontend build **DHODduCgir_ORaB2TGHQ9**. Selecting N graders reserves CPUs **0 through N−1** for their independent compile/evaluate workers. All remaining CPUs join the website/API/database/storage/ordinary-service/login pool.

| Selected count | Grader CPUs | Ordinary CPUs after draining |
| --- | --- | --- |
| 1 | 0 | 1–7 |
| 3 | 0–2 | 3–7 |
| 6 | 0–5 | 6–7 |
| 7 | 0–6 | 7 |

The dashboard hides worker rows and service telemetry entries outside the selected count. Retiring workers remain visible while they own a submission or are cleaning its sandbox, with a “Finishing, then releasing CPU” status. The dashboard displays the actual ordinary-service CPU pool during transitions. Total VM resource charts still describe all eight virtual CPUs.

The selected count remains **6**. All seven workers were individually paused before this release; those pause states were preserved. Selected count and individual temporary pause state are distinct: pausing a selected worker does not change the selected CPU allocation. Selecting a different count enables its first N workers after the host allocator completes placement. The original seven grader processes and containers were not restarted or recreated.

## Transition ordering

`otogGraderAllocation` stores the desired count and requested/applied revisions. The admin API atomically records a request and disables excess workers under the same worker-row locks used by queue claims. Additional workers remain disabled until host placement is verified.

The persistent `otog-grader-allocation.service` reconciles desired state. It keeps CPU 7 for ordinary services in every configuration. For a decrease, job leases **and** memory reservations retain the outgoing worker's CPU until sandbox cleanup releases it. Remaining ordinary CPUs can be noncontiguous while jobs finish. For an increase, ordinary services move off the newly reserved CPUs before their graders can claim jobs. A newer request superseding an in-progress allocation is detected by revision before any workers are enabled.

The allocator updates ordinary systemd service/user-slice masks, the shared service default, PostgreSQL/storage masks, grader masks, and persistent Compose settings without restarting containers. Unselected, drained graders stay ready on ordinary CPUs and cannot claim jobs; they are hidden in the dashboard. Individual resume outside the selected range or while a revision is pending is rejected. Watchdogs, sandbox limits, compilation limits, memory policy, and per-user/problem limits are unchanged.

Kernel threads, interrupts, PID 1 and VM host scheduling remain outside this service placement policy. `system.slice` retains 0–7 so Docker's sibling grader scopes can reach their assigned cores.

The allocator uses the existing application database role with a two-connection pool, a bounded localhost status/wake endpoint, one fallback read per second, and a 30-second placement audit. Matching masks avoid repeated Docker updates and systemd property writes. Requests survive missed wake-ups and allocator restarts. Its environment file contains only the database URL, is root-readable, and is not copied into evidence.

## Validation

- API/web TypeScript checks and production builds passed; focused allocation, API, actual React dashboard rendering and existing performance/startup/announcement regressions passed.
- All selected counts 1–7 were exercised on the live VM, including physical process affinity checks. Idle transitions took approximately **1.2–1.9 seconds** in the final check. These are configuration-settlement times, not request-performance benchmarks.
- Rapid selection changes converged. Restart recovery retained manual pauses. A request made while the allocator was stopped stayed pending without prematurely enabling its extra grader and completed after the service restarted.
- One ordinary previously accepted C++ solution ran on worker 7 while the selected count decreased to 6. It was accepted. **33 busy samples** retained CPU 6 for grading; the retiring state was observed, and CPUs 6–7 joined the ordinary-service pool after cleanup. Non-admin allocation changes were denied.
- Synthetic account, submission, scores/results and private fixture credentials were removed. Contest 2 remains **15 October 2027, 09:00–13:00 Bangkok**. Original table fingerprints and submission counter were restored: **33 users, 622 submissions/results, next submission ID 770**.
- Final ordinary service main-process affinities are 6–7; selected grader process affinities remain their individual cores. Every grader retained its PID/container identity/restart count. Public HTTPS login/ping and the exact deployed dashboard JavaScript passed checks.
- About **4,551 MiB RAM** and **25.76 GiB disk** were available at final verification. The allocator is enabled at boot. The release rollback timer was stopped after validation.

## Locations and recovery

- Live app: `/opt/otog/dynamic-graders-20261030/workspace`.
- Previous app rollback: `/opt/otog/grader-selector-20261030/workspace`.
- Host allocator: `/usr/local/lib/otog/grader-allocation.cjs`, service `otog-grader-allocation`.
- Read-only localhost status: `http://127.0.0.1:8766/status`; bodyless POST `/wake` is only a hint to read durable state.
- Canonical source: `tools/grader-allocation/allocator.cjs`; application/model/migration sources synchronized to `/home/otog/otog`.
- Evidence: `tmp/dynamic-graders-20261030/evidence/` locally and `/opt/otog/dynamic-graders-20261030/evidence/` on the VM.
- Manual release rollback, as root: `/usr/bin/python3 /home/otog/dynamic-graders-candidate/release.py rollback`. This stops the allocator, returns ordinary services to CPU 7 before restoring the former fixed grader masks and app commands, and restores the prior pause flags. The additive metadata table remains. Inspect newer operational changes before using a dated rollback.
