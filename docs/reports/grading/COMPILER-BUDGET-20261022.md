# Compiler reservation improvement — 22 October 2026

Deployed ordinary first-attempt compilation limit **384 MiB**, with a **640 MiB
minimum reservation** including the unchanged 256 MiB padding (previously
512 MiB and 768 MiB). Original-limit fallback and larger/custom job allowances
are preserved.

All 16 supported compiler examples passed at both limits, all five accepted
references stayed AC/100, queue/sandbox/recovery regressions passed, and all
24 isolated benchmark jobs passed. The same tested memory budget admitted three
compilers instead of two. Two-CPU benchmark batch times remained approximately
8.9 seconds: memory admission improved, without a demonstrated speed increase
on those two CPUs.

All six graders and localhost/ngrok health checks passed after deployment.
No production test submissions, database schema changes or website-service
restarts were needed.

Full measurements, limitations and rollback:
[Compiler budget report](../grader/COMPILER-BUDGET-20261022.md).
