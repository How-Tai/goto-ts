# Recovery coverage review — 17 October 2026

Update: the implementation and isolated end-to-end tests described in [the hardening report](GRADER-RECOVERY-HARDENING-20261017.md) were subsequently completed and deployed to all six workers. The findings below describe the prior configuration. The silent-hang watchdog has the explicit process/VM limitations documented in that report.

Read-only review of local source and the deployed worker 1 source. No hostile submissions or worker restarts were used in this review.

## Confirmed gap

The outer worker catches Python `Exception` broadly, so adding individual exception names is not the primary issue. Classic and Codeforces evaluators catch exceptions raised by testcase execution/checking and return a Judge Error/Problem Error result instead. The worker sees an ordinary returned result and does not execute its exception-triggered restart branch.

For the directory-depth incident, a testcase's Isolate infrastructure RuntimeError or subsequent cleanup RecursionError can be intercepted this way. The damaged sandbox can remain until the next submission's initialization fails outside the evaluator; that later failure reaches automatic recovery. Another submission could therefore receive Judge Error before recovery. This path is established by source inspection, not a new production attack.

Deployed files verified:

- `mainWorkers.py`: `543205c42118ebfacebbd81ac09a6c6d97d3ab4030a6e0178b3514479b82a2a5`
- `evaluate/classic.py`: `8ee6de04dca88274fc60587ae5f66c209a490177dfab7a14093ae626b06fafe6`, handler at line 91.
- `evaluate/codeforces.py`: `959d87d135b29a8e7219f6b3646b123973855473471331b6ab0bd683b4b7c974`, handler at line 47.

The earlier integration test used the actual worker loop and real Isolate, but replaced the judging callback; it bypassed these evaluator handlers. Its success established recovery when an exception reaches the worker, not end-to-end coverage of all testcase exceptions.

## Other gaps observed

- `evaluate/verdict/standard.py` uses a bare exception handler and returns WA for checker read/decoding failures. Such internal failures are hidden rather than exposed for recovery. Not every such error implies a damaged sandbox or needs a restart, but it should not silently be classified as a contestant wrong answer.
- Isolate cleanup and initialization in `handle.py` have no wrapper timeout. Custom-checker compilation in `evaluate/verdict/main.py` also waits without a timeout. A silent block there will not raise an exception on its own.
- SIGKILL/OOM/native process crashes are not Python exceptions. The existing Docker restart policy can restart a terminated container, but an interrupted job may be retried through existing startup lease recovery; there is no general durable retry/quarantine bound in the new exception handler.
- VM/host freezes require independent host monitoring; no in-VM exception handler can guarantee recovery.
- Exceptions occurring while the error handler itself logs or persists a result can terminate the process without a saved Judge Error. Database failure has a deliberately separate restart/requeue path.

## Proposed next change, not deployed

Propagate a distinct sandbox-health exception through both evaluators, preserving expected contestant verdicts and problem-author errors. Persist the failed job once before exiting the worker. Add an end-to-end regression through the real `judge.startJudge` and evaluator path, plus a healthy follow-up submission after automatic container restart. Bound currently unbounded infrastructure subprocess waits separately. Consider a durable retry budget and an independent progress watchdog for non-exception failures.
