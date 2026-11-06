# Web request optimizations — 24 October 2026

Deployed API and frontend; all six independent graders and database containers
kept their existing running instances. Supporting services remain on CPUs 6–7.

- All five submission forms now upload once. The API checks the current keyword
  rules before admitting the submission. Structured errors retain the required,
  banned and missing keyword lists. Invalid submissions neither enter the queue
  nor create contest membership. Enrollment and admission commit together.
- Both problem editors load on first use and remain mounted afterward to retain
  drafts. Submission tables mount only while their tab is selected.
- Statement embeds and all PDF download links target the API document endpoint
  directly. The old redirect route remains for older open pages.
- PDFs use private mandatory revalidation with ETag and Last-Modified. Access is
  checked before a 304 response, including for problems subsequently hidden and
  sessions subsequently revoked. A matching validator avoids opening the stream.
- Pending submission results refresh every second, stop on completion, and use
  React Query's existing request deduplication and foreground behavior.

API and web TypeScript checks passed. A disposable PostgreSQL database containing
the production schema, synthetic accounts and synthetic problems exercised the
real old/new API builds over HTTP. Keyword errors, all three languages, current
rule changes, active/future contests, upload limits, queue caps and PDF access
revalidation passed. No test submissions were created in production. A browser
check confirmed zero editor instances before first opening it, and retention of
a typed draft after switching tabs.

## Before and after

Submission figures below are the median of three short synchronized-load runs
per configuration, three submissions per user per run. Both configurations used
the same isolated database schema, a 12-connection pool and CPUs 6–7. The old
flow performed a keyword GET followed by an upload POST; the new flow performed
only the POST. Requests included real authentication, database reads and writes.
The load generator shared the VM's service CPUs. These are local stress-test
timings, not typical Internet submission times or a throughput guarantee.

| Submission load | Before p50 / p95 / p99, ms | After p50 / p95 / p99, ms |
| --- | --- | --- |
| 30 users | 202 / 305 / 315 | 167 / 250 / 264 |
| 100 users | 675 / 932 / 1092 | 556 / 683 / 750 |

For one 67,782-byte statement, 20 sequential full-document actions had median
latency 8.32 → 5.99 ms. Twenty repeat actions went from 7.67 → 3.69 ms; the new
flow returned 304 with zero PDF body bytes, while the old flow downloaded the
document again. Both flows began with the page's corresponding document URL;
the old URL required an additional redirect request.

Public browsing used the same external Windows load generator, local forwarded
connection, route mix and 35-second paced stages before and after. It generated
no grading load. All read requests and valid submission benchmark actions
completed without unexpected HTTP errors.

| Browsing workload | Before p95 / p99, ms | Initial after p95 / p99, ms |
| --- | --- | --- |
| 30 paced users | 33 / 80 | 33 / 62 |
| 30 simultaneous problem-page requests | 348 / 357 | 321 / 329 |
| 100 paced users | 175 / 250 | 215 / 522 |
| 100 simultaneous problem-page requests | 907 / 943 | 960 / 988 |

Because the initial 100-user tail was worse, two further paced runs were made.
They measured p95/p99 of 225/317 and 69/122 ms. This variability does **not**
establish a consistent overall browsing-tail improvement. Browser rendering,
public ngrok/WAN latency and controlled simultaneous grading were not benchmarked.
Editor deferral and the one-second result interval were functionally checked;
their end-to-end timing improvements were not measured.

The live dashboard reports six connected workers on CPUs 0–5, no central
compiler, fresh telemetry, memory reservations off and a per-user limit of 6.
The latter was adjusted during the work; the deployment does not reset it to
the earlier snapshot's value of 5.

Evidence and scripts: `tmp/web-request-20261024/`. VM backups and build records:
`/opt/otog/web-request-20261024/`, including `api-dist.before`, `source.before/`
and the previous frontend runtime in `before.json`. No database migration or
grading-setting change is part of this release. Restoring the previous API
distribution and removing only this release's web systemd override restores
the previous application release; preserve later user settings when doing so.
