# Signed-out public browsing

## Cause

The public problem detail page unconditionally fetched the current visitor's latest submission during server rendering. That endpoint correctly requires authentication, so signed-out visits to a public problem returned a 500 page. A hidden problem also dereferenced the missing user while checking visibility, causing a 500 instead of a denial.

Separately, an access-token cookie could survive the session reset. The API correctly rejected its obsolete signature, but the browser refresh path left the stale token in place after rejected refreshes. Its request queue also remained locked on refresh failures other than 401/403.

## Changes

- Public problem rendering skips private submission requests when signed out. Requests for submission source still require login.
- Hidden problem requests handle an absent user safely. The website shows not found; the API denies access.
- Signed-out session state removes the obsolete access-token cookie.
- Browser token refresh uses a shared promise, clears rejected credentials, and releases pending requests even after network/server failures.
- After rejected refresh, public GET requests may retry once without credentials. Writes are never replayed as guests. Protected routes continue enforcing their guards.

## Validation

Focused tests cover stale-session public fallback, no guest write replay, one shared concurrent refresh, bounded protected-route retries, and recovery after a failed refresh. API and website type checks and production builds are staged separately from live services, with CPU and memory limits.

Deployment uses source backups and automatic rollback, preserves login signing-key drop-ins, and compares the identities and start times of all six graders. No database records or IDs are changed by this fix.

## Deployment result

Deployed release `guest-access-20261014-141235`. All regression and production access checks passed: public list, detail, PDF and shown announcements; anonymous denials for hidden content, personal latest submissions, uploads and admin routes; regular-user and admin visibility rules; public server rendering HTTP 200 and hidden page HTTP 404.

An initial activation hit a root-owned build file in the API's existing startup build step. Automatic rollback restored the prior deployment. Build ownership was corrected before retrying; the second activation and verification passed. All six grader container identities and start times remained unchanged.

A signed-out browser visibly loaded the public problem page and its problem list (28 visible problems). Screenshots: `vm-setup/guest-public-problem-verified-20261014.png` and `vm-setup/guest-public-list-verified-20261014.png`. Source backups and verification results are saved on D in `vm-setup/guest-access-backup-20261014.tgz`.
