# VM disk cleanup — 1 November 2026

Recovered **17.37 GiB**. Available VM disk increased from about **8.04 GiB to 25.40 GiB**.

Removed 125 verified obsolete build/dependency directories: old `node_modules`, Next builds, compiled API/package outputs, generated database clients and a test build cache. Removed the unused `otog-grader:report-20261101` image after checking that no container used it. No database/container volumes, problem files, submissions, uploads or backups were deleted.

Protected the live `/opt/otog/leaderboard-20261101/workspace`, the complete immediate rollback `/opt/otog/security-report-20261101/workspace`, and the runtime dependencies under `/opt/otog/dynamic-graders-20261030/workspace`. Kept the active Node installation and every grader-mounted source/native file. Retained the older page-load workspace, CVE audit cache, and selected startup dependencies where retained installations still link to them.

Some build outputs were removed from the Codeforces and MLE workspaces, but their grader-mounted `tools/grading` files remain. **Do not remove those workspaces wholesale.** Historical build/replay helpers may require dependencies to be recreated; use the current leaderboard release and frozen lockfile for future builds.

Before deletion, checked effective service commands/environments, process paths/open files/mapped libraries, JavaScript entry-point paths, nginx configuration, all container bind mounts, and dependency symlinks from retained installations. A fresh reference check preceded each removal. The cleanup ran on service CPU 7 with reduced CPU/I/O priority.

Verification passed:

- Protected executable/module/header hashes remained unchanged.
- Site service PIDs and container IDs, images, mounts and restart counts remained unchanged.
- Local login, problems, leaderboard, CF and API-health routes returned 200.
- Public HTTPS leaderboard and API ping returned 200; frontend build remained `CAFbkBaJJqBM-6YIE46rf`.
- Database remained accessible: 33 users, 644 submissions and 644 results; all seven grader heartbeats were current.
- The live release and working rollback remain available. No service or grader restart was performed.

Receipt, explicit target/retention list and protected-file hashes: `tmp/disk-cleanup-20261101/evidence/`. VM originals: `/opt/otog/disk-cleanup-20261101/evidence/`. Handwritten source and release evidence were preserved.
