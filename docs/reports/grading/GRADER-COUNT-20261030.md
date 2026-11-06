# Selectable grader count — 30 October 2026

**Superseded later on 30 October:** unused grader CPUs now automatically join the ordinary-service pool, and unused grader rows are hidden. See [DYNAMIC-GRADER-CPUS-20261030.md](DYNAMIC-GRADER-CPUS-20261030.md). The fixed 0–6 / CPU-7 allocation below describes the earlier release.

Deployed to `/admin/grading/`. **Active graders** selects 1–7 workers. Selecting N enables workers 1–N and pauses the rest in one database transaction. The initial selection remains **6**. Individual pause/resume controls remain available. Paused processes stay ready; they do not claim new jobs. Current submissions finish when a worker is disabled.

| CPUs | Persistent allocation |
| --- | --- |
| 0–6 | Seven independent grader containers, one core per worker |
| 7 | Website, API, database, storage, ordinary services and login sessions |

CPU 6 remains reserved for grader 7 even when that grader is paused. This replaces the preceding 0–5 / 6–7 allocation. Kernel threads, interrupts and VM host scheduling remain outside this service placement policy. The parent `system.slice` still spans 0–7 so Docker grader scopes can reach their assigned CPUs.

The seventh container copies the existing grader's image, sandbox, strict compiler budget, memory/process/inode limits, notification queue and watchdog configuration. Its entrypoint and main process accept worker ID 7. The original six containers were not restarted or recreated. The API, frontend, worker-control broker and telemetry monitor were restarted for deployment. PostgreSQL and storage CPU masks were changed without restarting their containers.

The dashboard now classifies jobs by compiler-state membership, so direct grader 7 is counted as grading rather than as the former compiler slot 7. Restart controls support all seven workers and the deployed patched grader image. The broker still accepts only verified grader identities and exact read/restart routes. Its legacy overescaped path regex was corrected and tested against unrelated containers and operations.

The per-user selector also accepts 1–7, while retaining the previous setting of 5. Memory reservations and problem-specific admission limits are preserved. The migration widens operational metadata constraints and inserts worker 7 paused; it refuses to run while dedicated compiler slots exist. No contestant result schema changed.

## Verification

- API and web TypeScript checks and production builds passed. API build and frontend build ID **5tRzmPQiG0iTQqvmTyZM-** are active.
- Focused transaction/request validation, existing performance/startup/announcement regressions, and actual React dashboard rendering passed.
- Authenticated live requests selected every count 1–7. Invalid values and unauthenticated requests were rejected. Worker 7 pause, restart, preserved pause state and stale restart protection passed.
- One previously accepted ordinary C++ solution was compiled and accepted by worker 7 on CPU 6. Pausing it after claim still allowed completion, in about **3.62 seconds** after the upload. This is a functional check, not a throughput benchmark.
- All temporary data and contest scheduling changes were restored. Submission numbering is restored to next ID **770**, with **33 real users and 622 submissions/results**. Temporary account credentials and source copies were removed.
- Seven fresh heartbeats, worker affinities, ordinary service masks, deployed JavaScript chunks, local health and public HTTPS login/ping checks passed. Final available RAM was about **4,623 MiB** and free disk **27.84 GiB**.

## Release and recovery

Current application workspace: `/opt/otog/grader-selector-20261030/workspace`.
Previous frontend: `/opt/otog/startup-efficiency-20261028/workspace`.
Previous API bundle: `/opt/otog/page-load-20261026/workspace/apps/api/dist/index.js`.
Persistent Compose file: `/home/otog/otog/docker-compose.vm.yml`.
Shared ordinary-service CPU default: `/etc/systemd/system/service.d/90-otog-housekeeping-cpus.conf`.
Canonical application and grader maintenance sources were synchronized.

Local evidence: `tmp/grader-selector-20261030/evidence/`.
VM evidence and snapshots: `/opt/otog/grader-selector-20261030/evidence/`.
The deployment rollback timer was stopped after all checks passed. Manual rollback is available as root with `/usr/bin/python3 /home/otog/grader-selector-candidate/release.py rollback`. It pauses worker 7 and waits for its current lease, restores prior application commands, service masks and Compose configuration, and stops worker 7. The additive database constraint widening is retained. Inspect newer operational changes before invoking an old rollback.
