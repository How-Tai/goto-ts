# Contest grading priority

The queue now selects eligible submissions in this order:

1. Submissions linked to a contest currently running (`timeStart <= now < timeEnd`).
2. Other submissions linked to a contest, including historical contest rejudges.
3. Practice submissions without a contest ID.

Within each group, the oldest `queuedAt` wins, then submission ID. A rejudge joins its group at the time it was requeued instead of jumping ahead because of the submission's original creation date. Priority uses the submission's actual `contestId`; a practice submission to a problem that also appears in a contest remains practice work.

The global candidate selection, same-user earlier-job filter, and fresh eligibility check after obtaining the user lock all use the same priority key. This lets a user's contest submission overtake their queued practice work. Currently running jobs finish normally. Concurrency caps, per-problem limits, memory admission, leases, notifications, watchdogs, sandbox limits and judging verdict logic retain their existing behavior. A blocked contest job does not prevent another eligible job from running. Practice jobs may wait longer during sustained contest traffic; no aging or dedicated practice slot was added.

Running contest IDs are evaluated by PostgreSQL once per statement using a non-correlated array subquery; schedule changes apply on the next claim. No schema migration or new dependency is required. Contest schedules and submission IDs/source are not changed.

Maintained queue source: `tools/grading/worker_queue.py`. Test: `tools/grading/test_contest_priority.py`. VM release and evidence: `/opt/otog/contest-priority-20261030` and `tmp/contest-priority-20261030/evidence` locally.

Tests run actual PostgreSQL claim transactions with the deployed grader dependencies in a bounded container on CPU 7. A disposable database is explicitly named and removed afterward. No contestant programs execute and no production submissions or results are changed. Checks cover all priority classes, same-user precedence, queued-time FIFO and ID ties, contest schedule transitions, pause/row-lock handling, admission limits, and seven concurrent claimers honoring a per-user cap of two without duplicate leases.

The isolated claim timing check includes establishing a fresh database connection for every claim, unlike persistent production connections. Seven samples per size, median before/after: 100 queued, 17.5/18.6 ms; 1,000 queued, 19.8/40.1 ms; 5,000 queued, 18.3/23.7 ms. This is a small scheduler overhead check, not an end-to-end contest benchmark or percentile estimate.

Deployment updates the persistent Compose queue bind mount and drains/recreates one grader at a time. It preserves manual pauses and uses a compare-and-set when restoring a temporary pause, respecting concurrent allocation or administrator changes. Existing images, other mounts and resource limits are verified after rollout. API/frontend services do not need a restart.

Deployed successfully to all seven graders. Live queue bind source is `/opt/otog/contest-priority-20261030/worker_queue.py`; previous source `/opt/otog/independent-graders-20261024/source/worker_queue.py` is retained. All seven workers are enabled with fresh heartbeats, selected count remains seven, and the per-user cap remains seven. Images, other bind mounts, resource limits and allocation settings were verified unchanged. The existing restricted grader database role already had the needed contest schedule read permissions. Public HTTPS login and API ping returned 200. Disposable database and credential environment file were removed. VM and Windows grader maintenance copies were synchronized.
