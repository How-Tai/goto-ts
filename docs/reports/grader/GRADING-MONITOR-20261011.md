# Grading dashboard deployment — 11 October 2026

The current per-user concurrency setting and active release paths are documented in `PER-USER-WORKER-LIMIT-20261011.md`. Historical account serialization described below was superseded by that configurable limit.

The Linux VM now runs six independent grading workers following the expansion documented in `SIX-GRADERS-20261011.md`. All six are connected and enabled; the VM has eight virtual CPUs and 6,000 MiB configured RAM. Open http://localhost:3030/admin/grading, or the same path on the ngrok domain, while signed in as an administrator. The sections below describe the preceding four-worker release and Kill-button update; the six-grader report records the current active website/release paths and backups.

## Behavior

- Queue totals and the first 100 waiting jobs, in submission order. Jobs from the same account remain ordered to preserve contest scoring.
- Four worker rows show connection, CPU affinity, current job and start time. Pause stops new claims and lets an existing job finish; the pause state survives worker restarts. Resume allows new jobs.
- CPU, memory and swap history, plus uptime, threads, memory, CPU and restart policies for ten fixed services. Unknown metrics remain visibly unavailable.
- Resource history stays in RAM for ten minutes (120 samples). There is no growing diagnostic trace.

Workers use VM CPUs 0–3, separate container filesystems, separate sandbox IDs and private checker workspaces. Large testcase input/output files are shared read-only. The VM currently has six virtual CPUs and approximately 4,797 MiB of usable RAM. This task did not change its hardware settings, Windows security, problem limits or existing contestant results.

## Implementation and overhead

API and website source is in `D:\otog`. Worker source is in `src/mainWorkers.py`, `src/worker_queue.py`, `src/worker_control.py` and `worker-entrypoint.sh`. Operational monitor source, its systemd unit, the four-worker renderer and regression tests are in `deployment/`.

The database migration is additive: worker control/lease metadata and partial queue indexes. The API uses raw SQL for this metadata; regeneration of the Prisma client was not required for this release. Pause and claim lock the same worker row. Submission results and contest scoring commit atomically. Worker and account advisory locks prevent duplicate ownership.

The dashboard polls every five seconds while visible. API reads are cached for two seconds and concurrent reads are coalesced. Service metadata is read in one fixed batch. The loopback-only monitor exposes cached read-only data and accepts no commands or destination URLs. Admin read/write routes reject ordinary users and anonymous requests.

`otog-monitor.service` starts automatically, with a 64 MiB memory limit, 5% of one CPU quota and low scheduling priority. Final verification measured approximately 21 MiB process RSS. Four worker containers restart automatically; each owns one job at a time. Same-account jobs intentionally do not grade simultaneously.

## Validation

- Eleven queue/scoring/control integration tests passed in a disposable database: concurrent claims, FIFO account ordering, scoring modes, rollback, lease recovery, pause/resume and workspace isolation.
- Four sandbox tests and four actual C++ grading/scoring jobs passed concurrently in isolated test containers/databases.
- Four monitor unit tests passed, including bounded history and batched service parsing.
- API type checking, Prisma schema validation and the full Next.js production build passed. Existing unrelated build warnings remain.
- HTTP tests covered cache coalescing, role restrictions, strict worker IDs and boolean pause requests. Real PostgreSQL dashboard queries and live production authentication checks passed.
- Localhost and ngrok pages, scripts, API/authentication/image endpoints and WebSocket forwarding passed.
- Browser verification confirmed all four workers and successful pause/resume of worker 4. All four were resumed afterward.
- Six final monitor samples returned ten services with no warnings. All four workers had fresh heartbeats, correct CPU affinity and zero container restarts; no active leases remained at that check.

Test logs and the final six-sample check are retained under `D:\otog-grader\vm-setup`.

## Backup and recovery

The pre-deployment database dump, API bundle, website sources, service unit and compose configuration are saved both in `/home/otog/grading-monitor-backups/20261011-064257` inside the VM and in `D:\otog-grader\vm-setup\grading-monitor-backups\20261011-064257` on Windows. The current compose configuration is also saved as `D:\otog-grader\vm-setup\docker-compose.vm.yml`.

The active worker release is `/home/otog/worker-setup/monitor-release-20261011-064257`. Following the Kill-button update below, the active website is the standalone build beneath `/home/otog/otog/apps/web-controls-20261011-071950`. Preserve these directories: running services refer to them. The previous `web-monitor-20261011-064257` build remains available for rollback.

To reduce load, pause worker 4 from the dashboard; it finishes any current submission safely. Use Pause before maintenance, wait for all current jobs to finish, and shut Ubuntu down normally.

A code rollback should restore the previous API bundle and website service unit from the backup, then reload/restart those two services. To roll back worker configuration, first pause/drain the workers, then restore the previous compose file and recreate workers individually. The original `/home/otog/worker-setup` worker files were preserved. Additive metadata can remain; do not restore the old database dump during an ordinary code rollback because that would discard submissions made since the backup. Database restoration is only a separately planned disaster recovery operation.

This deployment adds visibility and grading capacity. It does not resolve the previously observed VirtualBox/Windows scheduling stalls, and four workers still share the host hardware. Increased parallel load can affect runtimes of CPU-heavy solutions.

## Follow-up: Kill button and consistent tabs

The grading page now uses the existing admin tab component, Thai labels and tab styling: โจทย์, แข่งขัน, ผู้ใช้งาน, Grading status. Browser navigation between the problem and grading pages was verified.

Each worker has a confirmed **Kill** action. It force-stops the entire selected container, including the running contestant/checker program, then explicitly restarts it. The worker recovers its own unfinished lease and returns that submission to the queue. Completed scores and its persistent Pause setting survive. Pause remains the normal way to stop taking new submissions while allowing the current one to finish.

The admin-only `POST /admin/grading/workers/:workerId/kill` requires an explicit confirmation and the worker start time/current submission displayed by the page. A worker-row lock prevents new claims during the check. The lease is read in a separate statement after that lock to reject a confirmation overtaken by a concurrent claim. Stale confirmations, overlapping requests and immediate repeated restarts are rejected. Docker container name, image, Compose project/service labels and worker-ID environment variable must all match a fixed allowlist. No arbitrary container names, commands or URLs are accepted. The API user already had Docker access; no account permissions or Windows security settings changed. Successful actions are logged with administrator, worker and submission IDs.

Validation passed for role/confirmation checks, stale jobs/start times, container identity, cooldown, concurrent calls and failure cleanup. A real PostgreSQL claim-versus-Kill race test rejected a stale idle confirmation. A disposable busy worker was killed using the real Docker HTTP transport, recovered its submission while remaining paused, and resumed to AC with exactly one result, contest score and history entry. Production verification restarted only idle worker 4 and restored its original enabled setting; no real submission was interrupted. All four workers reconnected. Existing queue/cache/Pause tests, API type checking, the production website build, localhost/ngrok/WebSocket checks and the browser confirmation/cancel flow passed.

This update changed only the API and website; worker code and problem limits stayed unchanged. Kill is for the four grading workers. Other service rows continue to show status and restart policy. A frozen VM kernel or unavailable Docker daemon can still prevent a restart; the API reports a bounded failure instead of claiming success.

The follow-up backup is saved in `/home/otog/worker-controls-backups/20261011-071950` inside the VM and `D:\otog-grader\vm-setup\worker-controls-backups\20261011-071950` on Windows. It contains the preceding database dump, API bundle/source, grading page and website service unit. Its tested release and logs are in `D:\otog-grader\vm-setup\worker-controls-release-20261011-071950`. Regression-test source is retained under `deployment/tests/`. The active website build ID is `ZwNEacS_YjkTbgO-2s67r`.
