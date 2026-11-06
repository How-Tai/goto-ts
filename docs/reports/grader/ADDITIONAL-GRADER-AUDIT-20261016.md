# Additional grader audit — 16 October 2026

No additional current grading fault was found in the checks below. This is a bounded audit, not proof that every possible defect is absent. No production code, settings, results, worker flags or testcase files were changed during this audit.

## Live observations

The checked window starts at the corrected v2 deployment, `2026-10-16T14:09:02.948625+00:00`.

- No new submissions with Judge Error since that deployment.
- All six workers enabled, with fresh heartbeats, exclusive worker locks, corrected v2 code mounts, no container restarts and no OOM kills.
- No grading submissions without leases, invalid active leases, or completed submissions missing results in the database snapshot.
- No grader exception summaries in the bounded container logs inspected since the correction.
- No warning-severity journal entries for the API, web, nginx, ngrok or monitoring services in the checked window; no matching kernel lockup, OOM or I/O-error warnings.
- All public problems had their declared input files and, where required by the checker, answer files. All declared case formats were numeric.
- Approximately 2.50 GiB RAM available, no swap in use and approximately 32.9 GiB guest filesystem space available at the snapshot. These values change with load.

Historical records remain: 19 old Judge Error submissions, all IDs 36 or below. They were not rejudged or deleted. One private draft, problem 3, has missing input/answer files; it is not a public problem and was left unchanged.

## Additional full-pipeline tests

Twenty-four scenarios passed in a disposable, network-disabled container, with no production database credentials, using the actual worker startup script and worker ID 6:

- Correct C, C++ and Python submissions.
- Wrong answer, segmentation fault and time-limit verdicts.
- C++/Python compilation errors followed immediately by valid submissions.
- Compiler warnings, stderr, empty output and UTF-8 output.
- Python problem libraries, C++ libraries and a custom compiler command.
- Custom C++ checker with source-path access, partial-score checker and Python output checker.
- Grouped-subtask acceptance and failure/skip behavior.
- Codeforces-mode acceptance and wrong-answer behavior.
- File cleanup inside the complete judge pipeline and successful execution of the next submission.

Existing subtask configurations parsed and referenced existing input files for problems 4, 44, 46, 53 and 55.

The test fixture initially used an unnumbered subtask label. The existing format requires a numbered label; the fixture was corrected before the final passing run. No production subtask configuration was changed.

Prior correction validation additionally covered 17 isolation checks for each of the six production worker IDs, plus 15 full reference solutions. Those results are recorded separately in `TESTCASE-FILESYSTEM-ISOLATION-20261016.md`.

Evidence on D: `vm-setup/case-reset-evidence-20261016/expanded-live-audit.json` and `expanded-pipeline-audit.json`.
