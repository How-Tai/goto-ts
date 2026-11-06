# Service CPU measurement investigation — 12 October 2026

The service table uses one virtual CPU as 100%. A service using several CPUs can legitimately exceed 100%; 212.4% would represent about 2.12 virtual CPUs, or 26.55% of an eight-vCPU VM, if measured correctly. PostgreSQL container usage includes its database backend and background processes.

## Observed measurement issue

Read-only live sampling around 09:17 Bangkok compared the PostgreSQL cgroup's cumulative CPU time divided by monotonic elapsed time with the previous Docker-style calculation:

| Sample | CPU time / elapsed time | Docker aggregate-tick calculation |
| --- | ---: | ---: |
| 1 | 41.85% | 60.49% |
| 2 | 42.73% | 57.97% |
| 3 | 38.24% | 52.84% |

The guest aggregate CPU ticks advanced approximately 5.72–5.74 CPU-seconds per elapsed second during these eight-vCPU samples. Multiplying by eight in the previous calculation inflated the result when those aggregate ticks lagged elapsed time. This shows a measurement mismatch in this VM; it does not establish the exact underlying VirtualBox scheduling cause or reconstruct the earlier 212.4% screenshot.

During concurrent production judging, the previous calculation also displayed approximately 171–218% for individual graders configured to use a single guest CPU. The candidate's elapsed-time calculation reported roughly 67–93% in an earlier busy sample. These were separate sampling windows, not an identical-job performance comparison.

## Correction and validation

`deployment/monitor_agent.py` now reads each running container's cgroup-v2 `usage_usec` counter, including descendant processes, and pairs it with the monotonic time of that read. CPU percentage is the increase in CPU seconds divided by elapsed seconds, multiplied by 100. The calculation remains uncapped; valid multi-CPU usage can exceed 100%. Restarted containers, missing counters, and reset counters establish a fresh baseline rather than producing fabricated usage. System service CPU calculation already uses paired process CPU counters and elapsed time.

Nine monitoring checks passed on Windows and on the Linux VM. They cover multiple CPUs, restarts, unavailable/reset counters, read timestamps, delayed Docker calls, VM CPU segments, bounded history, and memory accounting. A candidate collector also successfully sampled all twelve services before activation.

Only `otog-monitor.service` was restarted. The first activation automatically rolled back because the six-second startup wait was too short under live grading load. After extending the readiness deadline to forty seconds, activation succeeded. Existing low-resource limits remain: CPUQuota 10% of one CPU, MemoryMax 64 MiB; observed monitor memory was approximately 10.7 MiB.

Website service main PIDs/start times and all eight monitored container start times matched the pre-update snapshot. All six workers remained enabled with recent heartbeats. After activation, corrected PostgreSQL dashboard samples included 37.0% and 34.85%; an active single-CPU grader showed 89.39%. Traffic and workload can change those values between samples.

Guest website and public ngrok returned HTTP 200, measured at 0.029 and 0.246 seconds respectively. No production submissions, scores, worker limits, grader images, VM allocation, or Windows security settings were changed during this investigation. VM-aggregate CPU charts retain Linux's aggregate tick-based calculation; this patch concerns service/container CPU percentages. Kernel CPU-time accounting itself is still guest accounting and is not proof of the physical host's execution time.

Guest rollback copy: `/home/otog/worker-setup/cpu-monitor-backup-20261012/monitor_agent.py`.
Local correction and checks: `deployment/monitor_agent.py`, `deployment/test-monitor-agent.py`.
