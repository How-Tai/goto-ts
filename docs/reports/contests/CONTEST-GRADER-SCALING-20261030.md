# Contest 2: 100 users, one through seven graders — 30 October 2026

Completed on the existing VM and deployed independent graders. No application code, grader limits, memory policy, watchdogs or per-user/problem limits were changed. The real admin allocation endpoint selected N workers on CPUs 0–N−1; ordinary services used the remaining CPUs through 7.

Each configuration used 100 temporary ordinary accounts with a 40-second NextAuth login ramp, 500 complete problem HTTP paths over a fixed two-minute browsing schedule, and 100 C++ uploads spread over 15 seconds. Each user submitted one solution. The same five previously accepted reference solutions for problems 67, 69, 70, 71 and 72 were used, 20 copies each; SHA-256 hashes match between the primary series and repeat. Users browsed all six contest problems, fetched their scores/submission lists and polled pending results with staggered intervals. HTML was followed by parallel session/problem-data reads, matching the current startup sequence. Submissions were allowed to drain fully after the browsing interval.

Traffic passed through the existing nginx/web/API via an SSH port forward. It excludes ngrok/internet latency, JavaScript/CSS/asset downloads, browser rendering and PDFs. Actions were staggered. Percentiles use nearest rank. These are short sequential runs with warm caches, not randomized repeated trials; small differences should not be generalized to every workload.

## Main results

Web values are complete HTML/session/problem-data paths in milliseconds. Verdict values are server queue-to-result times in seconds, including compilation and evaluation.

| Graders | Service CPUs | Web p50 | Web p95 | Web p99 | Verdict p50 | Verdict p95 | Verdict p99 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1–7 | 28.33 | 54.37 | 64.88 | 169.797 | 321.050 | 334.090 |
| 2 | 2–7 | 28.42 | 51.09 | 57.01 | 90.541 | 168.869 | 175.567 |
| 3 | 3–7 | 29.98 | 64.65 | 89.04 | 61.910 | 114.691 | 120.131 |
| 4 | 4–7 | 32.56 | 77.64 | 141.58 | 46.987 | 87.141 | 90.708 |
| 5 | 5–7 | 34.83 | 80.56 | 119.39 | 40.532 | 72.275 | 75.826 |
| 6 | 6–7 | 47.88 | 292.89 | 350.42 | 33.791 | 59.685 | 62.315 |
| 7, repeat | 7 | 473.44 | 1965.59 | 2255.14 | 31.611 | 56.011 | 58.805 |

| Graders | Upload p95 / p99, ms | First upload to last observed result, s | Claim-to-completed median, s | Minimum sampled available RAM, MiB |
| --- | ---: | ---: | ---: | ---: |
| 1 | 32.16 / 39.59 | 353.701 | 3.447 | 4260.8 |
| 2 | 37.10 / 74.96 | 191.157 | 3.770 | 4084.1 |
| 3 | 40.63 / 69.41 | 137.946 | 3.995 | 3953.4 |
| 4 | 41.99 / 49.56 | 109.900 | 4.144 | 3765.5 |
| 5 | 52.13 / 68.12 | 91.573 | 4.356 | 3681.2 |
| 6 | 61.49 / 84.80 | 79.662 | 4.462 | 3517.1 |
| 7, repeat | 142.44 / 218.71 | 76.168 | 4.934 | 3314.4 |

The observed batch time includes the upload ramp and final client polling delay; server queue-to-result times are preferable for verdict latency. Claim-to-completed includes worker preparation, compilation, testing and result persistence, rather than only program execution. Sandbox cleanup can follow the completed log event.

All seven displayed configurations accepted **100/100 submissions**, with **1,000/1,000 testcase results accepted** each. There were **zero unexpected HTTP responses, failed uploads, failed page paths, verdict mismatches or watchdog/recovery events**. All expected workers were observed claiming jobs, and sampled peak simultaneous grading matched the selected count. The primary comparison contains **36,839 HTTP attempts, 3,500 complete page paths and 700 submissions**. Including the original seven-worker run, all **800 benchmark submissions** were accepted.

For this workload, five graders give a useful balance: three CPUs remain for ordinary work, web p99 is about 119 ms, and verdict p99 about 76 seconds. Six improves verdict p99 to 62 seconds while web p99 rises to 350 ms. Moving from six to seven saves about 3.5 seconds at verdict p99 while web p99 rises to 2.26 seconds. Individual job time also grows with concurrency despite separate CPU masks; isolation does not remove shared VM/host resource effects. The benchmark does not identify one exclusive hardware cause of that increase.

## Concurrent real activity and repeat

Four real submissions from account 1 arrived during the first seven-worker run, at IDs **770–773**, with one overlapping the start of browsing. They were accepted and created real contest registration/score records. The cleanup fingerprint guard refused to rewind the counter or call the original database unchanged.

The temporary accounts/submissions were removed. Filtered fingerprints proved every original row remained unchanged, with only the four real additions and their related result/score/registration records present. These real records were preserved. A locked fingerprint guard reset only the temporary sequence tail to next ID **774**; no published IDs were renumbered.

The seven-worker workload was repeated using the exact original source IDs, against the new baseline of 33 users and 626 submissions/results. Its cleanup fingerprints passed with no further concurrent changes. The original seven-worker run is retained in the evidence: web p50/p95/p99 **370.66 / 2313.52 / 2752.22 ms**, verdict p50/p95/p99 **31.608 / 54.065 / 56.877 s**, all 100 accepted and zero HTTP failures. Both seven-worker runs show a substantial web tail compared with five/six workers; the repeated run is used in the main table, rather than hiding the earlier measurement.

## Final state and recovery

- Original selected count **6** and original individual pause flags restored. All graders were paused before this benchmark and remain paused.
- Contest 2 restored to **15 October 2027, 09:00–13:00 Bangkok**.
- **33 users, 626 submissions/results**, including the four preserved real submissions. No benchmark accounts or active/queued submissions remain. Next submission ID **774**.
- Temporary fixture passwords and source copies removed. Restore timers stopped. Web/API processes were not restarted, grader identities/restart counts unchanged, watchdogs and limits retained.
- Final available memory approximately **4,428 MiB**. Small benchmark evidence files are retained; no additional application build workspace was created.

The public postflight initially found ngrok offline because the VM's configured DNS server **172.20.10.1** timed out. A direct DNS probe of the local NAT resolver **10.0.2.3** succeeded. The VM interface received a **runtime-only** DNS override, resolver caches were flushed, and ngrok was restarted. Persistent network files were not changed. Public HTTPS `/login` and `/backend/ping` then returned **200**. This operational recovery occurred after the timed benchmark and does not affect the direct-VM measurements. Runtime DNS can be reverted with `resolvectl revert enp0s3`.

Local evidence and runners: `tmp/contest-grader-scaling-20261030/` and `tmp/contest-grader-scaling-repeat-20261030/`. VM evidence: `/opt/otog/contest-grader-scaling-20261030/` and `/opt/otog/contest-grader-scaling-repeat-20261030/`. The combined machine-readable results are in local `matrix-summary.json`; raw HTTP rows, worker events, testcase timings, resource samples and guarded recovery reports remain available. The final public/data check is `evidence/postflight.json`.
