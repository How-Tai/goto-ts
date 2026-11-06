# Submission results after direct AMD-V — 12 October 2026

Windows restarted at 11:30:29 Bangkok. Memory Integrity is configured off, VBS reports status 0, SecurityServicesRunning reports 0, and HypervisorPresent is false. The new VM log opened at 11:31:49 confirms `HM: HMR3Init: AMD-V w/ nested paging` and `HM: Using AMD-V implementation 2.0`.

Read-only checks of user-initiated production regrades found the following results. The checker did not start regrades, add queue jobs, change time limits or manually assign verdicts. Source hashes match the prior saved records.

| Submission | Problem / implementation | Earlier result and maximum testcase time | Current result and maximum testcase time |
| --- | --- | --- | --- |
| 377 | Beautiful Number, hash fc015bd5db2e5ccb | TLE, 40/100, 3.070 s | AC, 100/100, 2.128 s |
| 234 | Omakaza, sorting, hash 61db3dae3fcb | TLE, 90/100, 1.090 s | AC, 100/100, 0.457 s |
| 245 | Omakaza, sorting, hash 6d5cad948ec4 | AC, 100/100, 0.980 s | AC, 100/100, 0.509 s |
| 343 | Omakaza, sorting, hash 7d52b8aa0d0f | AC, 100/100, 0.797 s | AC, 100/100, 0.486 s |
| 381 | Omakaza, sorting, same source as 234 | AC, 100/100, 0.973 s | AC, 100/100, 0.407 s |
| 443 | Omakaza, frequency counting, hash 312ac8de3610 | AC, 100/100, 0.073 s | AC, 100/100, 0.048 s |

Earlier Omakaza records come from the pre-switch snapshot `vm-setup/omakaza-evidence-20261012/submissions.json`. The 377 pre-switch result was directly inspected during the investigation recorded in `BEAUTIFUL-NUMBER-377-20261012.md`. New result update times range from 11:34:24 to 11:35:44 Bangkok.

Two Omakaza frequency-counting submissions that previously had compilation-deadline errors, 424 and 433, now have AC results at 0.058 and 0.061 s respectively. Their old errors did not provide program-runtime measurements, so no speed ratio is calculated for them.

All five API/web/nginx/ngrok/monitor services were active, all six grader containers were up, PostgreSQL was healthy and MinIO was running. All six worker IDs had distinct active submission leases in the inspected snapshot. The queue was actively draining user-requested regrades. The inspected current-boot kernel log had no soft-lockup, RCU-stall or OOM messages.

These are actual production regrades of unchanged sources, with different concurrent load between old and new runs. They demonstrate substantial improvement in the inspected submissions; they are not a controlled claim of one universal speedup factor or proof that future stalls are impossible.
