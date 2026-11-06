# Dedicated compilation service

Deployed and verified on the existing OTOG VM on 22 October 2026.

`Waiting standard C/C++ submissions → compiler service (2 slots) → ready binaries → 6 graders`

The `compiler` Docker Compose service supervises two independent slot processes,
with identities 7 and 8, pinned to virtual CPUs 6 and 7. Each has its own PID and
mount namespaces, working directory, logs, and Isolate scratch filesystem.
The six existing graders retain identities 1–6 and their existing resource limits.
Docker starts the service after a VM boot; the supervisor restarts failed slots.

Standard C/C++ submissions, including small-memory problems, use this service.
Python and problems containing auxiliary source files, custom checker sources,
interactive scripts or custom compilation commands retain their existing direct
grading path. An invalid or incompatible artifact also uses the existing direct
path after invalidation. Compilation errors can finish in the compiler stage.

Both stages use the existing PostgreSQL memory pool and fresh memory guard.
Ordinary compilation reserves 640 MiB (384 MiB compiler allowance plus 256 MiB
padding), with the existing full-memory retry. Successful compilation releases
its lease and memory only after sandbox cleanup. Ready binaries occupy bounded
disk storage until a grader obtains an execution reservation. The compiler
container has a 2304 MiB ceiling; that ceiling does not add to the shared pool.
Actual concurrency depends on available RAM and user/problem limits.

The scheduler leaves memory headroom for older ready programs. It gives ready
work priority over newer compilations from the same user and over compilations
for problems with a worker limit. Existing per-user and per-problem limits cover
both stages. Pausing all six graders also stops new compiler admissions. Compiler
heartbeats and enabled flags live in `otogCompilerState`; the six existing admin
grader controls continue to refer to graders 1–6.

Validation passed 19 existing pipeline checks and 11 dedicated-service checks.
These include 20 existing six-worker race rounds, 20 new eight-process race
rounds, actual C/C++ handoff without recompilation, queue-age preservation,
artifact validation and expiry, recovery, memory guards, user/problem limits,
and five existing reference solutions retaining 100 points. Test jobs used a
disposable database. Deployment drained active leases and reservations before
replacing graders. Saved result and policy fingerprints matched across the
switch. Runtime source hashes matched the tested candidate in all seven
containers. All eight process heartbeats were fresh, with no container restarts
or OOM kills at postflight. Local and public page, ping and authentication checks
passed. Website, API, nginx and ngrok services were not restarted. No new speed
benchmark was performed for this dedicated-service configuration.

Public website: https://quaintly-decorated-congenial.ngrok-free.dev

Active release: `/opt/otog/dedicated-compiler-20261022/`.
Compose configuration: `/home/otog/otog/docker-compose.vm.yml`.
Binary store remains `/opt/otog/compile-pipeline-20261022/cache/`.
Compiler logs: `docker compose -f docker-compose.vm.yml logs compiler` from
`/home/otog/otog`. Slot logs are under the release's `Logging/slot7` and `slot8`.

Operational migration: `20261022040000_dedicated_compiler`. It adds compiler
state and extends operational lease, reservation and artifact-owner constraints
to accept slots 7–8. It does not change submission or result schemas. The local
and VM Prisma schemas include the new state model; local schema validation passed.

Evidence is saved in
[the local release evidence](../../../grader/vm-setup/dedicated-compiler-evidence-20261022),
including `tests.json`, `deployment.json`, `postflight.json`, source hashes,
the deployment helper and the dedicated regression suite. Updated grader source
is in `D:\otog-grader\src`; earlier local files are backed up under
`D:\otog-grader\vm-setup\dedicated-local-before-20261022`.

To roll back, record enabled flags and pause both `otogCompilerState` and
`otogWorkerState`. Wait for both `otogWorkerJob` and
`otogWorkerMemoryReservation` to become empty. Stop the compiler service, restore
the release's `compose.before.yml` to the active Compose path, recreate only the
six graders and restore their recorded enabled flags after startup checks. Leave
compiler states disabled. The previous release files and shared binary store
are retained. The additive migration can remain in place. Restore maintenance
checkout files from `maintenance-before/` if also reverting the editable VM copy.
Never remove a live memory reservation to force admission.
