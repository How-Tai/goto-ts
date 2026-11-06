# Load optimizations — 14 October 2026

## Deployed changes

- Problem-list passed-user counts now use PostgreSQL `COUNT(DISTINCT userId)` grouped by problem. Previously the API loaded distinct accepted-submission records and counted them in JavaScript. Admin submissions remain excluded; visibility and personalized latest submissions are unchanged. Counts are queried fresh, without a response cache.
- Added online indexes `otog_submission_status_problem_user_idx` on `(status, problemId, userId)` and `otog_submission_user_problem_latest_idx` on `(userId, problemId, creationDate DESC)`. Recorded migration `20261014080000_submission_read_indexes` and updated the Prisma schema. No regeneration or record changes were required.
- Nginx caches only public versioned `/_next/static/` assets, respecting upstream cache headers and using a 128 MB disk limit, 14-day inactivity limit, and cache locking. No dynamic HTML, account, score, authentication, or private API responses are proxy-cached.
- Enabled gzip for eligible text/JSON/JS/CSS/SVG responses at level 4 with a 1 KB threshold. PDFs are not added to gzip types.

## Validation and measurement

Nine exact old/new response comparisons passed in a read-only repeatable-read transaction, covering public/hidden/all visibility and anonymous/regular/admin personalization. A small alternating ten-pair service benchmark measured medians of 7.54 ms before and 5.33 ms after, before adding the indexes. This is a local query/service measurement, not a throughput or maximum-user claim.

API typecheck, production build, and schema validation passed before deployment. Both concurrent indexes are valid and ready. Three served static assets matched direct upstream SHA-256 hashes and produced cache hits. JSON was gzip compressed. Dynamic API responses remained uncached. Public list/detail/PDF/announcements and regular/admin permission checks passed; anonymous access to protected data remained denied.

The API was restarted to load its new code; nginx was reloaded. The website process and all six grader container identities and start times remained unchanged. A browser verified the public problem list renders its 28 visible problems normally.

Current configuration is still eight VM CPUs, 4 GB RAM, and six graders on their existing CPU sets. No concurrency, verdict, time-limit, worker priority, polling cadence, or user-interface changes were made. Existing admin polling already pauses in background tabs.

Backups, database dump, source manifest and verification: `D:\otog-grader\vm-setup\load-optimization-backup-20261014.tgz`. VM release directory is recorded in `/home/otog/worker-setup/load-optimization-current.txt`. Rollback retains the prior API bundle and nginx configuration; indexes are additive and do not change data.
