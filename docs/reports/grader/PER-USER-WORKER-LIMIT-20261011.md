# Maximum workers per user — 11 October 2026

The subsequent CPU sampler and rejudge timer fixes, current API/monitor release and backup are recorded in `CPU-AND-QUEUE-TIMING-20261011.md`. The six grader and standalone website paths below remain active.

Deployed on the Linux VM and verified in the administrator's browser. Open http://localhost:3030/admin/grading (or the same path on ngrok), choose **Maximum workers per user** under **Grading settings**, then **Save**. The integer range is 1–6 and the current/default value is 1. This is a global cap for each account across all problems: 3 allows up to three separate submissions from an account to be graded simultaneously. Six workers remain available in total; a larger cap does not create additional workers or parallelize one submission's testcases.

The value is stored in PostgreSQL and survives application and VM restarts. Changes affect new claims. Lowering the cap lets already running jobs finish before admitting more jobs for that account. Admin authentication and strict integer validation are required.

## Queue and scoring

All six workers now mount the same reviewed release. Short transaction-level account locks serialize queue claims and score commits, while contestant programs may execute concurrently. Counts use worker ownership records, including a job whose status was externally changed during a rejudge. The oldest unowned waiting submission for each account is eligible first. Worker session locks, unique leases, independent sandbox IDs, private checker files and existing pause/recovery protections are retained.

Result, verdict, contest scoring and lease release commit atomically. Completed score history is recalculated in submission-ID order, preserving latest-submission, best-score and best-subtask behavior when jobs finish out of order. Rejudge history entries without completed results are excluded until their results are available. No problem time/memory limits or Windows security settings changed. Higher parallel execution still shares host resources and does not resolve the separate VirtualBox stalls.

## Verification

- Sixteen queue/scoring regression tests passed, including simultaneous claims, cap 3, lowering 2 to 1 while jobs run, ownership during requeue, reverse completion, rejudging and concurrent score commits.
- Six disposable containers ran six actual C++ jobs for separate users, followed by six actual jobs from one account. The same-account run reached exactly three concurrent jobs, never exceeded three, and saved all six AC results and correct score/history with no remaining leases.
- Real PostgreSQL tests passed for persistent settings, cache invalidation and queue waiting reasons. HTTP tests covered integer bounds, malformed bodies, anonymous/ordinary-user rejection and existing worker controls.
- API type checking/build and the full production website build passed. Localhost and ngrok pages, assets, authentication endpoints, API and WebSocket forwarding passed.
- Activation backed up the database and code, paused new claims, waited for active jobs to finish, then restarted the six workers and API/website. Previous worker Pause settings were restored. All six workers reconnected on guest CPUs 0–5.
- Browser Save was tested with value 2, then restored to 1 and verified after a page reload. The final dashboard showed six connected/ready workers and an empty queue. Screenshot: `vm-setup/per-user-worker-limit.png`.

Disposable test scripts use a separate guarded database and bounded CPU usage. These are correctness checks, not a saturated performance benchmark. Future runtime tests are pinned to guest CPUs 6–7, with 0.25 CPU quota per test worker; production worker settings are untouched.

## Releases and recovery

Active worker release: `/home/otog/worker-setup/user-limit-release-20261011-105431`.

Active website: `/home/otog/otog/apps/web-user-limit-20261011-105431/.next/standalone/apps/web-user-limit-20261011-105431/server.js`, build ID `XJI-SOeA7Hmp9s2vQkVzz`.

Pre-update backup: `/home/otog/user-limit-backups/20261011-105431`, copied to `D:\otog-grader\vm-setup\user-limit-backups\20261011-105431`. Release/test evidence is in `D:\otog-grader\vm-setup\user-limit-release-20261011-105431`. The local `vm-setup/docker-compose.vm.yml` matches the active configuration. Preserve current and previous release directories. Backups and evidence were saved on D:.

For ordinary code rollback, set the limit to 1, pause/drain all workers, restore the preceding Compose/code, API bundle and website service unit from the backup, recreate the workers, and restore their previous Pause flags. Leave the additive settings table in place. Do not restore the database dump during routine rollback: that would discard newer submissions.
