# Independent worker controls — 12 October 2026

Deployed a website-only change allowing admin actions on different workers to run concurrently. Each worker has its own busy state. Kill confirmation closes immediately after starting the request, so another worker can be selected and confirmed without waiting for the previous request to finish. Every pending restart shows `Restarting…` on its own row; pause/resume shows `Updating…`.

A synchronous guard prevents duplicate requests on the same worker, including a repeated confirmation click before React rerenders. Pause/resume and Kill are mutually exclusive only on that worker. Existing server-side identity checks, current-job confirmation, same-worker cooldown and job recovery were unchanged. Worker-specific success/error messages identify the affected worker when requests finish in a different order.

## Validation

- Executed the actual page handlers with deferred mocked requests: two Kill requests and a third worker Pause overlapped; same-worker duplicate confirmation was suppressed; each pending row showed its own state; out-of-order success and a 409 conflict released only the corresponding row. No live workers were killed by this test.
- Local TypeScript check passed using the installed compiler. The local pnpm launcher attempted a registry lookup and failed; validation used the already installed compiler directly without installing anything.
- Isolated guest TypeScript check and optimized Next.js production build passed. The build used low priority, one spare guest CPU and a 1 GiB Node heap limit. Existing unrelated lint/module/Browserslist warnings were retained.
- The newly built grading page JavaScript was fetched over HTTP and its hash matched the built asset. The website returned HTTP 200 after activation.
- API startup timestamp and all six grader container IDs/start timestamps were unchanged. Only the website service was restarted. No submission/result/worker database settings were changed.

## Files and release

Source: `D:\otog\apps\web\src\pages\admin\grading.tsx`.

Behavior check: `D:\otog\tmp\test-worker-button-overlap.cjs`.

Guest staged build: `/home/otog/otog/apps/web-worker-buttons-20261012-114836`. The active standalone website server is under its `.next/standalone/apps/web-worker-buttons-20261012-114836` directory. The earlier web release remains available.

Backup and verification copied to D: `D:\otog-grader\vm-setup\worker-buttons-backups\20261012-114836`. This contains the previous grading page, previous website service unit, and empty grader/API comparison diffs verifying those processes were preserved. Restoring the saved page and service unit, then reloading systemd and restarting only the website, returns to the previous web release.

Refresh the grading-status page to load the new buttons. Each Kill still requires its own confirmation, but different workers' restart requests can overlap.
