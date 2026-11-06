# Contest detail grading navigation — 24 October 2026

Deployed the missing Grading status tab on `/admin/contest/[contestId]`. The
detail page had its own administration tab list and omitted the link already
present on the other administration pages. It now links to `/admin/grading`
with the same styling; the contest tab remains selected on contest details.

Only seven navigation lines changed in the page source. Web TypeScript checking
passed. The production build includes the link in the contest detail route's
client chunk. All six private session/public-page smoke checks passed without
using real accounts or writing production data.

After deployment, a read-only browser check at `/admin/contest/2` confirmed the
fourth tab is visible. Clicking it opened `/admin/grading`, which showed six
connected graders. The API and grader/database containers were not restarted.

Cold builds exceeded the earlier conservative heap allowance or stalled under
the old memory caps. After explicit user approval, this build used a temporary
2,048 MiB Node heap, 1,536 MiB memory soft target, 2,304 MiB RAM hard cap and
1,024 MiB swap cap. It retained a 768 MiB available-memory guard and actually
kept at least 1,008.6 MiB available. Build-only Next.js memory optimizations and
serial compilation were enabled. The helper restored next.config.js and
removed the transient build scope on completion; runtime/grader limits did
not change.

Source hashes, release scripts and build/smoke/deployment evidence:
`tmp/admin-grading-tab-20261024/`. VM release records:
`/opt/otog/admin-grading-tab-20261024/`. The previously running rejudge frontend
is retained for rollback. Refresh an already-open contest detail page once.
