# One compiler worker with concurrent jobs

Deployed and verified on the OTOG VM on 22 October 2026.

One compiler dispatcher now owns queue pickup and manages up to ten concurrent
compilation jobs. It claims each job centrally, assigns a free job slot, and
launches a process that runs that assigned job once. The assignment runners never
poll the queue, register independent workers, or recover other jobs. When idle,
the compiler container contains only the dispatcher process.

Operational IDs 7 and 8 identify the two concurrent job slots. Both advisory locks
belong to one PostgreSQL backend owned by the dispatcher. The existing dashboard
continues to display these as two compilation slots, including current jobs,
shared CPU 6 affinity and heartbeats. Both concurrent job processes and the
dispatcher are pinned to exactly one virtual CPU (index 6). The dashboard labels
one compiler worker with two job slots. The six graders retain CPUs 0–5.
This single-CPU correction passed all 34 isolated checks, including overlapping
job namespaces restricted to CPU 6. Only the compiler container was recreated;
grader containers and website services stayed running.

Each job reserves **512 MiB** (384 MiB compiler address-space allowance plus
128 MiB padding). Two active jobs reserve **1024 MiB**. Shared memory admission,
ready-binary headroom, user/problem limits, pause controls and bounded storage
remain in force. Compiler failures return Compile Error without a higher-memory
retry. Queue checks are coalesced while a slot waits for admission.

Every job has a fresh PID/mount namespace, private work/scratch state and existing
phase watchdogs. A private root-owned JSON assignment is validated against the
live job, artifact token and owning dispatcher backend before execution. Its
directory is hidden by the sandbox's `/usr/src` mask.

The launcher's parent-death signal and namespace lifetime prevent compilation
processes surviving dispatcher death. Completed/exited launchers are reaped
before recovery and memory release. Interrupted work is requeued within the
existing retry budget; repeated interruptions become Judge Error. The dispatcher
also has a progress watchdog and a 300-second outer job deadline. Docker retains
`unless-stopped` recovery. Graceful shutdown stops admission and lets active jobs
finish, with a 90-second shutdown ceiling. An idle dispatcher stops promptly.

All **33 isolated checks passed**, including the previous 23 policy/queue/
realistic-C++ checks and ten dispatcher checks:

- One backend owns both slot locks; a competing dispatcher cannot take over.
- Two centrally assigned compilations overlap; job runners are tested with queue
  pickup disabled and raise if they try it.
- All eight realistic C++ programs finish at 100 points without grader
  recompilation, and idle shutdown completes within five seconds.
- Active shutdown completes two jobs while leaving the third queued.
- Compilation failure persists Compile Error once without a larger-memory retry.
- Killing one compilation recovers that job while the other stays active.
- Killing the dispatcher kills its job namespaces; restart recovers retained
  reservations and abandoned leases.
- Repeated interrupted jobs stop after two compilation attempts with Judge Error.
- Stale assignment files do not authorize execution.
- The normal grader main loop still handles a ready C++ binary and direct Python.

Tests used a disposable PostgreSQL instance and sandbox container; production
results were not test inputs or outputs. Deployment drained active jobs, preserved
saved-result fingerprints and restored grader enable flags. All source hashes,
eight status heartbeats, container OOM/restart checks, single-backend ownership,
and six local/public HTTP checks passed. Website services were not restarted.
The subsequent [matched architecture benchmark](DISPATCHER-BENCHMARK-20261022.md)
found 16.5โ€“24.5% longer median batches than the previous two persistent workers,
with the same 512 MiB job reservations and CPU/pool limits. All 144 comparison
jobs scored 100. Idle compiler-container memory fell from about 45.7 to 12.8 MiB,
while compiler-container CPU use increased by about eight seconds per 12-job
batch. No production changes were made by the benchmark.

Active source and rollback Compose:
`/opt/otog/compiler-dispatcher-20261022/`.
Local source changes: `D:\otog-grader\src\compiler_service.py`,
`compiler_dispatch.py`, and the assigned-job branch in `mainWorkers.py`.
Previous source backup:
`D:\otog-grader\vm-setup\compiler-dispatcher-before-20261022`.
Scripts, fixtures and evidence: `D:\otog\tmp\compiler-dispatcher\`.

Current single-CPU release: `/opt/otog/compiler-singlecpu-20261022`.
The earlier benchmark used CPUs 6 and 7 for both configurations; those timings
are historical and do not describe the current single-CPU setup.


Six-job capacity update (22 October 2026): one dispatcher now manages slots
7-12, all sharing CPU 6. The six graders retain IDs 1-6 and CPUs 0-5. The binary
store is bounded at 512 MiB, allowing six simultaneous 64 MiB output allowances.
Reservations remain 512 MiB per job (3072 MiB for six). Memory admission and
user/problem limits still apply; the administrator's reservation-toggle setting
was preserved (Off at live verification).

All 41 scheduler/dispatcher and 14 API checks passed, including six concurrent
namespaces on CPU 6, a waiting seventh job, real C++ execution without recompiling,
reservation-limited admission and six-job crash recovery. Both local and public
API checks report six connected compiler slots. Release paths:
`/opt/otog/compiler-six-20261022` and `/opt/otog/compiler-six-api-20261022`.
Earlier benchmark timings describe the prior setup.


Ten-job capacity update (22 October 2026): the live compiler manages slots 7-16,
all sharing CPU 6. The binary-store allowance is 768 MiB with the existing
12-artifact cap and 64 MiB per binary limit. Per-job compiler memory and time
limits, low-memory guard, reservation-toggle value and user/problem limits are
unchanged. The grader database role connection limit was raised from 32 to 48:
18 grader connections + 12 idle compiler connections + 10 active runners = 40.
The overall PostgreSQL cap remains 100. Live idle role connections were 30.

All 43 scheduler/dispatcher and 14 API checks passed, including real small C++
jobs at both 8- and 10-job concurrency, queued overflow, one-CPU affinity,
reservation-limited admission and ten-job crash recovery. These are functional
checks, not throughput benchmarks for heavy templates. Local and public API
checks show ten connected compiler slots; reservation setting remains Off.
Release paths: `/opt/otog/compiler-ten-20261022` and
`/opt/otog/compiler-ten-api-20261022`.


Configurable concurrency (22 October 2026): `/admin/grading/` now has a
Concurrent compiler jobs dropdown (1-10), saved immediately and persisted as
`otogGradingSettings.maxCompilerJobs` (default 10). Both dispatcher admission and
transactional queue admission enforce the selected cap. Reductions let running
jobs drain; increases fill available capacity without restarting the dispatcher.
Idle rows above the chosen limit are hidden, while active draining jobs remain
visible. CPU 6, job memory/time limits, user/problem policies and the current
memory-reservation setting are preserved.

All 47 scheduler/dispatcher and 17 API checks passed, including all ten choices,
2-to-1 drain behavior, 1-to-4 hot expansion, restart persistence, invalid input,
serialized policy updates and unchanged active leases. Frontend/API builds and
local/public live checks passed. Initial live selection is 10; reservations Off.
Release paths: `/opt/otog/compiler-selector-20261022` and
`/opt/otog/compiler-selector-dashboard-20261022`.

## Prepared compiler environments (22 October 2026)

The single dispatcher now maintains a pool matching `maxCompilerJobs` (1–10).
Each runner imports the grading code, connects to PostgreSQL, cleans scratch and
initializes an empty Isolate box before reporting readiness. The dispatcher only
claims a submission for a ready runner, then sends a one-use identity over a
private pipe. The runner validates the assignment against the owning backend,
slot lock, live job and artifact token. It runs one submission and exits; its
namespace is never reused. Replacements prepare in the background.

Idle runners hold no submission lease, attempt charge or 512 MiB reservation.
Their real RAM remains part of VM headroom and therefore reduces admission when
memory reservations are enabled. The idle dispatcher waits for queue wakeups;
prepared runners block on the assignment pipe without polling PostgreSQL.

Startup has a 90-second outer deadline; startup phases retain their own watchdogs.
The 300-second active-job deadline begins when the ready runner is assigned.
Lowering concurrency retires unused runners and drains active jobs; raising it
prepares more slots. The dispatcher adopts and reaps orphaned namespace processes
so repeated idle replacement does not exhaust the container's task limit.

Controlled tests on CPU 6 used the same source and limits in each before/after
comparison. Times below measure claim to compiler invocation, excluding queue
waiting and the actual compiler run. The one-job comparison used STL C++; the
10-job burst used a small C++ program with `<cstdio>`.

| Jobs | Cold startup median | Prepared startup median |
| --- | ---: | ---: |
| 1 (three repetitions each) | 0.842 s | 0.080 s |
| 10 (one burst each) | 8.768 s | 0.087 s |

Ten ready runners plus the dispatcher occupied 214.77 MiB proportional resident
memory in the isolated test, excluding PostgreSQL. A two-second idle observation
measured 2% of one CPU. All benchmark binaries scored 100 without recompilation.

All 47 scheduling/compilation/recovery regressions and seven prepared-pool checks
passed. They cover idle crashes, repeated resizing without zombie accumulation,
fresh identities after every job, stale-assignment rejection, reservation budget
limits, live concurrency changes, dispatcher death and real C++ handoffs.

Only the compiler container was recreated after draining active work. The six
graders and web/API services were not restarted; saved results and settings were
preserved. CPU 6 affinity and the existing memory/time limits remain in force.
VM release: `/opt/otog/compiler-warm-20261022`.

## Compiler queue wakeups match normal graders (22 October 2026)

The compiler dispatcher now follows the normal grader pickup loop: a failed
`claim()` is followed by the existing `QueueWakeup.wait()` PostgreSQL LISTEN/NOTIFY
wait, with a five-second fallback and the existing half-second flood coalescing.
A successful claim continues filling available prepared slots. Disabled compiler
slots are skipped before the first empty-claim decision; the atomic claim still
rechecks slot enablement, memory, eligibility and scheduling limits.

This removes repeated empty admission scans across all ten slots and uses the
same wait defaults as normal graders. Problem eligibility remains freshly read
by the unchanged claim function. All ten prepared runners remain available.
The normal grader code, database schema and resource dashboard polling were not
changed. Existing queue notification triggers were verified enabled in production.

In a controlled 11-second idle test, unsuccessful claims fell from 70 to 2.
A real submission notification woke the compiler in 0.510 seconds. With that
notification deliberately disabled in the private test database, the fallback
picked it up in 5.558 seconds, including coalescing and admission work. Four
concurrently admitted real C++ programs scored 100 without recompilation.

Production container CPU averaged 38.94% before and
2.99% after over separate 24-second measurements, expressed
as percentages of one CPU. All samples had ten ready slots and zero assignments.
All 54 checks passed, including the existing 47 regressions and seven queue
pickup checks. Only the compiler container was recreated after draining active
work; settings, saved results and grader/web/API container identities were
preserved. Source and deployment evidence: `/opt/otog/compiler-queue-wakeup-20261022`.

## Compiler idle fast path (22 October 2026)

Compiler claims first use a read-only database EXISTS hint for unclaimed waiting
C/C++ submissions without ready/evaluating/bypass artifacts. Empty, Python-only,
ready-artifact and already-owned queues return before eligibility scans, memory
admission or scheduling locks. When potential work exists, the compiler builds
only the S eligibility predicate, leaving earlier/submission predicates TRUE as
before. Fresh metadata, fingerprints and all admission checks remain authoritative.
Normal grader pickup behavior and notification/fallback waiting are unchanged.

The live SELECT-only plan used `otog_queue_fifo_idx` and ran in 0.069 ms. Focused
checks verified zero filesystem eligibility scans during empty polling, one filter
for a real compiler claim, prompt notification pickup, missed-notification fallback,
and live checker-file changes without eligibility caching. All eight original
STL/PBDS/ACL template cases passed individually. Concurrent overlap tests used
Dijkstra and segment-tree programs to stay above the VM's memory guard.

All 59 checks passed (47 regressions plus 12 focused checks). Separate
24-second production measurements with ten ready slots and no assigned jobs
averaged 1.81% CPU before and 0.42%
after, expressed as percentages of one CPU. Only the compiler container was
recreated after draining jobs; saved results/settings and grader/web/API identities
were preserved. CPU and memory limits remain in force. The local canonical queue
source and VM maintenance copy match the deployed source hashes.
Release/evidence: `/opt/otog/compiler-idle-fastpath-20261022`.


## Grader idle fast path (22 October 2026)

Extended the compiler optimization to all six normal graders. A broad database
EXISTS hint checks for unowned waiting submissions before filesystem metadata,
memory admission or queue locks. It intentionally permits every language and
artifact state. Potential work uses one fresh eligibility snapshot shared across
the S/earlier/submission predicates, reducing three scans to one. Metadata remains
fresh on every claim, and actual job validation and all admission limits remain.
The existing notification listener and five-second fallback are unchanged.

All 66 checks passed: 47 regressions plus 19 focused checks. Coverage includes
all six idle graders, already-owned waiting rows, one shared metadata snapshot,
live checker changes, Python execution, prepared C++ binaries, bypass routing,
FIFO/user/problem limits, actual grading, and compiler crash/concurrency recovery.
All eight STL/PBDS/ACL templates passed individually. The first full diagnostic
run hit the unchanged 1536 MiB available-memory guard; overlap/recovery fixtures
were reduced to small real C++ programs, retaining individual template coverage.
The successful full run kept at least 1599064 KiB available.

Separate approximately 27-second idle production measurements across all six
grader cgroups averaged **13.16% before → 0.61% after**, expressed as
percentages of one CPU combined (95.4% reduction). No jobs were
active at any sample. Individual after values were 0.07–0.15% of one CPU.

Only the six graders were recreated after draining work. Their CPUs remain 0–5.
Both changed source hashes match every live grader, the VM maintenance copy
(verified during deployment), and the local canonical source with backups.
All sixteen heartbeats are fresh; the compiler container identity and ten ready
slots were preserved. Settings, worker enable flags, saved results and web/API
identities were preserved. No database migration or dashboard change was needed.
Release/evidence: `/opt/otog/grader-idle-fastpath-20261022`;
local evidence: `tmp/grader-idle-fastpath/evidence`.
