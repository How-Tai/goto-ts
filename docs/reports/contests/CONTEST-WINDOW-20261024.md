# Contest landing window — 24 October 2026

Deployed and verified. `/contest/now` now returns contests whose start is no
later than seven days (168 hours) from now and whose end is strictly after now.
This includes running contests and the exact seven-day boundary, and excludes
ended contests and starts beyond that boundary.

The contest landing page retains its single-eligible-contest redirect and
multiple-eligible-contest table. With no eligible contests, it now displays the
ordinary paginated contest list in place of the old empty-state message. Past
and more distant future contests remain available in that normal list. The
history page shares the same list component. Contest access and grading rules
are unchanged.

Both API/web type checks and production builds passed. Five isolated check
groups used the real service and a disposable PostgreSQL database, including
the exact cutoff, one millisecond beyond it, end-time boundaries, pagination,
and zero/one/multiple landing-page selections. No production test rows were
created. Live verification confirmed zero featured contests and a normal list
with both existing contests at `/contest`, with no automatic redirect. The
browser also showed both rows and pagination. All six independent graders are
still connected; their containers and database containers were not restarted.

Local scripts/evidence: `tmp/contest-window-20261024/`. VM build and rollback
records: `/opt/otog/contest-window-20261024/`, including previous API distribution,
source backups and previous frontend runtime. No database migration or grading
setting change was applied.
