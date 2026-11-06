# Unsolved-problem audit — 15 October 2026

Scope: every problem with zero accepted submissions from non-admin users, matching the site’s solved-count logic. Snapshot contained ten problems: seven public and three hidden. All ten had zero non-admin submissions, so the zero solved count currently reflects no non-admin attempts, not evidence of failed solutions. Dynamic Min has two admin AC submissions and is included because admins do not count toward the public solved counter.

## Public problems

| ID | Problem | Expected answers | Other checks |
| ---: | --- | --- | --- |
| 44 | IsekaiNoHajime | All 10 matched | Topmost-plane DSU model; small cases also brute-force checked |
| 46 | 01-NPK_Cafe | All 10 matched | Inclusive-hour event sweep |
| 47 | 02-hospital01 | All 10 matched | Independent highest-priority patient simulation |
| 48 | 03-Factory | All 10 matched | Exhaustive enumeration of all partitions |
| 49 | 04-matrixAddition | All 10 matched | Independent elementwise addition |
| 50 | 05-Word | All 10 matched | Eight-direction case-insensitive word search |
| 51 | 06-Backup | All 10 matched | Optimal path matching; cross-checked against small-case DP |

No incorrect expected answers or missing/incorrectly named testcase pairs were found in the seven current public bundles. All 70 cases were independently checked. Every public problem page and statement returned HTTP 200. The Factory checker matches the exact tested implementation already deployed; Hospital’s corrected names now meet its stated alphabetic-name rule. All configured testcase descriptions parsed successfully with the actual grader’s subtask parser. No contradictory required/banned keyword rules were found.

### Isekai output-format caveat

Isekai (44) has one line of Q numbers in every saved answer. The current default checker compares lines, rather than arbitrary whitespace-separated tokens. On testcase 1, a temporary output containing the identical ordered numbers, one per line, was REJECTED by that checker. The statement says to output Q values and its examples display them on one line; it does not explicitly state that alternative line wrapping is permitted or forbidden. Therefore this is a formatting-compatibility risk, not proof of incorrect expected numbers. Decide whether to require one-line output clearly or to use token-based numeric comparison for this problem. No checker change was made during this audit.

Statement: [Isekai](../../../grader/vm-setup/unsolved-audit-20261015/docs/44.pdf).

### Isekai scoring differs from its statement

The statement describes three weighted subtask groups worth 10, 20 and 70 points, with a group's points awarded only when all tests in that group pass. The live configuration is the simple string `10`, which the actual grader parser expands to one ungrouped 100-point subtask containing ten cases: effectively ten points per passing case. Thus partial scores currently do not implement the statement's 10/20/70 all-or-nothing group scheme. This may be intentional for the training site, but the configuration and published statement should agree. No scoring changes were made.

Isekai reference validation: 400 deterministic random small cases compared the DSU implementation with a direct clipped-terrain simulation; small actual cases were also compared by both models. All ten saved answer files matched, including the N=M=P=Q=200,000 cases. Case 9 reaches cumulative damage 13,333,600,000,000,000,000, beyond signed 64-bit range, even though query health is at most two billion; solutions should avoid overflow (for example by capping cumulative damage once it exceeds all query values). This is valid stress data, not an invalid expected answer.

## Hidden drafts

| ID | Problem | Finding |
| ---: | --- | --- |
| 2 | Dynamic Min | All 18 answer files match an independent multiset-operation simulation derived from existing admin-accepted code. No statement PDF exists, so the intended constraints cannot be independently established. |
| 3 | Ticket Booth | Cannot grade as configured: all 17 required root input/output pairs are absent. Actual data is an `atm/` directory with 25 pairs and library-grader files (`atm.h`, `grader.cpp`, `partial.cpp`, `command.yaml`). Configured case count is 17. No statement PDF exists. Verify the intended archive and required compile integration before publishing; simply flattening this bundle may be wrong. |
| 5 | test | Both expected-answer files are empty and no statement exists. Inputs have a valid range-sum benchmark shape (10,000 and 200,000 queries); under that interpretation, nonempty outputs would be required. Treat it as an unfinished benchmark draft, not a public-ready judged problem. |

Ticket Booth’s empty `.sol` files alone are not proof of a defect because the included library/custom-grader format may intentionally use empty jury outputs; its missing root files and mismatch in expected bundle layout are concrete blockers.

## Safety and limits

- Read-only audit: no original testcase, statement, setting, submission or verdict was changed. SHA256 hashes of every audited source file matched the starting snapshot at completion.
- No graders or website services were paused or restarted. Expensive reference work was run at low priority on VM CPU 6, outside the six grader CPU assignments.
- Current structural checks cover all ten problems: required files, file encoding, NUL/BOM/empty files, duplicate-input consistency, positive settings, testcase/subtask parsing and rule contradictions.
- This validates supplied data against the reference models; it does not prove exhaustive coverage or guarantee every implementation meets its time limit. Missing statements prevent complete semantic verification of the hidden drafts.
- Previously reported Cafe statement/time-limit discrepancies and Matrix Addition overflow-coverage limitation remain informational; they were not changed. Cafe also uses the simple ten-equal-case grading setup rather than explicitly configured constraint-based subtask groups.

Evidence: `D:\otog-grader\vm-setup\unsolved-audit-evidence-20261015.tar`. Detailed local records and source copies: `D:\otog-grader\vm-setup\unsolved-audit-20261015`.
