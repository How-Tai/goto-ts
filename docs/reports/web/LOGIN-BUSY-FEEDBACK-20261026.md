# Login overload feedback — 26 October 2026

Deployed frontend-only release `/opt/otog/login-busy-20261026/workspace/apps/web/.next/standalone/apps/web`, build `1yj-PTOjagPQSunfNF1Tc`. The running API remains in `/opt/otog/web-capacity-20261026/workspace`; its command and PID were verified unchanged. Grader identities, images, mounts and restart counts are unchanged.

Login behavior:

- After three seconds, update the pending notification to explain that a server response is still pending and the server may be busy. The request continues.
- Overload, admission expiry and request timeout show **“เซิร์ฟเวอร์มีผู้ใช้งานจำนวนมาก กรุณารอสักครู่แล้วลองใหม่”**.
- HTTP 429 shows a separate message asking the user to wait one minute. Incorrect credentials retain their own message.
- The credentials provider passes stable error identifiers through NextAuth; the page checks them before HTTP 401. Internal error details are not shown to users.
- The provider's upstream login request has a 35-second timeout, allowing the existing 30-second API admission deadline to respond first.
- Disable the form fields/button and guard duplicate submissions while pending. Clear the delayed notice on completion/unmount. There is no automatic login replay.

Focused provider/classification tests, frontend type checking, build and session regressions passed. A separate backend fixture tested actual NextAuth HTTP responses for overload, throttling, invalid credentials, unavailability and a real 35-second timeout. Browser checks confirmed all three distinct error messages, the three-second pending notice, disabled controls, recovery after failure, and one request per double-click attempt. No production accounts were used.

Dependency scans stayed at zero known API/web/build CVEs against the retained vulnerability database. Public login/problem/contest/API checks returned 200. Preview services, local forwarding and temporary preview secrets were removed. Source synchronization and rollback override details are retained under `tmp/login-busy-20261026/evidence/` and `/opt/otog/login-busy-20261026/`. The preceding frontend release remains available for rollback.
