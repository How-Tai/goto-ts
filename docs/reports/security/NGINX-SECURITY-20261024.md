# nginx security upgrade — 24 October 2026

Upgraded the Ubuntu 24.04 VM from `1.24.0-2ubuntu7.18` to the official nginx
stable package `1.30.6-1~noble`. The upstream security advisories list 1.30.6
as fixed for CVE-2026-15176, CVE-2026-97205 and CVE-2026-93479:
https://nginx.org/en/security_advisories.html

The installed Ubuntu changelog did not contain these three fixes, and Ubuntu's
trackers still listed them as needing evaluation at the time of checking.
The official signed stable repository was configured for Noble, with scoped
APT preference for nginx packages. The vendor signing-key fingerprint was
checked against the official installation instructions. The package was
downloaded using signed APT metadata and its SHA-256 recorded.

Before installation, saved the old nginx/nginx-common packages, binary,
service unit and nginx configuration. The extracted new binary successfully
tested the existing configuration. APT's simulated transaction affected only
nginx and its nginx-common companion. Existing routes and configuration were
preserved, and the vendor default host was not enabled. nginx was restarted
to activate the new binary. Normal package restart policy was restored.

Verification passed:

- nginx configuration test and runtime version 1.30.6.
- All ten nginx master/worker/helper processes use the patched binary.
- nginx remains enabled at boot and retains its existing CPU restriction.
- Every original nginx configuration file retains its recorded hash.
- Login, contests, API ping, PDF delivery and Socket.IO polling handshake pass.
- Forwarded local site and public HTTPS login URL both return HTTP 200.
- Web/API/monitor/control/ngrok process identities and all six grader,
  PostgreSQL and MinIO container identities/start times remain unchanged.

Scripts and verification records: `tmp/nginx-security-20261024/`.
VM release records: `/opt/otog/nginx-security-20261024/`.
Configuration backups are restricted to its root-only `private/` directory;
old packages are retained under `rollback-packages/` for recovery.
