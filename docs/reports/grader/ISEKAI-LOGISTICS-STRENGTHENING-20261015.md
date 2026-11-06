# Isekai and Logistics: verified testcase improvements, 15 October 2026

Deployed to the running Linux VM. Problem 44 (IsekaiNoHajime) now has 31 cases and three all-or-nothing subtask groups worth 10, 20 and 70 points. Problem 38 (Logistics) now has 30 cases and retains proportional per-case scoring. Both still have a one-second time limit; memory remains 256 MB and 512 MB respectively.

## Isekai

The explicit three scoring rows in the statement determine the groups (the introductory sentence incorrectly says two groups):

| Points | Constraints | Cases |
| ---: | --- | --- |
| 10 | N, M, P, Q <= 2,000; every DMG <= 500 | 1,2,5,6,7,8,11,12,13,14,15,16,17,18,19,20 |
| 20 | N, M, P, Q <= 2,000 | 3,4,21,22,23,24,25 |
| 70 | Full published constraints | 9,10,26,27,28,29,30,31 |

Each group's score is awarded only when all of its cases pass. No dependency shortcuts are required. The native grader reads `subtask.json`; the database's numeric case count is 31, as required by its initial file-existence checks.

All ten original input/answer pairs were preserved byte-for-byte. Added 21 cases covering no usable plane, singleton terrain, exact lethal-day boundaries, impossible kills, oversized planes, several separate topmost planes, component merging, non-monotone damage, repeated/rising lasers after irreversible cuts, independent dimension extremes, and maximum-size inputs. Existing large cumulative-damage stress remains valid: overflow can be avoided by capping cumulative damage above all possible HP values.

Added a problem-specific integer-token checker. Equivalent spaces, tabs and line breaks are accepted; the exact Q integer answers in order are still required. Missing, extra, malformed, overflowed or wrong tokens are rejected. Infrastructure/jury-data failures remain checker errors rather than contestant verdicts.

## Logistics

Kept all ten existing cases and added 20. New coverage includes S=D, F=1, full tank on arrival, voucher placement, cheap-fuel detours and revisits, relabeled paths with equal and varying prices, 100 cities, and graphs up to the maximum 4,950 roads. Every candidate is connected, has distinct undirected edges, and satisfies the published bounds for prices, capacity, endpoints and road fuel requirements.

Found and repaired invalid parallel roads in original cases 9 and 10. Case 9 had 300 road entries but 291 unique undirected pairs; case 10 had 500 entries but 486 unique pairs. Retained the minimum fuel requirement for each pair. Longer parallel edges are dominated because having more remaining fuel never increases the minimum achievable expense. Both independently recomputed expected answers match their original answer files. Cases 1–8 and every original Logistics answer file remain unchanged.

## Verification

- All 61 saved answers matched two reference implementations. Isekai: Python DSU activation versus C++ ordered-set interval splitting with 128-bit accumulation; small saved cases also checked with a direct terrain simulation. Logistics: Python layered voucher-state Dijkstra versus two C++ fuel-state Dijkstra passes connected by one free refill.
- Another 250 seeded small Isekai instances passed all three models; 150 seeded small Logistics instances passed both references.
- 165 direct Isekai checker executions covered equivalent whitespace, correct tokens, wrong answers, missing/extra tokens, numeric syntax and overflow.
- Actual sandbox grading at the production one-second limits: correct Isekai solution with one answer per line scored 100 (10/20/70); intentionally restricted solutions scored exactly 10 and 30; invalid output scored 0. Maximum correct-reference case CPU time observed was 508 ms.
- Correct independent Logistics solution and existing accepted submission 591 both scored 100/100 across all 30 cases; maximum case CPU time observed was 20 ms for each. These were private offline runs, not new database submissions.
- Deliberately incorrect Logistics variants that omit final tank filling or omit the voucher were rejected by the data.
- Live deployed file hashes equal the tested candidate hashes. All six workers can see the full new bundles, checker and subtask configuration.
- Post-deployment: both problem pages returned HTTP 200 through localhost and ngrok; all six workers were enabled with fresh heartbeats; API, web, nginx, ngrok and monitor were active; no new Judge Errors in the preceding 15 minutes. Guest available RAM was 2,662 MiB and swap usage zero at this snapshot.

These checks strengthen coverage; they do not constitute a proof that every incorrect program will fail or that every implementation has the same performance margin under load.

## Deployment and recovery

Original folders and settings were backed up before generation. Before switching live data, new claims were paused and current jobs were allowed to finish. Live settings and all source file hashes were checked against their preparation snapshots. Both folders were switched and numeric case counts updated transactionally while claims remained paused, with rollback handling for failures. Existing worker pause preferences were restored afterward.

Existing submission results, testcase verdicts, contest scores/history and the per-user worker limit were unchanged, verified by database fingerprints. No grader or website service restarted. The six-worker configuration and removed automatic TLE retry feature remain unchanged. Historical submissions were not automatically rejudged, so old scores still describe the earlier bundles until explicitly rejudged.

Backups/evidence on D:

- `vm-setup/strengthen-original-20261015.tgz`: original statements, testcase folders and problem settings.
- `vm-setup/strengthen-evidence-20261015.tgz`: manifest, verification results, deployment snapshots and reusable testcase ZIPs.
- `vm-setup/strengthen-evidence-20261015/problem-44-strengthened-20261015.zip`: complete Isekai upload bundle, including both `subtask.json` and `check.cpp`.
- `vm-setup/strengthen-evidence-20261015/problem-38-strengthened-20261015.zip`: complete Logistics upload bundle.

For future Isekai testcase uploads, include the checker and subtask file in the ZIP and keep the numeric case count consistent with the bundle. Uploading a replacement ZIP without these files can remove its custom scoring/checking behavior. Original statement PDFs were not edited.
