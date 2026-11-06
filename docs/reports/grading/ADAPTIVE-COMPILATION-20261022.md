# Adaptive grader compilation

Deployed on 22 October 2026. Ordinary smaller compilations use an enforced
512 MiB first-attempt limit and a 768 MiB minimum reservation, allowing two
compilers within the measured 2027.414 MiB shared pool. A failed smaller attempt
is cleaned up and retried once using the original compiler limit before a
compilation verdict is saved. Custom/large problems keep their original profile.

Four isolated six-job batches measured median elapsed time improving from
15.651 s to 8.807 s (43.7% less) for that compilation-heavy workload. All 24 jobs
were accepted. This does not change contestant execution limits or guarantee
the same speedup for every workload; failed initial compilations may take longer
because of their additional attempt.

All six graders, localhost and ngrok passed postflight. Existing results and
grading policies were preserved. The operational-only migration and models are
in this repository; the website/API required no rebuild or restart.

[Implementation, verification, benchmark and rollback](../grader/ADAPTIVE-COMPILATION-20261022.md).
