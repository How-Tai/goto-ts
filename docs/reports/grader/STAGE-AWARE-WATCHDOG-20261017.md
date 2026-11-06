# Stage-aware grader watchdog — 17 October 2026

> Current deployment: [directory-depth cleanup correction](DIRECTORY-DEPTH-FIX-20261017.md). Stage deadlines, runtime diagnostics and restart fallback remain unchanged.

> Follow-up: [reference 631's runtime-error investigation](REFERENCE-631-RUNTIME-INVESTIGATION-20261017.md) documents the 600-execution probe, tested UID-collision hypothesis, limits of the original evidence and the later private bounded capture deployment. Its report identifies the current diagnostic release. Watchdog stage behavior remains unchanged.

Deployed to all six workers after isolated validation and a graceful drain. No live submissions were rejudged or fabricated. No database schema, scoring rules, contestant limits, VM/Windows settings or container resource limits were changed. Website/control services stayed running.

## Stage deadlines

These are recovery deadlines for the grader, not extra contestant runtime. The existing Isolate CPU/wall limits and infrastructure subprocess timeouts act first.

| Stage | Watchdog allowance |
| --- | --- |
| Retry lookup, submission rules, progress update, final queue cleanup | 30 seconds |
| Sandbox cleanup and initialization | 35 seconds each; underlying operation limit remains 20 seconds |
| Trusted problem-file preparation | 120 seconds |
| Submission compilation inside Isolate | 50 seconds; wrapper limit remains 40 seconds |
| Compiler preparation, baseline snapshot, testcase reset, output collection | 60 seconds per stage |
| Testcase execution | max(15, wrapper timeout + 10) seconds |
| Standard answer comparison | 60 seconds |
| Custom/interactive checker execution | 75 seconds; operation limit remains 60 seconds |
| Custom checker compilation | 135 seconds; operation limit remains 120 seconds |
| Saving results and recalculating contest scores | 90 seconds |
| Unclassified work between stages / testcase metadata | 60 seconds |

For actual language-adjusted time limit T seconds, the execution wrapper uses 2*T+3 seconds, so the watchdog uses max(15,2*T+13). A 1-second C++ case gets a 15-second recovery guard; the normal wall limit is still 3 seconds. With the current Python multiplier of five, a nominal 1-second problem gets a 23-second recovery guard and an 11-second normal wall limit. Larger limits scale upward automatically.

There is no short fixed total-submission deadline. A legitimate long batch continues while stages complete; this change does not skip testcases or turn a 49-case TLE submission into one early-aborted case.

## Implementation

The job attaches a watchdog to the grading thread. Stage context managers and decorators update its current operation and deadline. Nested stages temporarily take their own allowances; completion restores the caller's stage with a fresh allowance because the inner operation completed. Exceptions also restore the correct caller context.

One daemon monitor thread per active job waits on a condition variable and a monotonic deadline. Stage changes update that deadline without creating new timer threads or busy polling. A generation check prevents a stale expiration from terminating work after a stage transition. Job completion cancels and detaches the guard; late context exits cannot reactivate a cancelled guard.

On expiration, diagnostics name the submission, stage (including testcase number during execution), elapsed time and budget. The worker exits with code 71; Docker performs the existing restart. The durable two-attempt interrupted-job policy is preserved. Detected sandbox exceptions still persist their Judge Error before the existing code-70 restart.

The monitor remains a thread in the grading process. It does not guarantee recovery when Python cannot schedule that thread, a native call holds the GIL indefinitely, the kernel cannot terminate a process, Docker is unavailable, or the VM/Windows freezes. No host watchdog or independent monitoring process was installed. Stage deadlines intentionally retain margin for legitimate slow operations and can still require future adjustment for unusually large workloads.

## Validation

- 19 focused checks: prior timeout/recovery safeguards plus nested restoration, restoration after errors, automatic wrapper-derived allowances (including a long-limit case), one-monitor reuse across 200 rapid transitions, cancellation/detachment, an actual short-stage watchdog exit with diagnostics, and an operation safely exceeding a shorter fallback deadline.
- 14 complete normal grading/custom-checker cases passed.
- Four actual worker/judge/evaluator/Isolate recovery scenarios passed: C++ and Python, classic and Codeforces modes. Each affected container restarted once and accepted a healthy follow-up for 100 points.
- Actual queue SQL and stage hooks passed against disposable PostgreSQL, preserving retry/quarantine behavior.
- Five accepted reference solutions passed in the first stage-deadline suite. After changing to the single monitor, one subsequent run returned runtime errors on problem 48. The same fixed reference then passed in isolated candidate/current comparisons, and all five passed in the repeated reference group. The original failed run did not retain sandbox metadata, so its cause remains unconfirmed. This is recorded in tests.json and the original failure log; it was not silently discarded or represented as an explained failure. Subsequent reference failures now capture sandbox metadata and contestant stderr.
- Production deployment checked the exact 12 source hashes in every worker and preserved result, score, policy and retry-counter fingerprints. Image, CPU affinity, memory/swap, process/tmpfs limits and Docker restart policies were unchanged. Pause flags were restored conditionally, respecting concurrent administrator actions.

## Files, evidence and rollback

- Active source overrides: `/opt/otog/grader-stage-watchdog-20261017/source/`
- Compose: `/home/otog/otog/docker-compose.vm.yml`
- Previous configuration: `/opt/otog/grader-stage-watchdog-20261017/compose.before.yml`
- Drive D evidence: `vm-setup/stage-watchdog-evidence-20261017/`
- Local implementation: `src/grader_safety.py`, `src/mainWorkers.py`, `src/worker_queue.py`, `src/sandbox_security.py`, `src/evaluate/verdict/main.py`, `src/evaluate/verdict/standard.py`.

Rollback requires pausing new claims, waiting for active jobs, restoring the previous compose, recreating only the six graders, checking registrations and conditionally restoring prior pause flags. Do not restore the database or drop the retry table. Rollback returns to the earlier broad-deadline watchdog and retains the prior sandbox exception/retry hardening.
