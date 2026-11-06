# Invalid-session login redirect — 24 October 2026

Deployed frontend-only change. Rejected session refreshes and rejected retried
requests now clear the access token, perform best-effort logout, clear NextAuth
state and navigate to `/login`. Concurrent failures share cleanup. Requests no
longer silently retry as anonymous users after an invalid refresh. Ordinary 403
permission errors and temporary server/network errors do not trigger logout.

NextAuth callbacks handle malformed tokens and missing expiry/refresh state as
invalid sessions, while temporary refresh failures remain retryable. Successful
refresh and fresh login clear prior error markers. Server-rendered pages clear
invalid/chunked session cookies and redirect to login. The login page verifies
a stored session before redirecting away, so a rejected unexpired session does
not bounce between login and the application. Public guests remain supported.

Web type checking, production build and six groups of source-function checks
passed. A private built frontend with a synthetic NextAuth key passed six HTTP
checks covering malformed tokens, an unexpired backend-rejected dummy token,
expired tokens without refresh cookies, corrupt NextAuth cookies, split cookies,
and anonymous public reads. No real accounts or production database writes were
used. Live synthetic invalid-cookie requests returned `/problem/66` → 307
`/login`, followed by a stable 200 login page.

Only the web service restarted. API process identity and all six grader/database
container identities were preserved. Evidence, source hashes and helpers are in
`tmp/session-login-20261024/`; VM build and rollback records are under
`/opt/otog/session-login-20261024/`. No API or grading configuration was changed.
