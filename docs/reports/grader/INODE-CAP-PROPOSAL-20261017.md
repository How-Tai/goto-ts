# Proposed filesystem-entry cap — isolated test only

> Follow-up: the user chose [4,096 inodes](INODE-CAP-4096-20261017.md), which was separately validated and deployed. The 16,384 configuration below remains an historical isolated experiment.

No production mount, limit or grader code was changed for this experiment. The current depth-cleanup correction remains deployed; the explicit inode cap described here is **not deployed**.

The remaining resource risk is the number of filesystem objects a submission can create. A larger testcase CPU limit permits more creation work, so robust traversal alone does not bound cleanup cost. A tmpfs data-size cap also needs an inode-count bound to constrain empty-directory trees.

A disposable sandbox on reserved ID 20 used the deployed grader source/native binary and `size=256m,nr_inodes=16384`. The inode cap covers the complete private tmpfs, including its compiled baseline and sandbox; it is not a RAM limit and does not change normal CPU time limits. Large read-only problem testcases are mounted outside this private filesystem.

The synthetic C++ program repeatedly created and entered directory `d`. Once mkdir failed, it printed the error and spun until TLE, ensuring both configured CPU limits were exercised rather than exiting immediately at the quota.

| Configured testcase limit | Reached depth | Verdict | Whole diagnostic job time |
|---|---:|---|---:|
| 1 second | 16,369 | TLE | 2.251 s |
| 5 seconds | 16,369 | TLE | 6.718 s |
| Healthy next submission | 0 | AC | 0.982 s |

Both quota cases recorded `mkdir: No space left on device`. Native CPU times were 1.098 and 5.024 seconds. The same grader process handled all three jobs without a restart. Whole-job time includes compilation, sandbox initialization, native ownership/reset work, execution, checking and diagnostic depth counting; it is not cleanup-only time. The earlier uncapped experiment was a different job layout and is not a controlled speedup comparison.

This caps total filesystem objects independently of a problem's time limit. It would change behavior for a legitimate solution needing more than the allowed objects; that compatibility tradeoff needs to be considered before deployment and broader reference tests would be required. Programs that exit after a failed mkdir normally receive runtime error; this test deliberately kept spinning to its existing time limit.

Evidence: `vm-setup/inode-cap-evidence-20261017/`. An initial diagnostic assertion read the grader's rewritten TLE message instead of original sandbox stderr; it was corrected, and the completed test retained the original `No space left on device` error. No production submission was fabricated or rejudged. The disposable container was removed; live container identities were unchanged. All six live workers had fresh heartbeats and localhost/ngrok returned HTTP 200 afterward.
