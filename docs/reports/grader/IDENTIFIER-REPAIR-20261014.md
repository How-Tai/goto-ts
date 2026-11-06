# Identifier repair — 14 October 2026

Production database audited and repaired:

| Entity | Current IDs | Next ID |
| --- | --- | --- |
| Users | 1–19 | 20 |
| Contests | 1 | 2 |
| Problems | 1–33 | 34 |

The only account mapping was user 22 → 19. User references were updated through foreign-key cascades, including avatar ownership. No users, submissions, scores, contests, problems, or images were deleted. Record counts and normalized record fingerprints matched before and after the transaction. Contest and problem IDs already had no gaps; their creation sequences were reset.

Old login tokens were revoked and login signing keys rotated privately to prevent old numeric identities from being reused. Everyone must sign in again. Passwords and Cloudinary credentials were unchanged. An old token was verified to return 401, and the renumbered account profile was verified successfully with a new token.

New grading claims were briefly paused while existing jobs finished. Original worker enable flags were restored. All six grader container identities and start times remained unchanged. API, web, nginx, ngrok and monitoring services were verified active; the website returned successfully.

The initial verification encountered an API startup readiness race. No migration was repeated. Verification was rerun after waiting for API readiness and passed.

Database backup and verification evidence: `D:\otog-grader\vm-setup\identifier-repair-backup-20261014.tgz`. Private environment backups and signing keys remain only in the restricted VM backup directory `/home/otog/identifier-repair-backups/`; they are excluded from this archive.

Database IDs are identities, so future deletions or failed inserts can create valid gaps. This repair does not introduce automatic renumbering after each deletion.
