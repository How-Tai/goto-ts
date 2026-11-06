# Per-account token buckets

The API admits short bursts and continuously refills each authenticated account's allowance. Authentication runs before admission, and buckets use the verified account ID rather than IP addresses. Tabs and devices using the same account share a bucket; different accounts on the same network do not.

| Traffic | Full bucket | Refill |
| --- | ---: | ---: |
| Ordinary authenticated API requests | 300 | 60 tokens/second |
| Code submission uploads, including admin uploads | 10 | 1 token/second |
| Other authenticated admin API requests | 600 | 120 tokens/second |

Each request costs one token. Submission uploads use their own bucket, so browsing/polling and submissions do not consume one another's allowance. Admin reads and operations such as bulk rejudging share the larger admin bucket. Metadata on the upload handler identifies submissions, including route case/trailing-slash aliases; admission happens before multipart parsing and before creating a grading job. Invalid or retried requests also cost a token.

An exhausted bucket returns HTTP 429, a `Retry-After` header, and `{ code: 'RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่', retryAfterSeconds: ... }`. Submission UI displays that message and retains the current source/file. No automatic submission retry or duplicate job is introduced.

The existing 200 pending submissions per account, 5,000 pending across the site, authentication throttles, and grader concurrency settings remain independent. Anonymous requests and Socket.IO events are outside these authenticated HTTP buckets.

State lives in the single API process: no extra dependency or per-request database query. The registry is bounded to 20,000 buckets and reclaims fully replenished entries without granting extra tokens. If all entries are occupied, new entries receive 503 with a one-second retry hint instead of evicting depleted buckets. Restarting the API refills all buckets; multiple API replicas would require shared state.

Implementation: `apps/api/src/utils/token-bucket.ts`, `apps/api/src/core/guards/account-rate-limit.guard.ts`, global guard registration in `apps/api/src/index.ts`, and submission metadata in the upload controller.

Verification: `apps/api/test/account-rate-limit-20261030.cjs` covers fractional refill boundaries, capped refill, bounded registry behavior, parallel HTTP bursts, account isolation, independent submission/API buckets, admin limits, route aliases, HTTP 429, Retry-After and Thai feedback. It creates no database records and runs no grading jobs.

Deployment helper/evidence: `tmp/account-rate-limits-20261030/`. Candidate copies the currently deployed dynamic-grader release; dependencies and grader services are unchanged. API/frontend typechecks and builds use production dependencies on CPU 7 with build resource limits and a memory headroom guard. A timed rollback protects the service switch.

Deployed successfully. Current API/frontend workspace: `/opt/otog/account-rate-limits-20261030/workspace`; web build `l_VgP_qVBCik3No9mw_JB`. Previous dynamic-grader workspace remains the rollback release. Public HTTPS login and backend ping returned 200; all seven grader container identities/PIDs/restart counts were preserved. Rollback timer stopped after verification; temporary candidate service stopped and its credential environment file removed.

The actual candidate API was also tested with PostgreSQL enforcing read-only transactions: invalid JWT returned 401, 10 simultaneous multipart requests reached invalid-language validation, six further requests received the expected 429/header/body, route aliases stayed limited, independent reads succeeded, and the upload allowance refilled. No production submissions were created. Existing API performance, frontend request-efficiency and announcement-placeholder regression tests passed using VM dependencies. Both VM typechecks and builds passed. Local Windows full typechecking/regression checks remain affected by the existing stale Zod v3/generated-contract dependencies; those unrelated dependencies were not changed.
