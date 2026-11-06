# Security remediation completed

The authorized security release is deployed and verified. No required implementation/deployment steps remain pending. See SECURITY-REMEDIATION-20261016.md for the complete result and remaining limits.

- Active root-owned runtime: /opt/otog/releases/security-20261016. API/web run as otog-api/otog-web without Docker membership. Root-read environment files are under /etc/otog; never print their contents. Systemd drop-ins: zz-security-20261016.conf.
- Restricted broker otog-worker-control permits sanitized inspect/fixed restart operations only for six configured graders. Human otog retains sudo/Docker access.
- Six graders use otog-grader:security-20261016 and otog_grader_runtime. API uses otog_api_runtime. Former shared DB administrator password rotated and retired value verified rejected. Original maintenance API/grader env files now use restricted roles.
- Queue/memory/keyword mounts, pause flags, stored results/policies, six workers, Tull max-one restriction and 1.5 GiB admission guard preserved.
- Patched source/lockfiles synchronized to /home/otog/otog and D. Services use the protected release, so editing the maintenance checkout does not automatically deploy changes.
- API/web builds, 58 chat checks, 29 HTTP checks including restricted-account protections, sandbox canaries, five full accepted-solution testcase sets, DB persistence/scoring permission checks and final localhost/ngrok probes passed. All six connected; monitoring fresh.
- Fixture DB otog_security_test_20261016 removed. Transient tests stopped; temporary live audit sessions removed. No production test accounts/submissions created.
- Private backup exists on VM and D; Windows ACL restricted and Git ignores it. Sanitized evidence: D:\otog-grader\vm-setup\security-patch-evidence-20261016.
- Release records: /home/otog/worker-setup/security-patch-20261016-051050. Marker security-patch-current-20261016.txt owned otog mode 0600.
- Legacy hashes migrate on login/reset; last check 25 SHA-256 / 1 scrypt. Privileged grader containers, trusted admin checkers and finite VM capacity remain material limits.
- Final API index SHA-256: 50fa5e837857e7d10743e191d780c1f450cac5fc7ff233412f1f36f5d86133de. dist.before-origin retains the preceding scrypt-compatible build. Never restore the old database or SHA-256-only authentication over live data.
- No Windows security or VM hardware changes. No subagents used. No tests or builds remain running at this checkpoint.
