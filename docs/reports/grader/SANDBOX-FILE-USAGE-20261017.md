# Sandbox filesystem usage — 17 October 2026

Measured in a disposable container using the active grader and native binary. No production cap was applied during these measurements.

| Scenario | Regular files after testcase | Directories after testcase | Sampled peak total inodes |
|---|---:|---:|---:|
| ordinary C++ | 6 | 9 | 15 |
| ordinary C | 6 | 9 | 15 |
| ordinary Python | 6 | 11 | 17 |
| Python with imported problem library | 9 | 11 | 20 |
| C++ creating a scratch file | 7 | 9 | 16 |
| accepted reference, problem 48 | 6 | 9 | 15 |
| accepted reference, problem 52 | 6 | 9 | 15 |
| accepted reference, problem 53 | 6 | 9 | 15 |
| accepted reference, problem 54 | 6 | 9 | 15 |
| accepted reference, problem 56 | 6 | 9 | 15 |

Counts include the sandbox, compiled baseline, private temporary directories and Isolate control/root entries. They exclude read-only testcases, standard libraries, source/checker workspaces and logs outside the private tmpfs. Inode use was sampled every 2 ms during compilation and execution; very short-lived peaks may be missed. File/directory breakdowns are snapshots after each completed testcase, rather than exact type breakdowns at the peak. Each ordinary example ran two cases; accepted references covered all 198 cases across problems 48,52,53,54,56. These observations do not establish a universal bound for every possible source or problem library.

A first directory enumeration omitted an empty Isolate control directory while total-inode sampling was correct; the enumeration was corrected and the complete measurement was repeated. The retained evidence reflects the corrected enumeration.

Raw evidence: vm-setup/sandbox-file-usage-evidence-20261017/report.json
