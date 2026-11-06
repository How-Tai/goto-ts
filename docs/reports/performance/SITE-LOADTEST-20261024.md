# Read-only site load test — 24 October 2026

Compared existing CPU sharing against runtime CPU-7 affinity for API, web,
nginx, ngrok, telemetry, worker-control, PostgreSQL and MinIO. The OS, graders
and compiler retained their existing CPU configuration. Graders were idle;
this is not a combined grading-throughput or full contest capacity test.

The load generator ran on Windows, outside the VM, through direct HTTP at
127.0.0.1:3030. Public problem-list pages, problem-detail pages, database-backed
problem/announcement/current-contest reads and occasional problem PDFs were
requested with persistent connections. There are 61 public problems in this
dataset. Each virtual user ran approximately five requests per five seconds,
with pauses and staggered starts. Each paced stage ran for 35 seconds plus
drain; 30/100 simultaneous problem-page bursts followed. Frontend assets were
warm. Browser JavaScript, authenticated sessions, login, WebSockets, submission
writes, active grading, WAN/ngrok latency and long-duration soak were excluded.

| CPU arrangement | Users | Browsing p95 | Page burst p95 | Errors |
|---|---:|---:|---:|---:|
| shared | 30 | 32 ms | 379 ms | 0 |
| shared | 100 | 132 ms | 1128 ms | 0 |
| cpu7 | 30 | 68 ms | 849 ms | 0 |
| cpu7 | 100 | 1063 ms | 1845 ms | 0 |

The four original paced/burst combinations per mode total 9,723 requests.
A 20-second CPU measurement confirmation at 100 users on CPU 7 added 2,080
requests, with p95 1,325 ms and zero errors. Overall: 11,803
requests and zero HTTP failures. p95 is the 95th percentile across request
durations, including response body reads; burst figures represent individual
HTTP page requests, not complete browser rendering.

At 100 users with normal sharing, background-service cgroups averaged 101.74%
of one CPU: web 46.70%, API 36.34%, PostgreSQL 7.01%, with nginx/telemetry/etc.
making up the rest. In the CPU-7 confirmation, background work averaged 86.07%
of one core; the core itself averaged 81.70% busy across the sampled window,
including pacing gaps and drain. Minimum available memory remained above
2.1 GiB in the measured windows.

The first CPU-7 run completed all requests, but the monitoring script's rollback
assertion caught Docker ignoring an empty cpuset update. API/web/etc. had already
been restored; PostgreSQL/MinIO were promptly restored explicitly to CPUs 0–7.
Their original Docker cpuset strings were empty (unrestricted). They now have an
explicit 0–7 set, equivalent on this eight-vCPU VM. Compose files were not changed.
The monitor was corrected and a short confirmation verified successful automatic
rollback. CPU metrics for the first CPU-7 stages were lost on the assertion;
the confirmation supplies CPU metrics, while all original latency/error results
remain available. The load generator, not the application, reported that error.

All container identities/restart counts remained unchanged. Saved-result and
grading-setting fingerprints were unchanged. Service AllowedCPUs values were
restored, with normal services free to use CPUs 0–7; graders remain pinned to
0–5 and compiler to 6. No accounts or submissions were created by this test.

Conclusion: keep CPU sharing for the present configuration. Confining all web
and database work to CPU 7 substantially raises tail latency at 100 users.
If strict separation is required, allow at least two CPUs for supporting services
and validate with authenticated users plus simultaneous grading before committing
to a new grader/core split.

Evidence: `tmp/site-loadtest-20261024/` and
`/opt/otog/site-loadtest-20261024/`. Reusable load generator, monitor, raw request
statistics, affinity manifests and summarized cgroup/CPU measurements are retained.


## Correction after effective-affinity verification

The original rollback verification checked configuration metadata but missed
the live systemd cpuset remaining restricted. The statement above that complete
CPU sharing was restored at that point was incorrect. The two-core follow-up
found this, explicitly restored all service masks to 0–7, verified every service
thread, and reran the shared baseline. The original before/one-core latency
measurements remain useful, but their restoration claim is superseded by
`SITE-TWO-CORE-LOADTEST-20261024.md`. The monitors now check effective kernel masks.
