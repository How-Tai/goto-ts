# Two service core comparison — 24 October 2026

Temporarily tested five enabled graders on CPUs 0–4, the idle compiler on CPU 5,
and API/web/nginx/ngrok/monitor/control/PostgreSQL/MinIO restricted to CPUs 6–7.
The sixth grader remained running on CPU 5 but paused. Compiler admissions were
held because its production launcher intentionally requires CPU 6; no compiler
source or Compose file was changed. No compiler jobs or submission writes were
generated. New real queue work would abort the experiment and restore admissions.
Original grader/compiler flags and CPU locations were restored after testing.

Workload matches the previous test: anonymous public HTML/API/PDF reads, roughly
five requests per virtual user per five seconds, 35-second paced stages plus
drain, and simultaneous 30/100 problem-page bursts. Generator ran outside the VM
through direct local port forwarding. Authenticated sessions, browser rendering,
WebSockets, submission processing, active compilation/grading, WAN latency and
long-duration soak remain untested.

## Corrected comparison

All values below are p95 / p99 in milliseconds. There were zero HTTP failures.

| Users | Traffic | Shared CPUs | Two service CPUs |
|---:|---|---:|---:|
| 30 | paced-browsing | 21 / 28 | 21 / 39 |
| 30 | simultaneous-page-load | 353 / 358 | 245 / 269 |
| 100 | paced-browsing | 46 / 74 | 134 / 190 |
| 100 | simultaneous-page-load | 724 / 752 | 882 / 908 |

The valid comparison contains 9,724 requests. At 100 browsing users,
two service CPUs produced 190 ms p99 versus 74 ms for corrected unrestricted
sharing (about 2.57×), while the synchronized burst produced 908 versus 752 ms
(about 1.21×). The two-core layout provides CPU separation with an absolute
sub-200-ms browsing tail in this sample, but unrestricted sharing remains faster
at 100 users. This is a single short run per layout, not a throughput guarantee
or proof of behavior while graders are busy.

## Affinity restoration correction

The first refreshed baseline was invalid: configured AllowedCPUs was empty,
but the effective kernel mask still restricted supporting services to CPU 7.
An empty systemd runtime update had cleared metadata without clearing the live
restriction. Those results were retained in `results-before-affinity-fix.json`
and `invalid-shared-*.json` and excluded from the comparison above.

The two-core stage used verified effective masks and thread affinities 6–7.
Its first metadata-only rollback similarly left the live mask at 6–7. This was
corrected by explicitly applying the full 0–7 mask before clearing the configured
property, then verifying kernel effective masks and every service thread. The
unrestricted baseline was rerun only after that correction. Its CPU samples show
work distributed across all eight CPUs. This also fixes the earlier one-core
test's incomplete rollback. Both reusable monitor scripts now verify effective
masks rather than relying only on systemd configuration metadata.

Final state: service effective masks 0–7 with empty AllowedCPUs configuration;
PostgreSQL/MinIO explicitly 0–7; graders on 0–5; compiler back on 6 with all ten
slots ready. All original enable flags are restored. Container identities and
restart counts, saved-result fingerprints and grading settings were unchanged.
HTTP health returned 200. No permanent new layout was applied.

Evidence: `tmp/site-two-core-loadtest-20261024/` and
`/opt/otog/site-two-core-loadtest-20261024/`.
