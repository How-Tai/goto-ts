# Chat authentication bypass: investigation only

Date: 16 October 2026, Asia/Bangkok.

**Status at the conclusion of the original investigation: confirmed in this clone and present in its running API build. High severity for chat/presence impersonation. The user requested investigation only at that point.**

**Subsequent remediation:** the user later authorized a patch, which is now deployed. See [the fix and verification report](CHAT-AUTHENTICATION-FIX-20261016.md). The findings and evidence below describe the original vulnerable version.

## Confirmed root cause

`D:/otog/apps/api/src/modules/chat/chat.gateway.ts:58` accepts the Socket.IO handshake's client-supplied token. At line 60 it calls `this.jwtService.decode(token)`, constructs `UserDTO` directly from the returned claims and inserts that object into `userList` at line 62. There is no signature, expiration, algorithm or user-existence verification in this path.

This is decoding, not decryption. JWT decoding reads the encoded claims and does not establish that the server issued them. Nest's installed JwtService delegates this operation to `jsonwebtoken.decode`, whose documentation explicitly says it does not verify the signature:

https://github.com/auth0/node-jsonwebtoken/blob/master/README.md#jwtdecodetoken--options

The presence list returned by `UserService.onlineUser()` (`user.service.ts:146`) is derived from `userList`, so untrusted ID, display name, username, role and rating claims can enter the online-user representation.

`ChatGateway.receiveMsg()` at lines 36-44 then retrieves the same unverified object and calls `chatService.create(message, user.id)`. `ChatService.create()` writes that supplied ID as the chat's `userId`. The database foreign key requires an existing target user for a real persisted chat, but it does not authenticate who supplied that ID. Broadcast display-name/rating values also come from the unverified socket identity.

The ordinary HTTP strategy in `modules/auth/jwt.strategy.ts` uses passport-jwt with a signing key and expiration checks. That is a different authentication path; it does not compensate for this gateway's decode-only connection handler. The isolated transport reproduction included the clone's actual global HTTP JwtAuthGuard, and invalid-token chat traffic was still accepted.

## Evidence from the running VM

Read-only inspection of `/home/otog/otog/apps/api` found:

- `src/modules/chat/chat.gateway.ts` contains `jwtService.decode` and no `jwtService.verify` call.
- Its SHA256 is `06d9420a65e3cc62a4cf416822ea3d8fb13f9ac2e6c08de7d1d97ef6908abe36`, identical to the reviewed local gateway.
- The active `dist/index.js` contains `this.jwtService.decode(token)` and the chat event handler. Bundle SHA256: `86fad3a902d01dde907f95ddf13a1fdd742f899fe8994006db5a2e778f6f8053`.
- The otog-api service was active, working directory `/home/otog/otog/apps/api`.

The gateway code is therefore deployed, rather than merely an unused local source copy. No impersonated socket was opened against the live API or ngrok endpoint.

## Isolated reproduction

Used the unmodified gateway, its real UserDTO and userList implementation, installed Nest/JWT/Socket.IO libraries, and the clone's HTTP global JWT guard. The temporary server listened on a randomly selected **127.0.0.1** port and was closed afterward. Database creation was stubbed to record attempted writes without accessing any real database. Tokens used only synthetic user ID 424242 and dummy signing keys.

| Token | Normal JWT verifier | Gateway presence | Chat write/broadcast path |
| --- | --- | --- | --- |
| Signed with an unrelated dummy key | Rejected | Accepted claimed ID | Used claimed ID |
| Expired token | Rejected | Accepted claimed ID | Used claimed ID |
| Unsigned token | Rejected | Accepted claimed ID | Used claimed ID |
| Properly signed, unexpired test control | Accepted | Accepted claimed ID | Used claimed ID |

Both direct handler probes and actual Socket.IO transport probes reproduced the bypass. The transport results show that HTTP authentication does not prevent it in the gateway execution path.

Artifacts:

- `D:/otog/tmp/chat-auth-audit-20261016/reproduce-chat-auth.cjs`
- `D:/otog/tmp/chat-auth-audit-20261016/vulnerability-confirmed.json`
- `D:/otog-grader/vm-setup/inspect-chat-auth-20261016.sh` (read-only VM inspection)

No production credentials were read by the reproduction or included in these artifacts. No messages, users or database records were created on the live site.

## Impact and limits

An unauthenticated caller can supply invented token claims to appear online as another user and reach the message persistence path under another existing user's ID, including an administrator's ID. An arbitrary invented ID can also enter presence without a real account, although a nonexistent ID cannot satisfy the database's chat foreign key.

Displaying an administrator identity in chat/presence is **not proof of obtaining administrator HTTP permissions**. This investigation did not establish access to problem editing, user administration, submissions, the host or the database outside the chat write path. It is an authentication bypass in this module, not evidence that the JWT library's cryptography is broken or that a signing secret has leaked.

Past exploitation has not been determined. Existing chat rows record a user ID and message, which alone cannot establish whether the writer originally authenticated as that user. No historical messages or verdicts were altered or removed.

## Recommended remediation, not applied

1. Authenticate in Socket.IO middleware before accepting the connection. Reject missing/malformed tokens and verify signature, expiration and the explicitly allowed signing algorithm using the server's configured secret. Socket.IO documents this handshake authentication mechanism: https://socket.io/docs/v4/middlewares/ .
2. Validate the verified claim structure (including a positive integral user ID and a valid expiry), look up the current user in the database, and bind a server-controlled identity to the socket. Do not trust client claims for the displayed name, role or rating.
3. Require that authenticated socket identity for every message. Account for tokens expiring during an established connection, with expiry enforcement/disconnection and a message-time expiry check.
4. Populate presence only after authentication succeeds. Ensure rejected and disconnected sockets leave no presence entry or pending expiry timer. Remove existing unauthenticated connections when deploying a fix; an API restart/reconnect would clear the current in-memory bindings while leaving graders running.
5. Add regression tests covering unrelated signatures, unsigned and expired tokens, malformed claim types, nonexistent users, valid connections, expiry after connection, disconnect cleanup and attempted identity overrides. Enforce the existing frontend's message size/type rules on the server too; these are not currently validated in receiveMsg.

Simply restricting CORS, hiding the chat UI or checking that a payload contains an ID would not authenticate its sender. Key rotation or password resets alone would also leave decode-only acceptance in place.

## Changes made during this investigation

During the original investigation, created only isolated audit scripts, JSON evidence and this report under D. No application source files, live services, secrets, configuration, chat history, account records, workers or grader settings were changed at that point. The later, explicitly authorized remediation is documented in the fix report linked above.
