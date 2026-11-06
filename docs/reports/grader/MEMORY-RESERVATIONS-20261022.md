# Shared grader memory reservations — 22 October 2026

Updated later on 22 October: the phase-aware release supersedes the whole-job
minimum described below. See [current behavior](PHASED-MEMORY-20261022.md).
The following remains the original release record.

Implemented, tested and activated on all six VM graders. The website, API,
database and ngrok services were not restarted. Existing grading results,
scores, keyword policies, per-user limits and the Tull one-worker limit were
preserved. No production test submissions or rejudges were created.

Each queue claim now takes a short PostgreSQL transaction advisory lock
`(140014, 1)`. It checks the shared budget and existing reservations, then
creates the reservation, queue lease, grading status and retry counter in the
same transaction. Execution happens after commit, outside the scheduler lock.
The main connection's existing ten-second lock timeout remains active.

The allowance is `max(1024 MiB, problem memory limit + 256 MiB)`. The minimum
accounts for the existing 768 MiB compilation allowance, checker phases and
scratch overhead. For example, a problem with a 1024 MiB limit reserves
1280 MiB. This is bookkeeping; reserving it does not allocate that much RAM.
Existing contestant limits, container limits, CPU/wall limits, compiler flags,
checker behavior and timing measurements are unchanged.

When there are no reservations, the scheduler samples guest MemTotal and
MemAvailable. In KiB, the new pool is:

```
min(MemTotal - 1536 MiB, MemAvailable - 512 MiB)
```

The first ceiling leaves at least 1536 MiB of total physical RAM outside the
judging budget, including memory already occupied by the OS and services.
The second leaves another 512 MiB of the sampled available RAM uncommitted
for their growth. The existing fresh 1536 MiB **pre-claim** admission check
still applies twice to every successful claim. That check is not a promise
that 1536 MiB stays available after running submissions allocate memory.

While any reservation remains, the pool stays fixed and new jobs spend its
remaining balance. Full reservations are not subtracted from newly reduced
MemAvailable, which would double-count memory already allocated by running
jobs. After all reservations are released, the next claim refreshes the pool
to account for changed background usage. Missing or malformed readings block
new claims. A memory-unfit problem is skipped when selecting eligible jobs,
so it does not unnecessarily block a smaller job from the same user.

On this approximately 4 GiB VM with about 2.5 GiB currently available, the
allowances generally permit one or two simultaneous jobs. All six workers
remain enabled and available; additional submissions wait in the durable queue.
Larger VM memory automatically permits a larger budget on a subsequent empty
pool snapshot. No VM resource settings were changed.

Reservations are deliberately separate from `otogWorkerJob`. Persisting a
completed verdict releases the job lease but keeps its memory reservation.
The owning worker releases that reservation only after sandbox/scratch
cleanup succeeds. A cleanup failure retires the worker with the reservation
still held. A restarted container acquires its exclusive worker lock,
recovers its queue lease, clears its own scratch, and only then releases its
old reservation. Heartbeat expiration never frees a reservation. Memory
release sends the existing queue notification so waiting workers can retry.

This is a conservative scheduling safeguard, not an absolute OOM guarantee.
Unrelated services can grow after a pool snapshot; compilation/checker
allowances are estimates rather than a hard aggregate cgroup limit. Existing
per-container limits and watchdog recovery remain necessary. Host sleep,
Windows memory pressure and a frozen VM kernel remain separate issues.

Validation completed against the exact activated source hashes:

- 30 reservation/queue checks using real PostgreSQL transactions and a
  restricted worker role in a disposable, network-isolated database.
- 40 rounds of six simultaneous claimants: six 1024 MiB problems never
  overspent a 2304 MiB test pool; only one 1280 MiB reservation was admitted.
- Coverage includes two fitting small jobs, an administrator editing ML during
  selection, per-user/per-problem limits, pause, low/missing RAM, failed claim
  rollback, persistence-before-cleanup, owner recovery, idempotent release,
  and refreshing the pool after all reservations are released.
- Nine real main-loop/sandbox lifecycle checks, including a finite 64 MiB
  scratch file, subsequent C++/Python ACs, and a cleanup failure that retains
  the reservation and preserves the committed AC.
- Fourteen ordinary grading pipeline checks passed. Five existing accepted
  reference solutions for problems 48, 52, 53, 54 and 56 all scored 100 in the
  separate diagnostic sandbox; production results were not modified.
- Prisma schema validation passed using a dummy database URL without a
  database connection.
- All six deployed workers passed source-hash, startup, heartbeat, mount and
  resource-limit checks. Enabled states were restored. Historical result and
  policy fingerprints matched across activation.
- Six localhost/ngrok HTTP checks passed, including the authenticated admin
  endpoint rejecting guests. Windows `http://localhost:3030/` returned 200.
  Temporary diagnostic containers were removed.

The operational-only migration is
`20261021150000_grading_memory_reservations`. It adds
`otogWorkerMemoryBudget` and `otogWorkerMemoryReservation`, records its exact
checksum in Prisma migration history, and grants only the worker operations
needed on these tables. The API has no write permission to these new tables.
Prisma models and the maintenance checkout were synchronized. No existing
submission/result schema or data was rewritten.

Active source mounts are under
`/opt/otog/memory-reservations-20261022/source/`, for `mainWorkers.py`,
`worker_queue.py` and `memory_reservations.py`. All other hardening mounts,
native Isolate binary and Docker image remain unchanged.

The release retains `compose.before.yml`, the old two source files, maintenance
source backups, `schema.prisma.before`, exact source hashes, test reports,
pause states and historical fingerprints. Activation included automatic
compose rollback on a failed verification. For a later rollback, pause new
claims, let active jobs finish and reservations clear (or recover a failed
owner normally), then restore `compose.before.yml` and recreate only the six
graders before restoring the prior pause states. Leave the additive tables and
migration record in place; do not delete reservations while a job can still
be running. The release directory is active runtime storage and must not be
removed as temporary files.

Sanitized evidence is in
`D:\otog-grader\vm-setup\memory-reservations-evidence-20261022\`.
