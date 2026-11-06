# Chat authentication vulnerability patched

Deployed 16 October 2026, Asia/Bangkok. The previously confirmed JWT decoding bypass is fixed in the running API and in the local source. Invalid authentication is rejected on both localhost and the public ngrok site.

## Changes

- `apps/api/src/modules/chat/chat.gateway.ts`: authenticates Socket.IO handshakes before connection, using cryptographic JWT verification with the server's configured signing key and an explicit HS256 allowlist. Signature, expiration and not-before validation are enabled. Missing/malformed tokens, missing expiry, invalid user-ID types/ranges and nonexistent database users are rejected.
- A current database lookup supplies the socket's user identity, display name, role and rating. Token-supplied profile metadata and extra client fields do not determine the displayed identity or message author.
- A server-controlled WeakMap binds each authenticated socket to that identity and its expiry. The legacy presence cache no longer grants permission to send messages.
- Connected sockets are disconnected at token expiry, with another expiry check on every message. Disconnect and expiry clear presence and pending timers. Authentication that expires during the database lookup fails closed; cancelled handshakes do not enter presence.
- The server enforces the existing frontend rule: messages must be strings containing 1-150 JavaScript characters. Invalid message payloads raise a WebSocket error and cannot create a chat row.
- `apps/api/src/modules/chat/chat.service.ts`: adds a read-only user lookup selecting the existing non-password profile fields.
- `apps/api/test/chat-auth-security.cjs`: adds repeatable regression tests using real Nest/Socket.IO/JWT components, dummy signing keys and a stub database. Run `pnpm --filter @otog/api test:chat-auth` in the installed monorepo workspace.
- `apps/api/package.json`: adds that test script. No dependency changes were required by this fix.

The existing token issuer uses HS256; legitimate unexpired tokens remain valid. No signing secrets or passwords were changed. The HTTP authentication flow and browser code were preserved. Database identity is loaded at connection; this patch does not claim to add a separate account-wide session-revocation system.

## Verification

The full staged API passed its TypeScript check and production build in the Linux VM. Its 52 security regression checks passed, including:

- WebSocket and HTTP-polling rejection of missing, empty, malformed, non-string and oversized tokens; wrong signatures; unsigned, expired, not-yet-valid and wrong-algorithm tokens; missing expiry; invalid ID values/types; unsafe expiry values; and nonexistent users.
- Invalid cryptographic/claim checks reject before querying the database; a database failure also rejects the handshake with a generic error.
- Correct normal-user and administrator connections, normal message writes/broadcasts, server-selected database identity despite conflicting signed display claims, multiple tabs, polling, and disconnect cleanup.
- Message type and length enforcement, including the valid 150-character boundary and rejection of an object attempting to supply a different message author.
- Presence-cache poisoning cannot authorize messages; automatic expiry and message-time expiry enforcement work; abandoned handshakes and expiry during a delayed database lookup leave no online entry.

An isolated instance of the built full API then used the same effective environment-file order and service signing configuration as production. A short-lived internally signed control connected, its online representation matched the read-only database user rather than token profile claims, and its presence disappeared on disconnect. Eight invalid connections were rejected over both transports. This server listened only on a random VM loopback port and was terminated after testing.

After deployment, the running API rejected eight invalid connections directly and another eight through the website proxy. Separate checks from Windows confirmed missing-token rejection over WebSocket and polling on both `http://localhost:3030` and `https://quaintly-decorated-congenial.ngrok-free.dev`. Both problem-page checks returned HTTP 200. No chat messages were sent to the real database during staging or live checks.

The Windows checkout's broader API typecheck encountered pre-existing local installation gaps (stale contract declarations and missing local pdf-lib). The complete API check and build passed against the actual VM installation; the deployment used that verified build.

## Deployment and preservation

Original application source, package metadata and compiled API were backed up before switching. Source and build hashes were checked against the staged snapshots. Only the API was restarted; this cleared old connections and their unverified in-memory identities. Legitimate browser sockets could reconnect with valid existing tokens.

The known API build pre-start command was skipped only for this restart using a temporary runtime override, allowing deployment of the already tested build. The override was removed and the original pre-start configuration restored. Source and compiled output now both contain the fix, so a later normal API rebuild retains it.

Verified deployed file hashes match the tested revision. Before/after snapshots show all six grader container IDs and start times unchanged, with fresh heartbeats after deployment. Website, nginx, ngrok and monitoring process start times, worker enable/CPU settings, per-user worker cap and problem settings were unchanged. The workers were not paused or restarted. API health and public pages passed.

No database migrations, account edits, historical-message deletion or submission changes were performed by this patch. Grading could continue during the API restart, so ongoing legitimate grading writes were not treated as failures or rolled back. This fix prevents the confirmed impersonation path; it does not establish whether historical chats were authentic or whether the earlier flaw was ever exploited.

## Evidence and backup on D

- `D:/otog-grader/vm-setup/chat-auth-evidence-20261016.tgz`
- `D:/otog-grader/vm-setup/chat-auth-evidence-20261016/application-before.tgz` (original source/package/compiled API; no environment files included)
- `D:/otog-grader/vm-setup/chat-auth-evidence-20261016/security-tests.json`
- `D:/otog-grader/vm-setup/chat-auth-evidence-20261016/staging-smoke.json`
- `D:/otog-grader/vm-setup/chat-auth-evidence-20261016/live-api-smoke.json`
- `D:/otog-grader/vm-setup/chat-auth-evidence-20261016/live-proxy-smoke.json`
- `D:/otog/tmp/chat-auth-audit-20261016/public-patch-verified.json`

The earlier investigation evidence is preserved. Its original bypass reproduction targets the old behavior and should no longer succeed against the patched source.

References: [Socket.IO authentication middleware](https://socket.io/docs/v4/middlewares/), [JWT verification options](https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback).
