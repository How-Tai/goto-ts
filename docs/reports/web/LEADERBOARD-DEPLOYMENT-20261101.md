# Leaderboard deployment — 1 November 2026

Deployed `How-Tai/goto` commit `3d8eea5d9f137dd3be3519c1f81762dbbcb90fc4` to the live VM. Public HTTPS `/leaderboard` and `/backend/user/leaderboard?limit=10&skip=0` returned 200, with the expected frontend build and API data.

- Frontend build: `CAFbkBaJJqBM-6YIE46rf`.
- Release: `/opt/otog/leaderboard-20261101/workspace`.
- Web runtime: `apps/web/.next/standalone/apps/web` within that release.
- API entry: `apps/api/dist/index.js` within that release; the existing production working directory, credentials and authentication proxy secret remain in effect.
- Applied `20261101010000_leaderboard` transactionally before switching the applications. Existing admins default to hidden from the leaderboard; ordinary accounts default to shown. Account roles and existing sessions were preserved.
- All seven grader containers retained their IDs/restart counts. Five remain selected; CPU allocation revision 66 is unchanged. No grader rollout, rejudge or contest schedule change was required.

Validation passed: database/client generation; API/web type checks and builds; nine leaderboard PostgreSQL/HTTP groups; five rendering/handler groups; five authentication/authorization/socket regression groups; eleven CF rendering states; four built-page/proxy checks. Live leaderboard, profile solve history, CF and API-health routes returned 200. Disposable accounts/data were confined to the removed `leaderboard_test` database.

The older VM workspace had omitted tracked editor sources and some dependency `source` directories. This release restores the repository's editor dependencies and reconstructs packages from the frozen lockfile/local cache, retaining cached Prisma engines. No dependency-version changes were introduced. The preview used an isolated reverse proxy matching nginx's `/backend` routing, since Next's rewrite destination is fixed during the production build.

Operational helper/evidence: `tmp/leaderboard-deploy-20261101`. The GitHub publication checkout is `tmp/github-combined/repo`, remote `https://github.com/How-Tai/goto.git`; the deployed application source remains commit `3d8eea5`, regardless of later documentation-only commits. The sixteen feature files were also synchronized into this maintenance workspace with baseline checks. Existing unrelated edits were preserved. Local generated dependencies may still need installation/code generation for development; deployment verification used the release's locked dependencies on the VM.

The previous API/web release remains available under `/opt/otog/security-report-20261101` for a compatible application rollback. Its historical deployment checks expect its own old build ID. The additive column can remain if rolling applications back; do not blindly reverse the production migration or restore old user data. Rollback override paths are recorded in this release's `evidence/before.json`.

No browser visual inspection was available. Final VM readings: 4,451 MiB available memory and 8.04 GiB free disk.
