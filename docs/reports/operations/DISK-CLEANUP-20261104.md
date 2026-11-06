# VM disk cleanup — 4 November 2026

Recovered **12.17 GiB** by removing 136 verified unused build/dependency directories. Available disk increased from about **11.27 GiB to 23.43 GiB**; filesystem usage decreased from **80% to 58%**.

Removed obsolete Next.js builds, node_modules, compiled API/package outputs, and generated database clients from superseded releases. Handwritten source, release evidence, backups, database data, problems, testcase bundles, statements, and uploads were retained. No Docker containers or volumes were removed.

Preserved the live and rollback releases and grader runtime dependencies under `/opt/otog/dynamic-graders-20261030/workspace`. Retained 17 additional dependency-linked targets. Grader-mounted source files inside older releases remain intact; those release folders must not be removed wholesale.

Final verification passed:

- All 136 explicit cleanup targets were absent.
- All 38 recorded protected-file hashes matched, including active executable, API, native database engine, and grader files.
- Service PIDs, container IDs/images/mounts/restart counts were unchanged. No services or graders were restarted.
- Local login, problems, leaderboard, Codeforces, and API checks passed.
- The public HTTPS API check passed.
- The live frontend retained build `pZmXcdmgtRLwPDdVAzVAX`.
- Database remained accessible, with 33 users, 663 submissions, and 663 results. All seven grader heartbeats were current.

Cleanup plan and receipt: `tmp/disk-cleanup-20261104/evidence.tar`. VM originals: `/opt/otog/disk-cleanup-20261104/evidence/`.

Historical build/replay helpers may need dependencies rebuilt after this cleanup. Use the retained current release and frozen lockfile for future application builds.
