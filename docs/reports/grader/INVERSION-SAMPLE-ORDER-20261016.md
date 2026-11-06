# NPK Inversion: user-selected sample rule

The user explicitly requested: "So make the 632 correct" after comparing the two interpretations of the inconsistent statement. The active definition is now:

```text
Count pairs satisfying i < j, Xi < Xj, and Yi > Yj.
```

Input order matters. This matches the original sample output 5 and submission 632. It supersedes the intervening any-pair interpretation documented in `INVERSION-SEMANTICS-CORRECTION-20261016.md`.

All 50 expected answers were independently regenerated using this definition. The 50 input files remained unchanged; 29 answer files changed back from the any-pair version. The time limit remains 100 ms and memory limit remains 128 MB. No source-code edits to student submissions are involved.

Verification uses a direct C++ pair enumeration, an independent compressed two-dimensional Fenwick implementation, and a separate Python oracle. Checks include 336 exhaustive boundary arrays, 300 additional random arrays and 632 permutation/order checks. Each permutation is evaluated using its own order, rather than requiring order invariance.

Actual grader tests require both correct references and submission 632 to score 100. Submission 634 counts pairs in both input directions and must be rejected under the selected rule. Non-strict comparisons, omitted conditions and other incorrect variants are also tested.

Deployment backs up current data and metadata, pauses new claims, drains active jobs and swaps only problem 56's data folder. Original input hashes, other problem hashes, metadata/limits, worker IDs/start times, website service start times, pause flags and grading policies are checked. NPK Tull's global one-worker cap remains unchanged.

Submissions 632 and 634 were backed up and rejudged through the normal admin endpoint after installing the verified answers. Verified live results are **632 accepted/100** and **634 rejected/42**, recorded in `rejudge-after.json`. The downloaded ZIP was checked against the deployed manifest, including sample answer 5. All six graders and the Tull cap passed the final health checks.

The PDF is unchanged: its sample matches the selected rule, while its prose still does not explicitly state `i < j`. The rule above records the user's decision and should be stated explicitly if the PDF is later revised.

Artifacts on D:

- Original backup: `vm-setup/inversion-sample-order-original-20261016.tgz`.
- Current evidence: `vm-setup/inversion-sample-order-evidence-20261016.tgz`.
- Current uploadable testcases: `vm-setup/inversion-sample-order-evidence-20261016/problem-56-sample-order-20261016.zip`.
- Verified live verdicts: `rejudge-after.json` in the extracted evidence folder.
- Preparation/reference/test/deployment helpers: `vm-setup/*inversion-sample-order*20261016*`.

Prior timestamped artifacts are retained for audit/rollback. Use this release's manifest and bundle as the active version.
