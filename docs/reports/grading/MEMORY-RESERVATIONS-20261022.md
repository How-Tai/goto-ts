# Grading memory reservations

Superseded by the [phase-aware update](PHASED-MEMORY-20261022.md), which
releases excess compilation reservations before testcase evaluation.

Implemented and deployed on 22 October 2026. All six graders now atomically
reserve a shared memory allowance before claiming a submission, retaining it
until sandbox cleanup finishes or the owner recovers after a container restart.
The existing 1536 MiB pre-claim guard, grading rules and per-user/problem limits
remain active. Memory-heavy jobs wait when the shared allowance is insufficient.

The operational-only migration and Prisma models live in this repository.
The API and website required no rebuild or restart. Existing results and scores
were preserved. On the current 4 GiB VM, the conservative allowances generally
permit one or two concurrent jobs; all six workers remain enabled.

Implementation details, limitations, verification and rollback notes:
[full report](../grader/MEMORY-RESERVATIONS-20261022.md).


Admin toggle (22 October 2026): `/admin/grading/` now has a persistent Memory
reservations control under Grading settings, default On. It changes admission
for new compile and grading jobs without a restart. Off bypasses reservation
capacity, while retaining durable per-job accounting, cleanup, per-job memory
limits and the fresh low-RAM guard. Re-enabling includes already active jobs.
The setter serializes with admission using advisory lock (140014,1).

Validated with 37 isolated scheduler/dispatcher checks and 13 API checks,
including Off/On with active jobs, preserved real budget accounting, strict
boolean input, permissions, persistence and cache invalidation. Production
release paths: `/opt/otog/reservation-toggle-20261022` and
`/opt/otog/reservation-dashboard-20261022`.
