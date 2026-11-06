# Login and registration queue — 26 October 2026

Requested change: reduce the password-processing waiting queue from 128 to 10 and cover registration feedback too.

The API now shares **2 active password operations and 10 waiting operations** between login verification and registration hashing. Queue admission expires after 30 seconds; a full or expired queue returns HTTP 503 with a retry hint. Password hashing parameters and the number of concurrent operations are unchanged.

Registration displays separate Thai messages for server overload, registration rate limiting, duplicate names and other failures. A pending request disables the form, rejects duplicate clicks, and updates its notice after three seconds. Errors retain the form values; successful registration still goes to login.

Rate limits remain separate: login allows 120 attempts/minute/IP and 30 attempts/minute/username; registration allows 120 attempts/hour/IP. Registration's rate-limit message does not promise a one-minute retry.

Focused checks exercise the actual password helper with controlled crypto completion: twelve mixed hash/verify jobs are admitted, excess work is rejected, rejected registration inserts no account, admitted jobs finish, and capacity recovers after both overload and hashing failure. The registration page handler checks errors, pending state, repeated submissions, timer cleanup and success navigation. Existing login and web-capacity checks also pass. All focused checks use fixtures and create no production accounts.

Deployed and verified:

- API and frontend type checks, production build, focused queue/UI checks, API regressions, frontend session regressions and 51-route schema compatibility checks passed.
- Dependency inventory checks found no reported vulnerabilities in the rebuilt API, frontend or build dependencies.
- Public login, registration, problems, contests, API health and registration JavaScript returned HTTP 200.
- Six grader container identities, images, mounts and restart counts match the recorded preflight. Their configuration was not changed.
- No temporary database test roles remain. The final check found 2,794 MiB available memory and 23.4 GiB free disk.
- Web build: `ZYAJkdtZ4pu4nQTmw0EiS`; API bundle SHA-256: `a478251ba0cfcdbce190cac93b6838c068d423c0cdc67b50a7b86e023e021e0e`.

The first frontend build was interrupted before completion. Its temporary build configuration was verified and restored, and the build was successfully resumed as an independent VM job before tests and deployment.

Release evidence: `tmp/password-queue-20261026/evidence/`. Runtime: `/opt/otog/password-queue-20261026/workspace/`. Previous releases are retained for rollback. Earlier 100-login benchmark results used the previous 128-waiting configuration; the new limit intentionally returns busy above the smaller admission capacity.
