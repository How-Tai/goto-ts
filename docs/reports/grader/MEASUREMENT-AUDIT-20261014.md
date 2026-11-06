# Grading dashboard measurement audit — 14 October 2026

Audited the live monitor, API and dashboard against Linux procfs, cgroup-v2 and systemd metadata. Corrected identified errors and deployed the changes. API, website and monitor restarted for this update; all six grader container identities and start times remained unchanged. No submissions, results, worker limits, priorities or VM/security settings were changed.

## What each reading means

| Reading | Source and scope |
| --- | --- |
| VM User CPU | Delta of `/proc/stat` user + nice ticks, divided by the sum of the first eight CPU tick categories. Guest ticks are already included in user/nice and are not added again. |
| VM System CPU | Delta of system + IRQ + softIRQ ticks, on the same denominator. |
| I/O wait | Kernel-reported iowait tick fraction. An estimate of idle time with outstanding I/O, not CPU computation or a direct disk-utilization measurement. |
| Idle and Steal | Kernel-reported idle and stolen tick fractions. Steal being zero does not prove the Windows host never delays virtual CPUs. |
| VM CPU busy | User + System across all virtual CPUs. 100% means all VM CPU capacity; I/O wait, idle and steal are excluded from busy computation. |
| Service/container CPU | Hierarchical cgroup-v2 `cpu.stat usage_usec` delta divided by independently paired monotonic elapsed time. Includes child processes/cgroups. 100% means one virtual CPU, so multithreaded services can legitimately exceed 100%. |
| VM total/available RAM | `/proc/meminfo` MemTotal and MemAvailable. MemTotal is Linux-usable RAM, not the raw configured 4 GiB. MemAvailable is a kernel estimate including reclaimable memory. |
| Memory history | Cache = Cached + SReclaimable − Shmem, bounded at zero. Buffers and MemFree are shown separately. Used = total − free − cache − buffers. The four categories reconstruct MemTotal within rounding. |
| Swap | SwapTotal − SwapFree from meminfo. |
| Service/container RAM | Hierarchical `memory.current` minus `memory.stat inactive_file`, a working-set convention matching Docker's displayed memory basis. Includes children and charged kernel/active-file memory; it is not main-process RSS. |
| Main threads | Threads of the main process from `/proc/PID/stat`. Does not claim to count every child process/thread in the service. |
| Main virtual | Main process VmSize from `/proc/PID/status`. Virtual address space is not physical RAM usage, committed memory, reserved disk, or a second RAM allocation. |
| VM uptime | `/proc/uptime`. |
| Service uptime | CLOCK_MONOTONIC minus systemd ExecMainStartTimestampMonotonic, using the same clock domain. |
| Container uptime | Guest boot uptime minus the leader's `/proc/PID/stat` start ticks, avoiding wall-clock corrections to Docker StartedAt. |
| Available VM disk | Root filesystem availability from statvfs/shutil, available to normal users. This measures the guest filesystem, not Windows D free space or the VDI file size. |
| Automatic restarts | Docker RestartCount or systemd NRestarts for the current source-counter lifetime. Manual restarts/recreations are not represented as cumulative lifetime failures. |
| Queue/worker counts and time | A single database statement snapshot. Queue ages use queuedAt; running-job ages use claimedAt. Snapshot observedAt now comes from database statement_timestamp(), rather than a later API timestamp after telemetry collection. |
| Worker connection | Recent heartbeat plus the corresponding two-integer advisory worker lock in the current database, including objsubid=2 namespace validation. |
| Resource freshness | Server sample timestamp with a 20-second expiry, invalid/initializing/future snapshot rejection, and conservative browser monotonic expiry when polling stops. |

All displayed memory units are **MiB** and disk units **GiB**, matching the binary conversion. Legacy JSON field names ending in Mb/Gb are retained for compatibility.

## Corrections

- Systemd CPU and RAM previously covered only MainPID while container readings included descendants. Both now use whole-cgroup counters. Main-process-only thread and virtual-address columns are labeled explicitly.
- Removed Docker stats round trips for RAM; raw cgroup CPU and memory readings now share a consistent scope and lower collection overhead.
- CPU counters are paired with their own read timestamps. Negative/regressed counters, restarts and intervals over 20 seconds produce unknown readings rather than misleading spikes or stale averages. Valid multi-CPU values are not clamped to 100%.
- Startup no longer takes an immediate second CPU sample over a tiny interval. Readings state the actual interval, normally five seconds; per-service interval/sample timestamps are available in CPU-cell tooltips.
- History is bounded by elapsed time as well as sample count. Charts use actual monotonic sample spacing and break lines at invalid/missing samples, backward time, or gaps over 15 seconds.
- Added Idle, Steal and Free-memory series so CPU/memory partitions can be understood. Available RAM and Used RAM are described as different measures.
- Restart counters explicitly say automatic. Unreadable data remains unknown instead of being fabricated as zero.

## Verification

- Nine new Python accuracy tests and nine maintained regression tests passed.
- Pure TypeScript assertions passed for chart spacing/gaps/discontinuities, stale/future/invalid snapshots and browser expiry deadlines.
- A temporary bounded child-process probe ran on CPU 6, with a 96 MiB memory limit and 15-second lifetime ceiling. Its parent was idle: main-process-only CPU measured 0%. Corrected whole-service CPU measured **99.95%**, compared with **99.82%** from an independent raw cgroup counter pair. Working-set memory matched raw cgroup readings at **20.89 MiB**. The transient unit was stopped and collected afterward.
- Shadow collection returned all twelve service rows without warnings; one full shadow sample took about 0.047 seconds. Live deployment verification observed 0.308 seconds, showing normal sampling-time variability.
- Live CPU categories summed to **100%**, and the four memory categories summed to the Linux MemTotal of **3913.9 MiB**. All twelve live service readings had valid CPU, RAM, main-thread, virtual-space, uptime and restart fields after warmup.
- Admin access worked; anonymous and regular-user access to the dashboard API remained denied. All six workers were connected. Public problem/PDF/announcement and private-access checks passed. The public ngrok problem page returned HTTP 200.
- The existing signed-in Chrome dashboard rendered the new measurements, units, legends and service headings. Screenshot: `D:\otog-grader\vm-setup\measurements-verified-20261014.png`.

Backup and evidence: `D:\otog-grader\vm-setup\measurement-audit-backup-20261014.tgz`. Live paths are recorded in `measurement-web-current.txt`, `measurement-monitor-current.txt`, and `measurement-audit-backup.txt` under `/home/otog/worker-setup`.

## Practical accuracy limits

These are periodic Linux-guest readings, not instantaneous hardware probes or measurements of the whole Windows host. Independent counters cannot all be read atomically. CPU percentages are interval averages. Linux memory/cgroup counters and MemAvailable are accounting conventions/estimates, and iowait has documented limitations. Process RSS/virtual size, charged cgroup working set, and Windows committed memory are different quantities. No extra decimal places can remove these distinctions.

Primary references: [Linux procfs](https://docs.kernel.org/filesystems/proc.html), [cgroup v2 accounting](https://cdn.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html), [systemd monotonic service metadata](https://wiki.freedesktop.org/www/Software/systemd/dbus/).
