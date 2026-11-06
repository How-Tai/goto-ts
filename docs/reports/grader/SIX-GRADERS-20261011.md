# Six-grader expansion — 11 October 2026

The later per-user concurrency setting and current active release paths are documented in `PER-USER-WORKER-LIMIT-20261011.md`. The expansion details and backups below describe the preceding release.

Deployed and verified: all six graders are connected and enabled. The live dashboard is http://localhost:3030/admin/grading (or the same path on ngrok).

## Configuration

The VM was upgraded by the user to eight virtual CPUs and 6,000 MiB configured RAM (approximately 5,781 MiB usable). Six graders use distinct guest CPUs 0–5. Guest CPUs 6–7 have no pinned grader; other VM services can still run on any allowed CPU. All graders have the same default CPU priority and no CPU quota. No Windows security settings or problem time/memory limits are changed.

The expansion preserves the exact configuration and running containers of workers 1–4. Only workers 5–6 are created, using a separate reviewed release, private checker files, read-only test data and sandbox IDs 5–6. Existing account ordering, queue advisory locks and atomic result/scoring commits remain unchanged. Separate worker heartbeats and persistent Pause settings are retained.

The additive migration `20261011090000_six_grading_workers` expands the two operational worker-ID constraints to 1–6. It inserts workers 5–6 paused and preserves existing worker state and contestant results. The authenticated admin Pause/Resume and confirmed Kill routes accept only IDs 1–6; Docker identity checks extend only to the two fixed new grader containers. The monitor samples twelve fixed services, retaining its 64 MiB limit, 5% CPU quota and ten-minute bounded history.

## Validation

- Eleven isolated queue/scoring tests passed, including six concurrent claims without duplicate jobs, account ordering, score modes, pause/restart recovery and private checker files.
- Migration checks preserved an existing worker's pause/start information and created the extra two paused.
- Six separate containers executed actual C++ submissions with six AC results, six contest scores and history entries, and no remaining leases. Disposable tests were restricted to a separate database and limited CPU usage; this was a correctness test, not a saturated performance benchmark.
- API controller/control tests accepted workers 5–6, rejected worker 7 and malformed/unauthorized requests, and rejected mismatched Docker worker identities. Cache coalescing, stale job checks, cooldown and recovery protections passed.
- Monitor tests and configuration comparison passed: every existing service definition was preserved, and the new containers have separate CPU/sandbox identities with equal priority.
- A VM reboot interrupted the first website build. Package file integrity was checked, staged sources were refreshed, and the API/website were rebuilt independently of live services.
- The full production build passed. Live idle Kill/reconnect checks for workers 5–6 preserved Pause, then both workers were enabled after confirming eight guest CPUs. The original four container IDs and start timestamps were identical before and after activation.
- Localhost and ngrok page, browser asset, authentication, API and WebSocket checks passed. Browser verification showed six connected, enabled workers with CPU assignments 0–5; a screenshot is saved at `vm-setup/six-grading-workers.png`.
- Final activation telemetry reported twelve monitored services and approximately 4,485 MiB available guest RAM. This is an idle snapshot, not a guarantee under maximum load.

## Releases and recovery

The new grader release is `/home/otog/worker-setup/six-workers-release-20261011-085105`. The original four still mount `/home/otog/worker-setup/monitor-release-20261011-064257`; preserve both directories. The active standalone website is beneath `/home/otog/otog/apps/web-six-20261011-085105`, build ID `UMlunXE-nKIoSzEkt8xZx`. The earlier controls website build is retained for rollback.

Before activation, the deployment saved a full database dump, API bundle/source, dashboard source, website service unit, monitor and Compose configuration under `/home/otog/six-workers-backups/20261011-085105`. Backups and successful verification are also saved at `D:\otog-grader\vm-setup\six-workers-backups\20261011-085105`, with release/test logs in `D:\otog-grader\vm-setup\six-workers-release-20261011-085105`. The local `vm-setup/docker-compose.vm.yml` matches the deployed six-worker configuration. No downloads or diagnostics were placed on C.

To reduce concurrency, Pause workers 5 and 6 in `/admin/grading`. Pause lets an active submission finish. For a code rollback, pause/drain the extra workers and restore the preceding API/website/monitor configuration from the backup. Leave additive database metadata in place; restoring the old database dump would discard later submissions and is not a normal rollback.

Six CPU-heavy jobs still share physical host resources. This expansion does not fix the separate Windows/VirtualBox execution/timer stalls or guarantee unchanged runtimes under saturation.
