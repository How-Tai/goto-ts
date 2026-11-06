# Performance optimizations — 26 October 2026

Deployed to the VM and checked through the public HTTPS address. All six independent graders are enabled and healthy on CPUs 0–5; website/API services remain on CPUs 6–7.

## Changes

- Grading progress saves at most once per second per job instead of once per testcase. Final result persistence, watchdogs, cleanup, queue claims, compiler limits and testcase timing remain unchanged.
- Open pending submissions poll a small status endpoint every second. The browser retains already loaded source code, removes old verdicts during rejudges, and loads full details when grading completes. The endpoint uses the same visibility and source-sharing permissions as the full detail endpoint. Query cancellation reaches the underlying request.
- The grading dashboard initially loads the ten-minute resource history, then requests only newer samples. It still refreshes every second. Reconnects, expired cursors and restarts trigger a full history reset; stale resource readings retain the existing expiry behavior.
- The dashboard skips scanning all problem directories when no separate compiler workers are configured.
- Passed-user counts share a one-second cache and concurrent requests share one aggregate query. Counts can lag by up to one second after the previous aggregate finishes. Visibility, problem metadata and each user's latest submission are read afresh.

## Measurements

| Check | Before | After |
|---|---:|---:|
| Dashboard resource telemetry, uncompressed | 182,355 bytes | 4,419 bytes |
| Same telemetry with gzip | 24,225 bytes | 939 bytes |
| History samples in a normal one-second update | 600 | 1 |
| Aggregate count queries for 50 simultaneous identical reads | 50 | 1 |
| Progress writes for 1,000 callbacks over a simulated ten seconds | 1,000 | 10 |
| Real 20-testcase grading check, per language | 20 progress callbacks | 1 progress write + 1 final save |

Telemetry measurements use the same captured live sample, with the new update format retaining the latest sample. The initial load still sends full history. Payload sizes concern the resource telemetry component, rather than every field in the dashboard response. Gzip sizes use a local gzip encoder; nginx compression can differ.

Ten measured warm local HTTP requests per route, after two warmups:

| Route | Before median | After median |
|---|---:|---:|
| `/login` | 9.57 ms | 8.51 ms |
| `/problem` | 9.94 ms | 10.04 ms |
| `/contest` | 16.00 ms | 16.87 ms |
| `/backend/problem` | 10.84 ms | 5.37 ms |

These small idle samples measure local responses and do not establish a reliable percentile or user-visible speedup over ngrok. The main verified gains are reduced repeated database work and smaller polling responses. The final timing run occurred after the regression checks had finished.

## Validation

- API and frontend type checks and production build passed; minimum available RAM during the build was 1,516 MiB.
- Focused cache, privacy, polling, history merge/reset and stale-resource checks passed.
- Full API, permissions, session/login, chat and schema regressions passed using disposable data.
- Additional real HTTP checks cover the new progress endpoint: owner/admin access, anonymous private-source rejection, public shared-source access, no-store headers, minimal fields, invalid/missing IDs and live status transitions. Invalid resource cursors are rejected.
- Separate network-disabled grading checks accepted C, C++ and Python submissions, each with 20 testcases, score 100 and exactly one final result save. No production jobs were created or rejudged for testing.
- Built API, frontend and build-tool dependencies still scan with zero known CVEs using the retained vulnerability database. This does not change the previously documented host/vendor findings.
- Browser checks confirmed six connected graders, fresh resources, ten-minute history, submission source and expanded testcase results, with no console errors.
- Public login/problem/contest/API checks returned HTTP 200. PostgreSQL 18.6 and the patched Silo storage image remain in place.
- Final resource check: 2,652 MiB available RAM and 29.62 GiB free disk.

## Deployment and recovery evidence

Current release: `/opt/otog/performance-20261026/workspace`. Previous working release is retained at `/opt/otog/security-finish-20261026/workspace`.

The deployed grader change was applied to the exact VM source baseline; unrelated prepared-compiler differences in local maintenance source were preserved separately. Worker images, other mounts, CPU/memory/process limits and restart policies were verified unchanged. Compiler address-space limit remains 384 MiB, memory reservations remain off, and the per-user worker limit remains six.

`tmp/performance-20261026/evidence/` contains build hashes, deployment override paths, benchmarks, permissions/HTTP results and final health evidence. VM recovery copies are under `/opt/otog/performance-20261026/private/`, including the previous compose file and original grader source. Website deployment automatically rolls back if readiness checks fail; grader deployment restores the previous compose file and worker flags on failure. Both VM maintenance sources and local grader source were synchronized with backups.
