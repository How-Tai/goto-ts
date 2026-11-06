# Problems 52–56: statement review, testcases and NPK Tull concurrency

**Current user-selected rule:** The user explicitly chose Inversion's sample interpretation, `i < j && Xi < Xj && Yi > Yj`, so 632 is correct. The intervening any-pair change has been superseded. See [INVERSION-SAMPLE-ORDER-20261016.md](INVERSION-SAMPLE-ORDER-20261016.md) for current verification and bundles. Other problems are unaffected.

This documents the initial release. A subsequent adversarial audit found and repaired additional coverage gaps; current counts and evidence are in [ADVERSARIAL-TESTCASES-52-56-20261016.md](ADVERSARIAL-TESTCASES-52-56-20261016.md).

Deployed 16 October 2026, 09:48:56 Asia/Bangkok (02:48:56 UTC).

## Installed suites

| ID | Problem | Cases | Main coverage | Limits |
|---|---|---:|---|---|
| 52 | Fruit | 30 | Both samples; 1×1; single row/column; rectangular grids; greedy traps; equal values; diagonals/perimeters; 15×15 grids and values 1–1000 | 1 s / 64 MB |
| 53 | World Cup | 30 | Both samples; points, goal difference, goals scored; all-points ties; negative goal differences; input permutations; mixed-case names including 20 characters; valid match totals ≤10 and no unresolved full ties | 1 s / 32 MB |
| 54 | Hospital02 | 30 | Samples; strict maximum priority; FIFO on equal priority; interleaved arrivals/calls; priority 1 and INT_MAX; mixed-case/long names; empty output; refill cycles; 500,000-command boundary including Exit | 1 s / 64 MB |
| 55 | NPK_Tull | 36 | Six published size bands; no zero; all zero; full permutations; missing interior values; unequal frequencies; rare irrelevant tail values; bottleneck prefixes; three N=10,000,000 cases | 4 s / 1024 MB |
| 56 | NPK_Inversion | 30 | Sample; input-order traps; strict age and height comparisons; duplicates; equal ages/heights; shuffled input; N=5000; zero and maximum 12,497,500 answers | 0.1 s / 128 MB |

156 input/answer pairs, with canonical `1.in`/`1.sol` naming. All problems were hidden before work and remain hidden; publishing was not requested. No statement PDFs were edited.

Scoring follows the percentages in the statements: World Cup has 40 points for distinct-point cases and 60 for tied-point cases. Tull has 10/10/10/20/10/40 points across N≤5, 6–10, 11–20, 21–10000, 10001–200000 and 200001–10000000. Scores are proportional within each band (`group: false`); the statements do not specify all-or-nothing groups. Actual grader tests confirmed the intended totals.

## Statement issues and interpretations

- **Hospital02, second sample:** input has `PPO`, while the output prints `PPo`. Generated outputs preserve the input name exactly; the equivalent sample case therefore returns `PPO`.
- **Inversion:** the prose does not explicitly write `i < j`, but its sample requires input order. Counting unordered qualifying students gives 7; applying `i < j`, `Xi < Xj`, `Yi > Yj` gives the stated 5. The generated cases follow that sample. This interpretation should be made explicit if the statement is revised.
- **Inversion time limit:** initially the database held 1000 ms, whereas the PDF specifies 100 ms. All sandbox validation used 100 ms. A preflight detected that the live setting had already become 100 ms during preparation; deployment preserved that current setting.

The original PDF snapshots are in `vm-setup/problems-52-56-original-20261016/original/docs/`.

## Independent answer checks

- C++ reference executable independently checked every saved answer against Python oracles.
- Fruit: forward DP versus reverse DP, plus 150 exhaustive small-grid path enumerations.
- World Cup: pairwise match scoring versus row/column totals, including 500 additional valid matrices.
- Hospital02: Python heap versus C++ stable priority queue, plus 150 direct stable-selection simulations.
- Tull: direct frequency counts versus sorting/run lengths. Exhaustively enumerated all multiset partitions for 350 small multisets, plus 30 additional random partition checks. The MEX is the original multiset MEX; K is N if MEX=0, otherwise the minimum frequency below MEX.
- Inversion: compressed two-dimensional Fenwick counting versus direct C++ pair enumeration, plus 200 randomized direct-pair checks.

Total: **1,380 additional independent checks**, plus all 156 saved answers.

## Actual judge verification

17 isolated judge runs used the deployed grader image `otog-grader:glibc-20261012`, real Isolate sandbox, production compiler flags and time factor 1. Tests ran on spare VM CPU 6, without creating submissions or results in the live database.

| Reference | Score | Maximum testcase CPU | Maximum testcase memory |
|---|---:|---:|---:|
| Fruit DP | 100 | 8 ms | 3456 KiB |
| World Cup | 100 | 5 ms | 3456 KiB |
| Hospital02 stable priority queue | 100 | 340 ms | 23908 KiB |
| Tull sorting | 100 | 2639 ms | 42112 KiB |
| Tull streaming counts | 100 | 1318 ms | 42240 KiB |
| Inversion direct O(N²) | 100 | 32 ms | 3584 KiB |
| Inversion compressed Fenwick | 100 | 18 ms | 4224 KiB |

Deliberately incorrect solutions scored below 100: Fruit greedy 57, World Cup points-only 60, Hospital02 LIFO ties 33, Tull N/MEX approximation 67, Inversion ignoring input order 40. A World Cup solution restricted to distinct points scored exactly 40. Tull solutions gated at N=5/20/10000/200000 scored exactly 10/30/50/60.

These are measured reference runs, not guarantees that runtime is unaffected by simultaneous production load.

## Global NPK Tull limit

The database now contains `otogProblemGradingLimit(problemId=55, maxWorkers=1)`. The six-worker scheduler consults this table when claiming jobs. A transaction-scoped per-problem advisory lock and a fresh active-lease count prevent concurrent claims from exceeding the limit. It covers the entire submission, including compilation and grading, for ordinary submissions, contests and rejudges, across all users.

Extra Tull submissions stay waiting. Other problems can use other workers, including submissions from the same user when the user's configured cap permits them. FIFO is retained among eligible jobs and among Tull submissions. Existing per-user limits, pause controls, worker recovery and result/contest-score persistence remain in place. The policy survives restarts; its foreign key follows problem ID updates and removes the policy when the problem is deleted.

Migration: `20261016020000_problem_grading_limit`. Prisma schema validation passed. Generated Prisma clients did not need rebuilding because the scheduler accesses this operational table directly through SQL; no API/web application code changed.

Isolated PostgreSQL tests passed **40 rounds with six simultaneous claimers (240 claims)** at problem caps 1 and 2. Also checked per-user caps 1/2/3/6, FIFO, other-problem progress, busy locks, cap release, worker recovery/reconnect, pause/resume, foreign-key cascades, invalid cap rejection and policy-change wakeups. Temporary databases were removed afterward.

## Deployment and health

- Original statements, settings and compose configuration backed up before preparation.
- Deployment compared live hashes/settings with the prepared snapshot and preserved the already-corrected Inversion limit.
- Paused new claims, drained in-flight jobs, installed cases and migration, and recreated only the six grader containers with the verified queue module. Existing CPU assignments and restart policies retained.
- Restored all original worker enabled flags. All six were enabled, connected and reporting fresh heartbeats; all six queue listeners were present.
- Result, verdict, contest-score and contest-history counts/content fingerprints were identical before/after deployment. The per-user cap remained 6. No production submissions were inserted or rejudged.
- API, web, nginx, ngrok and monitoring service start timestamps were unchanged. Localhost and ngrok returned HTTP 200 after deployment.
- Post-deployment VM available RAM approximately 2633 MiB, swap used 0, free disk approximately 40 GiB.

Rollback inputs include original settings, source snapshot, baseline queue module, previous compose/schema, and conditional problem-setting rollback SQL. Packaging initially encountered an unnecessary ownership-change error after successfully writing the archive; the ownership step was removed. The completed archive was fetched and its bundle hashes verified; live deployment was unaffected.

## Saved on D

- Original backup: `vm-setup/problems-52-56-original-20261016.tgz`.
- Evidence archive: `vm-setup/problems-52-56-evidence-20261016.tgz`.
- Extracted logs/manifests: `vm-setup/problems-52-56-evidence-20261016/`.
- Uploadable testcase ZIPs in that evidence folder: `problem-52-testcases-20261016.zip` through `problem-56-testcases-20261016.zip`.
- Maintained queue source: `src/worker_queue.py`; deployment scripts: `vm-setup/*52-56*20261016*` and `*problem-limit*20261016*`.

No signing keys, Cloudinary credentials, passwords or environment files are included in the evidence archive.
