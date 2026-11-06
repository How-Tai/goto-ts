# Problems 47-51: stronger verified testcases

Completed 16 October 2026 (Bangkok). Each problem now has 30 testcase pairs: all ten existing pairs preserved byte-for-byte, plus 20 new cases. Total: 150 cases, including 100 additions. Original statements, time/memory limits, scoring model and Factory's custom checker remain unchanged.

## Coverage and constraints

| ID | Problem | Added coverage |
| ---: | --- | --- |
| 47 | Hospital | Exit with no patients; no calls before Exit; priorities 1 and INT_MAX; lowercase names of lengths 1-7; shuffled and interleaved priorities; empty/refill cycles; maximum waiting queue; exactly 400,000 commands including Exit. Every priority is globally unique and every Call has a waiting patient. |
| 48 | Factory | Minimum valid three factories; maximum 1,000 factories; profits at -1,000 and 1,000; all-negative/all-positive/zero arrays; non-monotone prefix sums; alternating signs; zero-sum blocks; multiple optimal splits; seeded mixed arrays. Every partition has three nonempty contiguous groups. |
| 49 | Matrix Addition | 1x1, one-row/one-column, rectangular and 100x100 matrices; input values at +/-2,000,000,000; cancellation, mixed signs and output sums reaching +/-4,000,000,000. All input values stay within their specified bounds. |
| 50 | Word | 1x1, one-row/one-column and 25x25 boards; targeted 15-letter words in each of the eight directions; case folding; repeated matches/prefixes; row-before-column tie-breaking; 100 queries. Every word has length 1-15 and appears on its board. |
| 51 | Backup | N=2 and N=100,000; K=1 and K=floor(N/2); odd N; coordinate endpoints 0 and 1,000,000,000; greedy traps; contraction/tie patterns; uneven spacing and large nearly-perfect matchings. New coordinates are strictly increasing, remain within bounds, and always have 1 <= K <= N/2. |

Hospital's empty saved output is intentional in cases with no Call commands; actual sandbox grading confirmed those cases work. Factory inputs use N >= 3 to provide a valid instance with three nonempty groups; its original statement was not edited.

## Independent answer verification

All 150 answers passed structural and semantic validation:

- Hospital: Python priority heap versus C++ ordered map. Validated command syntax, name constraints, globally distinct priorities, nonempty Calls, complete input consumption and the command bound.
- Factory: exhaustive Python prefix-sum enumeration versus C++ running-segment-sum enumeration; small saved inputs additionally checked by direct slice sums. Every saved cut pair was checked for valid positions and globally minimum range of group sums.
- Matrix Addition: Python arbitrary-precision integer arithmetic versus C++ 64-bit addition, including exact output row and column counts.
- Word: Python enumeration of all directed rays with a word-to-earliest-coordinate map versus C++ per-query eight-direction search. Checked all query lengths, board dimensions, characters and presence guarantees.
- Backup: Python heap contraction versus C++ cardinality-penalty dynamic programming; small inputs also checked with exact O(NK) DP. K=1 and even-N perfect matchings additionally checked by their direct formulas.

Additional deterministic randomized checks: 100 small Factory inputs, 100 Word boards/query sets, and 300 Backup instances. All reference models agreed.

## Actual sandbox grading

The existing production image and sandbox were used in separate temporary containers on VM CPU 6, with no network access. No database submissions were created.

| Problem | Correct-reference score | Maximum observed testcase CPU time | Maximum observed memory | Limit |
| --- | ---: | ---: | ---: | --- |
| Hospital | 100 | 286 ms | 34,560 KB | 1,000 ms / 64 MB |
| Factory | 100 | 6 ms | 3,456 KB | 1,000 ms / 64 MB |
| Matrix Addition | 100 | 9 ms | 3,584 KB | 1,000 ms / 64 MB |
| Word | 100 | 22 ms | 3,456 KB | 1,000 ms / 64 MB |
| Backup | 100 | 31 ms | 3,968 KB | 1,000 ms / 32 MB |

Factory's first-optimum and last-optimum solutions both scored 100. Its unchanged checker also passed 105 direct regression executions: saved answers, alternative optima on 12 cases, suboptimal splits on 24 cases, invalid indices and malformed outputs.

Deliberately incorrect models were rejected: minimum-priority Hospital scored 23; a constant Factory split scored 23; 32-bit Matrix sums scored 40; one-based Word coordinates scored 0; choosing the K smallest gaps without respecting shared offices scored 60. These tests demonstrate useful counterexamples, not exhaustive rejection of all wrong algorithms.

Existing accepted Matrix Addition submission 608 also scored 40 in the private offline run. Its matrix stores accumulated sums in `int`, so valid results beyond signed 32-bit range overflow. The historical database result was preserved. Use 64-bit storage/addition for a solution that supports the full input range.

## Safe deployment and post-checks

Original folders, PDFs and settings were backed up before generation. New claims were paused briefly and current jobs allowed to finish. Original live hashes/settings and the tested candidate hashes were checked before switching all five folders. Database case counts were updated transactionally to 30, with rollback handling for failures. Previous worker enable flags were restored afterward.

Database fingerprints verified that existing submission results, testcase verdicts, contest scores/history and the per-user worker cap did not change. All six worker container identities/start times and website service start times remained unchanged. No worker, API, web, nginx, ngrok or monitor restart was required. No automatic rejudging or TLE retry was added.

Post-deployment: tested live hashes matched for all five bundles; all original files and PDFs remained unchanged; all six workers were enabled with fresh heartbeats; local and ngrok pages for all five problems returned HTTP 200; there were no new Judge Errors in the preceding 15 minutes. Guest available memory was 2,617 MiB, with zero swap usage at that snapshot.

## Backups and reusable uploads on D

The workflow began on 15 October, so its snapshot/evidence names retain that date:

- `vm-setup/strengthen-47-51-original-20261015.tgz`
- `vm-setup/strengthen-47-51-evidence-20261015.tgz`
- `vm-setup/strengthen-47-51-evidence-20261015/problem-47-strengthened-20261015.zip`
- `vm-setup/strengthen-47-51-evidence-20261015/problem-48-strengthened-20261015.zip`
- `vm-setup/strengthen-47-51-evidence-20261015/problem-49-strengthened-20261015.zip`
- `vm-setup/strengthen-47-51-evidence-20261015/problem-50-strengthened-20261015.zip`
- `vm-setup/strengthen-47-51-evidence-20261015/problem-51-strengthened-20261015.zip`

Keep Factory's `check.cpp` in replacement ZIP uploads; it is included in the reusable bundle. Historical scores still describe the previous testcase version until explicitly rejudged. Runtime measurements are observations from these runs, not guarantees of identical timings for every implementation or load condition.
