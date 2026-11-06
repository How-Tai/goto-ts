# Recent problem corrections — 15 October 2026

Deployed corrections for problems 46, 47, 48, 50 and 51. Original problem folders are backed up, and existing submissions/verdicts/contest scores were preserved. Grader and website processes were not restarted. The previously reverted automatic TLE recheck remains absent.

## Changes

- Problems 46, 47, 50, 51: renamed 72 padded testcase files (`01.in/.sol` to `1.in/.sol`, etc.). Numeric input/output pairing was preserved; all file contents for problems 46, 50 and 51 stayed byte-for-byte unchanged.
- Hospital (47), cases 6–10: consistently replaced generated patient names in both input and expected output with lowercase alphabetic identifiers. New names have at most four characters, within the statement's seven-character limit. Every command, priority token and expected call identity/order was preserved. Cases 1–5 were unchanged apart from canonical filenames. Counts of distinct renamed identities by case: 595, 5,409, 29,939, 97,423, 209,134.
- Factory (48): added a problem-specific `check.cpp` using the existing OTOG custom-checker protocol. It validates two cut positions, verifies three nonempty contiguous segments, independently computes the optimal max-minus-min profit difference, and accepts any optimal partition. It rejects malformed, extra-token, overflow, invalid-cut and suboptimal outputs. It leaves the testcase inputs, stored answers, score and time/memory limits unchanged. No global grader code was changed.

## Factory verification

Testcase 3 has profits `-5 10 -5 10`. All three cut pairs `2 3`, `2 4`, and `3 4` produce a maximum-minus-minimum difference of 15, which is optimal. Before correction the live standard checker accepted only the stored `2 3` answer and rejected the other two. The statement specifies no tie preference.

The new checker passed 275 direct executions, including the saved answers, alternative optimal answers, deliberately bad outputs, and 80 deterministic random small inputs compared with independent exhaustive partition enumeration.

Actual sandbox integration used the same C++ solution that chooses the last optimal partition on ties. Under the old standard checker it scored 70/100; under the new custom checker it scored 100/100. An invalid solver printing `1 1` scored zero. These were temporary isolated test runs with result callbacks captured in memory, not production submissions or verdict writes.

## Deployment checks

Candidate folders were prepared separately. Original and candidate hashes were checked against the tested manifest before deployment. New claims were briefly paused and active jobs allowed to finish, then the five problem folders were switched with a rollback path. All six graders could see all 50 canonical testcase pairs and the Factory checker afterward. Current enabled flags were restored.

Existing result, verdict, contest-score and contest-history fingerprints matched before/after. Worker container identities/start times and website service process start times matched before/after. All deployed files matched the tested candidate hashes.

Backup and evidence: `D:\otog-grader\vm-setup\problem-fixes-evidence-20261015.tgz`, containing `original-problems.tgz`, file manifests and test/deployment checks. The guest release path is recorded in `/home/otog/worker-setup/problem-fixes-current-20261015.txt`; exact pre-deployment folders remain under that release's `live-before` directory.

Existing Judge Error or unfair WA results were not automatically rejudged. They need a normal manual rejudge to use the corrected files/checker. Keep Factory's `check.cpp` in its testcase bundle when replacing that bundle in future; replacing the entire bundle without it would restore exact-output judging for that problem.

The audit's informational Cafe PDF/time-limit discrepancies, Factory PDF n>=1 wording, and Matrix Addition coverage note were not changed. No statement PDFs were edited.
