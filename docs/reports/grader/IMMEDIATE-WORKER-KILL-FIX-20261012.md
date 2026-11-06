# Immediate worker Kill and restart compatibility fix — 12 October 2026

## Cause

The API still required Docker Config.Image to equal `otog-grader`. The runtime migration deployed all six graders as `otog-grader:glibc-20261012`, so that fixed identity check rejected every restart before sending a Docker restart request. The earlier website concurrency update did not address this backend mismatch.

## Change

`D:\otog\apps\api\src\modules\grading\worker-control.service.ts` now accepts the two exact known image names: `otog-grader` and `otog-grader:glibc-20261012`. The fixed container name/ID, Compose project/service labels, worker-ID identity, job/start snapshot, transaction lock, busy guard and cooldown checks remain. Future grader-image tag changes must update this allowlist as part of deployment.

`D:\otog\apps\web\src\pages\admin\grading.tsx` now starts a restart immediately from the Kill click. The confirmation dialog was removed at the user's explicit request. Different workers' requests can overlap; a synchronous per-worker guard blocks duplicate clicks and excludes pause/resume while that same worker's restart is pending. Each pending row retains its own `Restarting…` state.

## Verification

- Actual page event handlers tested with delayed mocked requests: immediate Kill, no confirmation dialog, overlapping worker actions, duplicate-click rejection, out-of-order completion and 409 recovery passed.
- Local web TypeScript check passed.
- Isolated API HTTP and worker-control regression tests passed. Both known image names were accepted; incorrect image, container ID, labels, worker ID, stale snapshot, invalid/unauthorized HTTP request and duplicate restart guards were checked without touching production workers.
- API and web typechecks and production builds passed. Builds used low priority on spare guest CPU 6 with a 1 GiB Node heap limit.
- Activation restarted only API and website. All six grader container IDs/start timestamps were unchanged during deployment. The new grading-page asset hash matched the asset served over HTTP, and the website returned HTTP 200.
- Controlled live verification then paused two idle workers, 6 and 5, restarted them in parallel through the real authenticated endpoint, and verified that they reconnected with new start timestamps. Pause settings survived, immediate repeated requests were rejected by cooldown, the other workers did not restart, and both original pause/resume settings were restored. **No busy submission was interrupted.**

## Release and backups

Guest web stage: `/home/otog/otog/apps/web-worker-buttons-20261012-125457`.

Guest API stage: `/home/otog/otog/apps/api/.worker-buttons-api-20261012-125457`.

Rollback material copied to `D:\otog-grader\vm-setup\worker-buttons-backups\20261012-125457`, including the previous worker-control source, API bundle archive, grading-page source, website service unit and deployment verification. Earlier production releases remain available. The previous API bundle also remains at `/home/otog/otog/apps/api/dist.worker-buttons-before-20261012-125457`.

Refresh the grading-status page to load the immediate Kill button. Kill still stops and restarts the selected grader; its unfinished submission is recovered through the existing worker lease mechanism.
