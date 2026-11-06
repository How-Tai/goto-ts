# Ordinary service CPU placement — 30 October 2026

**Current policy:** the selected grader count now dynamically reserves CPUs 0 through N−1; unused CPUs serve ordinary work and unused grader rows are hidden. See [DYNAMIC-GRADER-CPUS-20261030.md](../grading/DYNAMIC-GRADER-CPUS-20261030.md). Subsequent fixed-allocation notes and benchmarks below are historical.

**Superseded later on 30 October:** the deployed dashboard now selects 1–7 active graders on CPUs 0–6; ordinary services use CPU 7. The initial count remains 6. See [GRADER-COUNT-20261030.md](../grading/GRADER-COUNT-20261030.md) for the current policy, checks and recovery instructions. The measurements below describe the earlier six-grader/two-service-core policy.

The guest's ordinary system services and login sessions are assigned to CPUs **6–7**. Six existing Docker graders retain their individual CPU masks **0, 1, 2, 3, 4, 5**. Each grader still performs its own compilation and evaluation.

## Policy

- `/etc/systemd/system/service.d/90-otog-housekeeping-cpus.conf` provides `AllowedCPUs=6-7` for system services. A new transient service with no explicit CPU setting was verified to inherit this default.
- Previously unrestricted running services received matching runtime cgroup properties immediately. The persistent type-wide default applies on subsequent starts. Existing web/API/nginx/monitor/control/tunnel assignments were already 6–7 and were retained.
- `user.slice` has a persistent `AllowedCPUs=6-7` property, covering ordinary login sessions and their descendants.
- `system.slice` remains 0–7 because Docker uses sibling container scopes there. Restricting that parent would also restrict the graders. Existing PostgreSQL and storage containers retain their explicit 6–7 masks.
- Docker and containerd management processes are restricted as ordinary services. A new disposable container explicitly assigned CPU 0 successfully started on CPU 0; `docker exec` affinity checks passed for all six existing graders. Container launch and exec therefore continue to reach the grader cores.

This is service/process placement, not full kernel isolation or a security boundary against root. PID 1, kernel threads and interrupt work are excluded from the ordinary-process verification. Kernel boot parameters, IRQ routing and host VirtualBox scheduling are unchanged. Future Docker containers must still receive an appropriate explicit CPU set; the service default does not apply to Docker's container scopes. Explicit unit-specific CPU overrides can also supersede the general default.

The policy was applied without a reboot or restarting existing application services, Docker or containers. All 26 running services were checked, using actual process masks when systemd did not report an effective CPU field. The process scan found no ordinary non-kernel process outside 6–7 except processes in the six grader scopes. The previous configuration was restored temporarily for an additional matched web-only comparison, then the new policy was reapplied using the original rollback snapshot.

## Grading and web-load comparison

Each version used 100 temporary ordinary users, a 40-second login ramp, 100 copies of the same previously accepted C++ solution for contest 2/problem 67, and ten rounds of 100 complete HTTP problem-page journeys while grading proceeded. All protected requests used normal authentication. The current parallel session/page-data startup sequence was used on both sides.

| Measurement | Before | Restricted ordinary services |
| --- | ---: | ---: |
| Web complete-path p50 | 986.06 ms | 1,251.12 ms |
| Web complete-path p95 | 1,675.44 ms | 1,745.98 ms |
| Web complete-path p99 | 1,929.83 ms | 1,965.53 ms |
| Submission queue-to-result p50 | 44.41 s | 42.81 s |
| Submission queue-to-result p95 | 76.15 s | 73.68 s |
| Submission queue-to-result p99 | 77.29 s | 75.17 s |
| Slowest testcase per submission p50 | 93 ms | 91 ms |
| Slowest testcase per submission p95 | 103 ms | 102 ms |
| Slowest testcase per submission p99 | 107 ms | 107 ms |
| Largest testcase time observed | 117 ms | 112 ms |
| Mean within-testcase sample standard deviation | 1.353 ms | 1.443 ms |

Both runs completed all 1,000 page journeys with zero failures and graded all 100 submissions accepted. Each grading run contributed 1,000 testcase measurements. All six graders were connected. Minimum sampled available memory was 3,720.9 MiB before and 3,586.8 MiB after.

This pair does not demonstrate a reliable grading timing-consistency improvement: testcase p99 was unchanged and sample dispersion did not decrease. Queue-to-result times were modestly lower. The web median was **26.9% higher** in this run, with p95 about 4.2% and p99 about 1.8% higher. These results are retained, rather than reporting only favorable metrics. Ordinary background work now competes on the same two CPUs as the website; concentrating work there is an intentional tradeoff of this placement policy.

Measurements are direct-VM HTTP journeys, including HTML, session and authorized problem-data reads. They exclude browser rendering, public ngrok overhead and PDF display. They are short sequential comparisons, not randomized experiments or guarantees of every future workload. Host scheduling, caches and overlapping grading progress can affect the results.

## Recovery and evidence

Every fixture restored the original table fingerprints and contest schedule, removed its test accounts/submissions/results, and restored the submission counter under the existing fingerprint/locking guard. Real counts remain **33 users, 622 submissions/results**, with next submission ID **770**. Contest 2 remains **15 October 2027, 09:00–13:00 Bangkok**. Temporary account credentials and private fixture source copies were removed.

The application was protected by an independent 20-minute rollback timer while validation ran. The previous service masks and exact property-file snapshots are retained under `/opt/otog/housekeeping-cpus-20261030/evidence/plan.json`. Manual rollback uses `/usr/bin/python3 /home/otog/housekeeping-cpus-candidate/release.py rollback` as root and preserves unexpected concurrent edits rather than overwriting them.

Local evidence: `tmp/housekeeping-cpus-20261030/evidence/`, `tmp/housekeeping-load-before-20261030/`, `tmp/housekeeping-load-after-20261030/`, and the additional `tmp/housekeeping-idle-before-20261030/` / `tmp/housekeeping-idle-after-20261030/` pair.

## Additional web-only check and final state

Because the first pair showed a slower web median, the original CPU policy was temporarily restored for a separate comparison with grading idle. Each version used 100 temporary users and 20 rounds of 100 simultaneous complete HTTP page journeys. Both versions used the current parallel startup sequence; there was no application-code change between them.

| Web-only complete path | Original policy | Restricted services |
| --- | ---: | ---: |
| p50 | 655.58 ms | 679.98 ms |
| p95 | 1,303.13 ms | 1,084.32 ms |
| p99 | 1,663.42 ms | 1,487.46 ms |

All **2,000 journeys per version** completed without failure. The large median increase seen alongside grading did not repeat in this idle-grading pair; the median was about 3.7% higher, with lower p95/p99. The configuration was retained to reserve grader cores from ordinary background processes. These short comparisons do not prove a general throughput or timing-consistency improvement, and the slower web median under grading remains a recorded tradeoff.

Final checks passed after daemon reload. All 26 running services and the user slice use 6–7; the six existing graders and their container identities/mounts/restart counts remain unchanged. A process scan found other non-kernel processes only in the grader scopes outside 6–7. Local and public HTTPS health checks passed. The independent rollback timer was stopped after validation; manual rollback remains available. Original data and IDs were reconfirmed: 33 users, 622 submissions/results, max submission ID 769, next ID 770, and six fresh grader heartbeats. Available memory at final check was about 4,738 MiB.
