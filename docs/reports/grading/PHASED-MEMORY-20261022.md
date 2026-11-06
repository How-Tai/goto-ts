# Phase-aware grading memory

The [adaptive compilation update](ADAPTIVE-COMPILATION-20261022.md) now
also improves compilation admission at the measured live memory budget.

Deployed on 22 October 2026. Workers reserve their larger compilation allowance
at claim time, then release its excess after both solution and checker
compilation finish. A standard-checker 64 MiB problem now retains 320 MiB
during evaluation instead of a whole-job 1 GiB minimum. Custom checkers retain
at least 768 MiB; 1024 MiB problems retain 1280 MiB.

The controlled 2 GiB queue test increased from two to four active small jobs.
This is an admission-concurrency result, not a measured doubling of throughput.
All six graders are enabled. Existing results, limits and website services were
preserved, and both localhost and ngrok passed verification.

[Implementation, tests, limits and rollback](../grader/PHASED-MEMORY-20261022.md).
