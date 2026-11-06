# CPU measurements and rejudge queue time — 11 October 2026

Current API/website deployment and stale-reading protection are documented in [RESOURCE-FRESHNESS-20261011.md](RESOURCE-FRESHNESS-20261011.md). The monitor and queue migration described below remain deployed.

Deployed and verified. The dashboard at http://localhost:3030/admin/grading now receives corrected CPU samples and measures waiting time from the latest queue entry. The current maximum workers per user remains 3.

## CPU measurements

Container CPU percentage now uses Docker's paired cumulative CPU and system counters: CPU delta / system delta × online guest CPUs × 100. The time spent collecting other services or waiting for Docker replies is excluded from the denominator. Host service process CPU counters use timestamps captured when their own `/proc` counters are read. Restarted processes, missing samples, reset counters and changes in CPU count reset the baseline and produce an unknown first reading instead of a fabricated percentage. Valid multi-CPU readings are retained; values are not clamped to 100%.

The four service metadata reads remain batched, with their deadline increased from two to five seconds. A failed sample remains explicitly unavailable. The monitor still has its 64 MiB memory limit, 5% of one CPU quota, low priority and 120-sample bounded history. The service CPU scale remains 100% for one virtual CPU; the machine chart uses 100% for the entire VM. This corrects sampling delays and does not resolve the separate VirtualBox stalls or guarantee perfect counters during a host/guest timer failure.

## Queue time

The additive `20261011120000_submission_queue_time` migration adds `submission.queuedAt`. New submissions receive the default timestamp. A database trigger records the request's statement time whenever status is explicitly set to waiting, covering individual/bulk rejudges, repeated rejudge requests and worker recovery. Unrelated edits and the transition to grading leave this time intact. Existing waiting jobs are initialized from their last update because older queue-entry events were not recorded separately.

The dashboard reads this field for waiting duration. Original submission dates, worker claim priority and scoring order are preserved. The query continues to order rows by creation date/ID independently of their displayed queue age. Existing API/client code does not need a generated Prisma client update because the dashboard queries this operational field through raw SQL and the trigger handles writes.

## Validation and deployment

- Eight monitor tests passed, including collection delays, known single/multiple CPU usage, invalid/reset counters and service-specific read times.
- Eighteen disposable PostgreSQL queue/scoring tests passed. New tests cover resetting a days-old submission's queue time, unchanged original dates/claim order and unrelated edits. Existing ownership, concurrency, pause/recovery and score modes passed.
- Real PostgreSQL/API query checks passed for individual/repeated/bulk rejudge timestamps, stable queue ordering, per-user settings and scheduling reasons. Admin HTTP/validation/cache tests, API type checking and the full API build passed.
- The first disposable run exposed missing test mounts and an existing nondeterministic test assumption about worker 4 being idle. The setup was corrected and the test now uses an actually unowned worker. The complete rerun passed.
- Deployment saved the database and previous API/monitor source and bundles. Only the API and resource monitor restarted. All six grader container IDs/start times were identical before and after deployment, and all original submission creation dates were checked unchanged.
- Live authenticated loopback verification and browser inspection returned twelve running services with numeric CPU readings and no warnings, six connected/enabled graders, and the preserved per-user cap of 3. No actual contestant submission was rejudged for validation. Screenshot: `vm-setup/corrected-cpu-readings.png`.

## Release and recovery

Timing release: `/home/otog/worker-setup/timing-release-20261011-113554`; staged API source/build: `/home/otog/otog/apps/api/.timing-api-20261011-113554`. The deployed API uses `/home/otog/otog/apps/api/dist`, and monitor source remains `/opt/otog-monitor/monitor_agent.py`. Graders and the standalone website retain the user-limit release paths recorded in `PER-USER-WORKER-LIMIT-20261011.md`.

Backup: `/home/otog/timing-backups/20261011-113554`, copied to `D:\otog-grader\vm-setup\timing-backups\20261011-113554`. Test/release evidence is in `D:\otog-grader\vm-setup\timing-release-20261011-113554`. All added backups/evidence are on D:.

For routine rollback, restore the prior API bundle/source and monitor file from this backup, then restart only those services. Leave the additive queue column/trigger in place; the preceding application safely ignores it. Do not restore the database dump during code rollback because that would discard newer submissions. Preserve prior release directories and backup files.
