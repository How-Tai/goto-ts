# NPK Inversion: statement interpretation and answer correction

**Superseded by explicit user decision:** The user subsequently requested that 632 be correct. The active rule is `i < j && Xi < Xj && Yi > Yj`, matching sample output 5. The any-pair rule and answer ZIP described below are historical. Use [INVERSION-SAMPLE-ORDER-20261016.md](INVERSION-SAMPLE-ORDER-20261016.md) and its verified current bundle.

## Finding

The earlier testcase generation was wrong to infer `i < j` from the sample. The written definition describes any pair of students, oriented by age: the younger student must be taller. It does not restrict their order in the input. The user additionally confirmed that their teacher's judge accepts submission 634 and rejects 632, supporting the written definition.

The sample itself is inconsistent. Its five listed pairs omit `(3,1)` and `(3,2)`: student 3 is age 11 and height 185, younger and taller than students 1 and 2. The correct sample result under the definition is **7**, rather than the printed 5.

For an unordered pair considered once using loop indices `i < j`, the correct condition is:

```cpp
(x[i] < x[j] && y[i] > y[j]) ||
(x[i] > x[j] && y[i] < y[j])
```

This is submission 634's condition. Submission 632 includes only the first orientation, so it misses qualifying pairs whose younger student appears later. It is not a testcase-strength or performance problem: the earlier reference specification was incorrect.

A minimal distinguishing input is:

```text
2
2 1
1 2
```

The correct answer is 1. Submission 632 outputs 0; 634 outputs 1. Reordering students must not change the correct result. Equal ages and equal heights still do not count.

## Correction deployed

- Recomputed all 50 expected answers using the corrected definition.
- **29 `.sol` files changed**; all 50 `.in` files remained byte-identical.
- Cross-checked every answer with a Python age-grouped Fenwick oracle, an independent direct C++ pair enumeration, and a second C++ sorted/Fenwick implementation.
- Checked 336 exhaustive boundary-coordinate arrays, 300 additional randomized arrays and 632 permutation checks. These check counts are unrelated to submission IDs.
- Ran 12 isolated actual-grader tests: both correct references passed; 634 scored 100, 632 scored 42 and 633 scored 40. Seven faulty comparison/order variants were rejected.
- Retained the 100 ms time limit, 128 MB memory limit, 50-case count and existing visibility. The correct 634 solution passed within the limit; no timing adjustment was needed.

New preparation/reference/test scripts are `vm-setup/*inversion-correction*20261016*` and `reference-inversion-corrected-20261016.cpp`. Older timestamped generation/reference/mutation scripts embody the old interpretation and should not be reused for problem 56. Their earlier evidence remains available for auditing/rollback, but its problem-56 ZIPs are superseded by the corrected bundle below.

## Live verification and rejudging

After backing up the original answers and settings, deployment paused new claims, drained in-flight jobs and swapped only problem 56's source directory. Worker container IDs/start times, website service start times, problem metadata, other problems' source hashes, grading policies and historical result fingerprints were unchanged during the answer-file deployment. No grader or website restart was needed.

Submissions **632 and 634** were then backed up and deliberately rejudged through the site's normal admin rejudge API. The stored live results now are:

| Submission | Status | Score |
|---|---|---:|
| 632 | rejected | 42/100 |
| 634 | accepted | 100/100 |

The original result trees are retained privately in the guest release's `rejudge-before.json`. Other historical submissions were not rejudged by this correction. The 633 score of 40 above is an offline test, not a claim that its stored historical score changed.

All six graders remain running with their original enabled flags. NPK Tull retains its global one-worker limit. Website, monitoring and all other problem suites remain intact.

## Evidence and statement status

- Original backup: `vm-setup/inversion-correction-original-20261016.tgz`.
- Corrected evidence: `vm-setup/inversion-correction-evidence-20261016.tgz`.
- Extracted evidence and uploadable current testcase ZIP: `vm-setup/inversion-correction-evidence-20261016/problem-56-corrected-20261016.zip`.
- Detailed changed-answer list and file hashes: `manifest.json` inside the evidence.
- Actual judge checks: `tests-passed.json`; live targeted rejudge results: `rejudge-after.json`.

The original PDF has not been edited. Its sample output/explanation still needs an erratum to avoid teaching the erroneous input-order interpretation. A reviewed original copy is at `vm-setup/adversarial-52-56-original-20261016/original/docs/56.pdf`.
