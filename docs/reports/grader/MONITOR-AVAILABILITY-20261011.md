# Intermittent resource monitor availability — 11 October 2026

The dashboard message was reproduced and a monitor-only CPU budget adjustment was applied around 21:49–21:51 Bangkok. The API and website releases, database, queue/scoring code and grader configuration are unchanged.

## Cause and evidence

The API waits 1.5 seconds for the loopback resource monitor. It deliberately returns unavailable telemetry when this read fails; queue and worker reads remain independent. Twenty-second resource expiration prevents old readings being displayed as current, but cannot prevent the monitor from missing this request deadline.

The monitor's 5% of one CPU quota was too restrictive for its sampling plus HTTP work on this VM. During ten read-only loopback checks, eight API resource reads were unavailable, while all six worker connections remained present. Monitor responses took up to approximately five seconds or hit the probe's five-second timeout. The last returned sample aged to 61 seconds. The cgroup throttle counter advanced on virtually every quota period during the failure sequence, and the monitor journal showed broken-pipe errors after clients abandoned delayed requests. The monitor process had not restarted and used around 13 MiB memory. The current VirtualBox log did not show a new guest heartbeat flatline during these checks.

## Correction and verification

The quota was first changed reversibly at runtime from 5% to 10% of one CPU, retaining Nice=10 and the 64 MiB memory limit. This allows at most 0.1 of one CPU, or 1.25% of this eight-CPU VM's aggregate capacity. It is a cap, not reserved CPU capacity.

The same ten-request probe then returned ten fresh API resource snapshots and six connected workers on every request. Direct monitor response times were 8–435 ms, and all ten API calls completed in 30–789 ms. Samples remained about 3–6.5 seconds old. Following these successful checks, a persistent drop-in was installed at /etc/systemd/system/otog-monitor.service.d/60-monitor-budget.conf. Canonical deployment/otog-monitor.service also now specifies CPUQuota=10%.

The six grader IDs/start times and API, website and monitor start timestamps were identical before and after. Nothing restarted. The per-user limit remains 3. Browser refresh confirmed fresh resource readings and twelve running service rows; screenshot is in vm-setup/monitor-availability-20261011/fresh-dashboard.png.

The warning remains appropriate during actual monitor failure or another VM stall. This finite before/after test is not a guarantee of uninterrupted monitoring under every future workload.

## Evidence and recovery

Evidence/backup: /home/otog/worker-setup/monitor-availability-20261011, copied to D:\otog-grader\vm-setup\monitor-availability-20261011. Baseline timing.jsonl and follow-up timing-100ms.jsonl contain timings, resource states and cgroup counters without credentials. Saved before/after process records and zero-length comparison diffs confirm uninterrupted processes.

The rollback helper moves only the newly created budget drop-in into the evidence directory, reloads systemd definitions and restores the runtime CPUQuota=5%; it does not restart any service. Local transport: vm-setup/monitor-budget-admin.py rollback. The canonical deployment unit would also need its quota restored to 5% if undoing this correction permanently.
