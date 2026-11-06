# Frontend rendering pass — 27 October 2026

Build tested in this pass: `S2IctHotw3S_5XRD5_b0P`. Superseded by the static layout in `STATIC-CONTEST-PROBLEM-20261027.md`. API bundle, six graders, CPU assignments, limits and watchdog settings were unchanged.

Retained changes initialize only requested server API clients with request-local authentication, remove an unused outer query provider, skip unused example-table observers, and reuse contest context instead of duplicate observers. Original library tabs and resize controls remain live.

## Final mixed contest benchmark

Same VM and six graders, 100 distinct synthetic ordinary accounts, a 40-second login ramp, three minutes of mixed browsing, and 200 ordinary submissions. These are direct VM timings, excluding public ngrok latency and quotas. Before/after runs are observations rather than a randomized A/B test; small differences may reflect scheduling variance.

| Request | Before p95 / p99 (ms) | Retained build p95 / p99 (ms) |
| --- | ---: | ---: |
| Open problem | 183.51 / 254.88 | 175.84 / 240.37 |
| Open contest | 179.17 / 233.81 | 150.83 / 223.00 |
| Upload submission | 187.44 / 257.83 | 153.44 / 191.59 |
| Own score | 61.32 / 94.31 | 59.64 / 88.41 |
| Open submission | 210.52 / 274.54 | 184.74 / 243.46 |
| 100 simultaneous problem opens after grading | 2178.39 / 2281.18 | 2243.06 / 2490.68 |

Normal journeys: 10,021 requests, zero unexpected responses or transport errors. All 200 uploads succeeded and all 200 submissions completed at their reference scores (166 accepted, 34 expected partial results). No new time-limit verdicts, watchdog activity, or worker restarts. Minimum available RAM 1777.4 MiB; maximum API database connections 17.

The separate deliberate 100-at-once login test produced 12 successes and 88 busy responses under the existing queue limit. Six statement checks returned known 404s because those contest PDFs are absent. Neither category is counted as successful normal browsing.

## Burst limitation and rejected experiments

Three repeated 100-user narrow bursts before/after the retained changes gave median p99 values: combined API 521.41 → 425.60 ms; Next page data 1058.55 → 906.44 ms; full HTML 1754.38 → 1741.36 ms. Full HTML performance did not materially improve. The mixed-workload final burst worsened, so this pass does not solve the simultaneous-page-opening bottleneck.

Custom workspace controls, a second frontend process, and Node memory tuning were tested and rolled back because they did not demonstrate a dependable overall improvement. Their source/evidence is archived under `tmp`; they are absent from active deployment configuration. Browser interaction checks passed for the rejected controls, but they did not justify retaining them for performance.

## Validation and recovery

Production build, typecheck, auth/session regressions, request-efficiency checks, and 100-interleaved-request authentication-isolation checks passed. No cross-user authentication cache was introduced.

Every test restored the original schedule and data fingerprints: 33 users, 621 submissions/results, zero contest 2 participants/scores. Contest 2 is restored to 15 October 2027, 09:00–13:00 Bangkok. Synthetic credentials and copied solution bodies were removed. Public HTTPS login/ping return 200; temporary frontend/preview services and experimental timers are inactive; one submission notification listener remains.

Evidence: `tmp/contest-render-final-20261027/summary.json`, `tmp/page-burst-fixed-20261026/timings.json`, and `tmp/page-render-efficiency-20261026/evidence/operational-check.json`.
