# Grader and application audit remediation

The 21 October security remediation is deployed and verified. Full findings, changes, verification and rollback instructions are in [the application remediation report](../security/SECURITY-REMEDIATION-20261021.md).

The new grader release is `/opt/otog/security-remediation-20261021`. Its changed read-only mounts are `mainWorkers.py`, `sandbox_security.py`, `postgresql/dbInit.py`, `errorLogging.py` and the inactive legacy `httpSync/httpQuery.py`. Other mounts, including the patched native Isolate and 17 October checker hardening, remain unchanged.

Current source/deployment evidence: `vm-setup/audit-remediation-evidence-20261021/source-hashes.json`, `grader-tests.json`, `grader-deployment.json`, `app-deployment.json`, and `postflight.json`. Earlier 17 October manifests remain historical evidence rather than the current full source manifest.

The private tree/baseline/output cleanup runs after persistence and before admission, under a deadline. Cleanup failure retires the worker without rewriting a committed result. Startup/claims now have progress supervision and bounded main database waits. All six graders are enabled and connected; five offline accepted references retained full scores. No production test submissions or accounts were created.

The release workspace contains the active frontend and must not be removed as disposable staging. No database restore is required for code rollback.
