# Resource reading freshness — 11 October 2026

Follow-up: intermittent monitor timeouts were reproduced and its CPU budget was corrected to 10% of one CPU without any service restart. See [MONITOR-AVAILABILITY-20261011.md](MONITOR-AVAILABILITY-20261011.md). The expiry behavior below remains deployed.

Deployed and verified at http://localhost:3030/admin/grading. CPU/RAM/disk/history/service readings are now removed after 20 seconds without a fresh resource sample. The page displays the sample time and explains when readings expire. Fresh samples restore the readings automatically. This protects the display during monitor failures and delayed/failed dashboard requests; it does not resolve VirtualBox stalls.

## Implementation

The API checks each resource sample against the current server time, including on every two-second cache hit. Expired telemetry is returned as null with a separate resourceStatus containing its state, last sample time and age. Missing, malformed or substantially future-dated samples are unavailable. Queue and worker data remain independent of resource availability.

The browser uses a local monotonic deadline instead of comparing two timestamps from the same frozen response. It accounts conservatively for request duration and removes all resource values when the deadline expires, even when polling stops returning. Focus and visibility events recheck the deadline when returning to a suspended tab. There is one cleaned-up timeout per response, with no additional polling or unbounded history. Existing monitor limits and history are preserved.

## Validation

- Server/cache tests passed for the 20-second boundary, cache reuse across expiry, absent/malformed/future timestamps and recovery.
- Component tests passed for hidden expired CPU/RAM, request latency, stalled polling and elapsed time after a suspended tab. These scenarios were simulated without interrupting the production monitor or network.
- Admin authorization, validation, control cache invalidation and coalesced status-read regression tests passed. API type checking and production API/website builds passed.
- Live loopback verification found six connected/enabled workers and preserved maximum workers per user of 3. All six grader IDs/start times and the monitor start timestamp were identical before and after deployment.
- Localhost and ngrok pages/assets, authentication endpoints, API forwarding and WebSocket forwarding passed. Browser inspection confirmed fresh samples, the expiry notice and twelve running services. Screenshot: vm-setup/resource-freshness.png.

Only the API and website restarted. No database changes, contestant rejudges, grader restarts, monitor restart or Windows security changes were made.

## Current release and recovery

Release: /home/otog/worker-setup/freshness-release-20261011-124521.

Prepared API source/build: /home/otog/otog/apps/api/.freshness-api-20261011-124521. Live API bundle: /home/otog/otog/apps/api/dist.

Website: /home/otog/otog/apps/web-freshness-20261011-124521/.next/standalone/apps/web-freshness-20261011-124521/server.js. Build ID: ihn9EqvGfQBAqz5hc3bJ4.

Graders retain the user-limit release recorded in PER-USER-WORKER-LIMIT-20261011.md. Monitor retains the timing release recorded in CPU-AND-QUEUE-TIMING-20261011.md.

Backup: /home/otog/freshness-backups/20261011-124521, copied to D:\otog-grader\vm-setup\freshness-backups\20261011-124521. Release/test evidence is in D:\otog-grader\vm-setup\freshness-release-20261011-124521. All new artifacts are on D:.

Activation includes automatic API/website rollback if validation fails. The backup contains the previous API bundle, source/page and website service unit. The previous API dist and standalone website remain on the VM for recovery. Restore only those application files/unit and restart API/website to undo this change; no database or grader restore is required.
