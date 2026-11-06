# Selective compilation pipeline

The [dedicated compiler service](DEDICATED-COMPILER-20261022.md) now supersedes
the shared-worker arrangement below. It uses two separate compilation slots
feeding the six graders; this report records the earlier implementation.

Deployed on the existing six workers. Applicable standard C/C++ jobs can compile
using compiler-sized reservations, leave a private executable on disk, and wait
for a separate execution reservation. Up to three such compilations can run;
all work still shares the existing RAM budget and six total worker slots.
Small-memory jobs and custom/Python paths retain their direct execution flow.

All safety/reference checks and 48 benchmark jobs passed. The controlled
compilation-heavy 1024 MiB-limit batches improved from 15.8 to 10.0 seconds
(36.6%); small-memory batches were 8.7 versus 8.9 seconds, with no demonstrated
speed gain. These are workload-specific results, not a universal runtime claim.
Existing Tull/user limits remain enforced. All six graders and localhost/ngrok
health checks passed after deployment; website services were not restarted.

[Full report, evidence and rollback](../grader/COMPILATION-PIPELINE-20261022.md).
