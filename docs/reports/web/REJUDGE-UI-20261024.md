# Live rejudge display — 24 October 2026

Deployed frontend-only fix for the standalone submission page and submission
popup. Both use a live detail query, refreshing every second while queued or
grading and stopping after completion. The standalone page previously rendered
only its original server snapshot; popup polling previously backed off.

After the API accepts a rejudge, outstanding detail/summary reads are cancelled,
both caches are replaced with the queued submission and no old result, and open
submission lists are invalidated. The immutable source code is retained. Summary
rows can resume polling even when their original table row was completed.
Score/time/memory display placeholders during grading; old subtask verdicts are
hidden. Rejudge is disabled while pending or while its request is running. A
failed rejudge leaves the prior valid result visible.

The testcase table's memoized verdict array now depends on its incoming verdicts.
This also handles fast rejudges that complete before an intermediate pending
state paints on screen.

Web type checking and production build passed. Six check groups exercised real
QueryClient/QueryObserver/MutationObserver transitions and rendered detail output:
pending-to-completed updates, row polling, late-response cancellation, failed
rejudge preservation, hidden stale metrics/verdicts, retained source, fast result
replacement and the standalone page's subscription. The private built-frontend
session/public-route checks also passed. No real submissions were rejudged and
no production database writes were made by tests.

Only the web service restarted; API process identity and six grader/database
container identities were preserved. Scripts, source hashes and evidence:
`tmp/rejudge-ui-20261024/`. VM build and rollback records:
`/opt/otog/rejudge-ui-20261024/`. Existing browser pages should be refreshed once.
