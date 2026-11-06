# Recent problem audit — 15 October 2026

**Update: the three confirmed issues below have now been corrected.** Problems 46/47/50/51 have canonical testcase filenames; Hospital's invalid generated names and corresponding expected outputs were relabelled consistently; Factory now has a tested checker accepting any optimal partition. Original files are backed up, existing verdicts were preserved, and no grader or website restart was required. See [corrections and validation](PROBLEM-FIXES-20261015.md). The findings below describe the state observed before those fixes.

Read-only review of problems 34–51, including the six latest uploads 46–51. No problem files, settings, submissions or verdicts were modified. Diagnostic files and copied statements are on D; original VM data remains unchanged.

## Confirmed issues

### 1. Problems 46, 47, 50 and 51 cannot currently grade because of padded filenames

The uploads have `01.in`, `01.sol`, … `09.in`, `09.sol`, while the grader explicitly requires `1.in`, `1.sol`, … `9.in`, `9.sol`. The existing `10.in` and `10.sol` are fine. Each has all ten input/output pairs; they are named incompatibly. This is the same issue corrected earlier for problems 36 and 39–45. No new renaming was performed during this review.

Affected titles: 01-NPK_Cafe (46), 02-hospital01 (47), 05-Word (50), 06-Backup (51). Corrective action: preserve numeric pairing, back up the files, and remove only the leading zero in filenames.

### 2. Factory (48) can reject correct optimal answers

The statement asks for two start positions minimizing the maximum-minus-minimum of the three segment profits. It specifies no preference between equally optimal answers. All ten saved answers were checked by exhaustive enumeration and are optimal, but testcases 3, 9 and 10 have 3, 1,507 and 2 optimal answers respectively. The problem has no custom checker, so the default line-comparison checker requires exactly the saved positions.

Proof using the currently installed checker (temporary output files only; no submissions or verdict writes):

| Case | Saved answer | Alternative optimal answer | Same optimal difference | Current checker |
| ---: | --- | --- | ---: | --- |
| 3 | 2 3 | 3 4 | 15 | REJECTED |
| 9 | 209 434 | 354 681 | 1000 | REJECTED |
| 10 | 557 781 | 564 665 | 17 | REJECTED |

Corrective action: add a checker that validates the two cut positions and accepts any partition with the optimal difference. Adding an unstated tie rule or replacing only a saved answer would not generally resolve the issue. The PDF also permits n=1 or 2, although three nonempty segments require n>=3; all current testcases have n>=3.

Statement: [Factory](../../../grader/vm-setup/new-problems-audit-20261015/statements/48.pdf).

### 3. Hospital (47) testcases violate the stated patient-name format

The statement allows lowercase English alphabetic names of at most seven characters. Cases 6–10 include names such as `p0`, `pt0`, `n0`, `pat0` and `x0`, containing digits. The expected call order matches an independent priority-queue simulation, priorities are valid/unique, and Calls occur with patients waiting; the problem is the generated name format. Corrective action: consistently relabel generated names in both input and expected output using valid alphabetic names, keeping all priorities and commands unchanged.

Statement: [Hospital](../../../grader/vm-setup/new-problems-audit-20261015/statements/47.pdf).

## Additional discrepancies and coverage notes

- Cafe (46): the PDF states 0.2 seconds, while the configured limit is 1 second. This is a discrepancy, not a Judge Error; the configured value may be intentional. The PDF size table starts at n=10, but its own examples and cases 1–2 use n=3 and n=5. It also writes a strict start<end condition while an example and a generated case allow equal start/end. All ten saved answers agree with the inclusive-hour interpretation demonstrated in the PDF. Statement: [Cafe](../../../grader/vm-setup/new-problems-audit-20261015/statements/46.pdf).
- Matrix Addition (49): all ten inputs and answers agree with independent elementwise addition and satisfy their bounds. The allowed integer bounds permit sums outside signed 32-bit range, but none of the current expected sums exercise that edge. This is a coverage limitation, not an incorrect answer. Statement: [Matrix Addition](../../../grader/vm-setup/new-problems-audit-20261015/statements/49.pdf).
- Food (40): empty `1.sol` and `10.sol` are valid. Every possible first dish is forbidden in those cases (m=n), so no ordering exists. All ten outputs exactly match exhaustive lexicographic permutation enumeration. Statement: [Food](../../../grader/vm-setup/new-problems-audit-20261015/statements/40.pdf).

## Checks completed

- 18 statement PDFs parsed successfully: 43 pages total, no encryption, expected numeric document titles. Relevant Food/Cafe/Hospital/Factory pages were also rendered for visual review.
- All 54 anonymous HTTP checks succeeded: public problem API, rendered problem page, and statement PDF for each of 18 problems. PDF download/inline filenames match problem IDs, and served PDF hashes match the stored files.
- Positive time/memory/score settings, ten input/output pairs per problem, naming/placement checks, UTF-8/BOM/NUL checks, empty files, and identical-input/conflicting-answer checks. No missing physical pairs, conflicting duplicate inputs, invalid UTF-8 or NUL bytes were found. Four naming failures remain as listed above.
- No custom checker or subtask files were uploaded for these 18 problems; the case configuration is the ordinary ten-testcase format.
- Independently validated all 60 expected outputs for newest problems 46–51. For Hospital, simulated command processing while separately reporting invalid labels. For Factory, exhaustive all-cut enumeration; for Cafe, inclusive interval event sweep; for Matrix Addition, elementwise sum; for Word, eight-direction case-insensitive topmost/leftmost search; for Backup, optimal path matching, first cross-checked against an independent dynamic program on 300 deterministic small cases.
- Backup (51) includes a 100,000-office / 40,000-pair case, whose saved answer matched the independent solver. Statement: [Backup](../../../grader/vm-setup/new-problems-audit-20261015/statements/51.pdf).
- Word (50) expected coordinates all matched the independently computed topmost/leftmost occurrences. Statement: [Word](../../../grader/vm-setup/new-problems-audit-20261015/statements/50.pdf).

## Limits

This does not prove correctness of every older problem, suitability of every time limit on all hardware, or exhaustive test coverage. Problems 34–45 received structural/availability checks, with additional semantic validation for Food; the full statement-derived expected-output checks focused on newest problems 46–51. No reference submissions were created or rejudged, and no live graders were paused or restarted for the audit. The four filename failures and Factory checker issue should be corrected before relying on results for those problems.

Raw evidence: `D:\otog-grader\vm-setup\new-problems-audit-evidence-20261015.tar`. Local detailed records and statement copies: `D:\otog-grader\vm-setup\new-problems-audit-20261015`.
