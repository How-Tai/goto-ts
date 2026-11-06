# Leaderboard integration

Adapted from [phakphum-dev/otog PR #26](https://github.com/phakphum-dev/otog/pull/26)
by c3mzz, reviewed at commit `8ac80f4d0e59e942ee5ca506184e11c277791cc2`.

## Behavior

- `/leaderboard` ranks distinct accepted problems by public solve count, then rating,
  display name and ID. Search retains overall ranks; pagination runs in PostgreSQL.
- A hidden account is omitted from other users' rankings but can see its own entry.
  Admins can include all accounts and see totals that include private problems.
- Public counts exclude hidden problems and contest results whose scoreboard policy
  has not released them. Profile solve lists apply the same contest-result restriction
  for other viewers; owners can see their own contest results, and admins can see all.
- The profile's solved-problems tab groups repeat solves by problem and uses the latest
  accepted submission. Problem names link to `/problem/:id`.
- The visibility control permits the account owner or an admin. Existing admin accounts
  are hidden by the migration; promoting an account also hides it. Current identity
  checks read the setting from the database, preserving existing session revocation.
- Frontend query caches separate viewers so admin or owner data is not reused by guests.

## Deployment

Commit `3d8eea5` was deployed to the live site on 1 November 2026. The leaderboard
migration is applied, and public HTTPS leaderboard/API checks passed with frontend
build `CAFbkBaJJqBM-6YIE46rf`. See the [deployment record](../../docs/reports/web/LEADERBOARD-DEPLOYMENT-20261101.md)
for verification, preserved grader allocation and rollback locations.

Apply `20261101010000_leaderboard` before starting the updated API. Regenerate shared
database schemas/contracts with `pnpm codegen`, then rebuild API and web. This integration
does not require grader changes. The original PR's commented destructive demo seed and
unrelated TypeScript configuration change were not imported.

Existing installations should already have prior goto migrations applied. A fresh test
installation additionally needs the repository's existing runtime roles, statement-by-
statement application of the historical concurrent-index migration, and retirement of
the old compiler-state rows before the existing seventh-worker migration. These are
pre-existing operational migration requirements, not changes introduced by this feature.

## Verification

Verified in a separate local VM workspace and disposable PostgreSQL database on
1 November 2026, without deploying or changing production accounts/data:

- Database generation and contract, API and web type checks.
- API and production Next builds, including the new leaderboard route.
- Nine PostgreSQL/HTTP groups in `test-api.cjs`: migration defaults/admin backfill,
  public/private counts, hidden users, admin access, search/pagination, invalid inputs,
  solved-list visibility, owner-only updates and session revocation on role changes.
- Five React rendering/handler groups in `test-render.cjs`: columns/links, escaped
  names, viewer-specific caches, visibility success/failure feedback, guest controls,
  and loading/error states.
- Four production HTTP checks in `test-http.cjs`: leaderboard/profile pages, retained
  Codeforces route, client assets and the same-origin API proxy.
- Existing five-group authentication/visibility/socket regression and eleven-state
  Codeforces render suites.

Next's inherited ESLint integration reports incompatible loader options during the
otherwise successful production build; a clean lint run is not claimed. The build also
required a type-only `BlobPart[]` correction in the existing clangd worker for the
current TypeScript DOM definitions. No editor runtime behavior was changed.

For database/API tests, start the candidate API on `127.0.0.1:18260` with a separate,
empty `leaderboard_test` database and complete dummy storage settings, then run:

```sh
node tools/leaderboard/test-api.cjs
node tools/leaderboard/test-render.cjs
```

The integration test intentionally creates fixture accounts/problems/submissions only
in that named empty database. For production-build HTTP checks, retain those fixtures,
start the built web app on port 18263 with `API_HOST_SSR=http://127.0.0.1:18260`, and put
an isolated reverse proxy on `127.0.0.1:18262`. Route `/backend/` to the fixture API
on port 18260, stripping `/backend`, and other requests to the frontend on port 18263.
This mirrors the live nginx layout. For example, in an isolated nginx configuration:

```nginx
server {
    listen 127.0.0.1:18262;
    location /backend/ {
        proxy_pass http://127.0.0.1:18260/;
    }
    location / {
        proxy_pass http://127.0.0.1:18263;
    }
}
```

Next.js fixes rewrite destinations during the build; changing `API_HOST_SSR` only
when starting the preview does not retarget an already-built `/backend` rewrite.
Keep test routing separate from the live API. Then run:

```sh
node tools/leaderboard/test-http.cjs
```

Stop the fixture API/frontend/proxy, and remove the disposable database and generated
test secrets after verification. Rendering
and HTTP tests establish behavior, not browser visual appearance.
