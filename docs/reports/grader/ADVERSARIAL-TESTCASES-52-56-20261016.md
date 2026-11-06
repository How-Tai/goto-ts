# Adversarial testcase review: problems 52–56

**Current user-selected rule:** After reviewing the inconsistent statement, the user explicitly requested that 632 be correct. Inversion now uses `i < j && Xi < Xj && Yi > Yj`, matching the sample. The intervening any-pair change has been superseded. Current verification and bundles are in [INVERSION-SAMPLE-ORDER-20261016.md](INVERSION-SAMPLE-ORDER-20261016.md). Problems 52–55 are unaffected; this document otherwise records the earlier audit.

Deployed 16 October 2026, 10:46:35 Asia/Bangkok (03:46:35 UTC).

The initial release tested too few incorrect implementations. This broader review found concrete escapes in World Cup and Hospital02, added targeted counterexamples, and expanded the other suites. No finite suite proves rejection of every incorrect program; the checks below describe the actual coverage verified.

## Installed cases

| ID | Problem | Previous | Added | Current |
|---|---|---:|---:|---:|
| 52 | Fruit | 30 | 8 | 38 |
| 53 | World Cup | 30 | 16 | 46 |
| 54 | Hospital02 | 30 | 4 | 34 |
| 55 | NPK_Tull | 36 | 12 | 48 |
| 56 | NPK_Inversion | 30 | 20 | 50 |

Total 216 cases, with 60 added. Every original `.in` and `.sol` remains byte-identical. World Cup and Tull retain their published scoring-band weights; `subtask.json` lists now include the added cases in the appropriate bands.

## Confirmed escapes and repairs

| Problem | Incorrect implementation | Old actual judge score | New actual judge score |
|---|---|---:|---:|
| World Cup | Sort by points and goal difference, omitting goals scored | 100 | 93 |
| Hospital02 | Truncate returned names to 7 characters | 100 | 88 |
| Hospital02 | Truncate returned names to 8 characters | 100 | 88 |
| Hospital02 | Truncate returned names to 11 characters | 100 | 88 |

World Cup's existing cases did include tied points and goal differences, but their input order happened to agree with the required final tie-break. Cases 31, 32, 41 and 45 now reject the omitted criterion.

Hospital02's only maximum-length input name was left uncalled, so its exact returned spelling was never checked. New cases 31–34 call maximum-length names, including names sharing their first eleven characters, mixed capitalization, FIFO ties and close priorities.

## Broader mutation audit

75 deliberately faulty algorithm variants were evaluated against the saved inputs and expected answers:

- Fruit: 14 variants covering greedy decisions, perimeter-only paths, incomplete DP initialization, wrong iteration order, missing endpoints and incorrect accumulation.
- World Cup: 16 variants covering omitted/reversed sorting criteria, goal totals versus differences, conceded-goal criteria, lexical order, and incorrect win/draw/self-match scoring.
- Hospital02: 8 variants covering name truncation, LIFO/lexical priority ties, minimum-priority selection, priority clipping and arrival-index wraparound.
- Tull: 10 variants covering wrong MEX, incorrect K formulas, using only endpoint frequencies, counting irrelevant values above MEX, and mishandling MEX=0.
- Inversion: 27 variants covering non-strict comparisons, missing age/height conditions, unordered pairs, reversed directions, sorting away the input order, coordinate truncation, missing boundaries, limited windows/loop bounds, narrow counters and dividing the result by two.

All 75 variants now disagree with at least one case. Four variants escaped the original suite, as shown above. Every variant has a recorded concrete witness in `mutation-witnesses.json`; the manifest retains old/new failure case lists.

An apparently suspicious Fruit variation allowing a down-right diagonal was excluded from the faulty set: all values are positive, so any such diagonal can be replaced by right/down steps with a greater sum. It cannot improve the optimal answer under these constraints. Algorithms were not labeled incorrect merely because their implementation differed from the reference.

Additional cases include multi-turn and delayed-greedy Fruit grids; generated World Cup comparator counterexamples; called long Hospital02 names; Tull interior frequency bottlenecks and irrelevant rare tails in every size band; and minimal plus N=5000 Inversion coordinate/tie relations.

## NPK Inversion and submission 632

The user did not supply a specific submission ID during this run. Recent entries were inspected read-only: 632 was accepted, while 633 and 634 were rejected.

Submission 632 directly enumerates `i < j` and counts `x[i] < x[j] && y[i] > y[j]`. This exactly implements the current sample-derived interpretation, so a valid testcase cannot make that program return a wrong answer under that rule. Its strengthened-suite score remains 100, with maximum measured testcase CPU **30 ms** under the unchanged **100 ms** limit. O(N²) is not itself an error at N≤5000; there are at most 12,497,500 index pairs.

The statement ambiguity documented in the initial report remains: its sample requires input order, while the prose does not explicitly spell out `i < j`. This run preserved the sample-derived rule and did not rewrite the statement or silently switch to unordered pairs. If another program was intended by the user's report, its ID/code is still needed to assess that specific escape.

All 27 Inversion faulty variants were already rejected by the previous suite. The extra 20 cases improve focused boundary/tie coverage; they do not intentionally reject submission 632.

## Correctness and real judge checks

New expected answers were cross-checked by independent implementations: rolling versus reverse grid DP, pairwise match scoring versus row totals, Python stable heap versus C++ priority queue, frequency counts versus sorting, and direct pair enumeration versus a compressed two-dimensional Fenwick reference. All generated inputs were checked against the existing statement constraints. Original answers were also checked during the mutation audit.

35 actual isolated grader runs passed: 27 full-suite/reference/mutant/scoring regressions and eight direct old-versus-new escape checks. Seven reference implementations and real accepted submissions 627, 628, 629 and 632 all scored 100 on their strengthened suites.

Representative maximum testcase CPU: Fruit 5 ms; World Cup 7 ms; Hospital02 reference 296 ms; Tull sorting 2574 ms; Tull streaming 1253 ms; Inversion pair enumeration 33 ms; compressed Fenwick 18 ms. These are measured runs, not a guarantee that host load cannot affect runtime.

World Cup restricted-to-distinct-points code still scores exactly 40. Tull size-gated solutions still score exactly 10/30/50/60 at N thresholds 5/20/10000/200000. This verifies the preserved scoring bands through the actual judge.

## Safe deployment and verification

- Backed up the live suites, statements, metadata and recent submission source snapshots before preparation.
- Prepared and tested offline in CPU/memory-limited containers; no live submissions or results were inserted for testing.
- Compared live data and settings with the prepared snapshot before installation, paused new claims and drained in-flight work, then swapped the five source directories and updated case counts transactionally with rollback inputs prepared.
- All six grader container IDs/start times and all website/monitor service start times remained identical. No grader or website restart was required.
- Historical result, verdict, contest-score and contest-history fingerprints remained identical. Historical submissions were not automatically rejudged.
- Visibility and all time/memory limits remained unchanged. These five problems were already public at the start of this run.
- NPK Tull's global one-worker limit remained `problemId=55, maxWorkers=1`; the per-user cap remained 6. Original worker enabled flags were restored, all six listeners/heartbeats were healthy, and no concurrency violations were present.
- Available VM RAM after deployment approximately 2598 MiB, swap used 0, disk free approximately 40 GiB. Temporary test containers were removed automatically.

## Artifacts on D

- Before backup: `vm-setup/adversarial-52-56-original-20261016.tgz`.
- Evidence: `vm-setup/adversarial-52-56-evidence-20261016.tgz`.
- Extracted evidence and five updated uploadable ZIPs: `vm-setup/adversarial-52-56-evidence-20261016/`.
- Witness index: `mutation-witnesses.json`; full audit: `manifest.json`; measured tests: `tests-passed.json` and `escaped-models-passed.json`.
- Preparation, mutation models, judge verification and activation scripts: `vm-setup/*adversarial*20261016*` and `*escaped-models*20261016*`.

Downloaded ZIP hashes and every archived member were verified against the deployed manifest. No environment files, passwords or authentication secrets are included in the evidence archive.
