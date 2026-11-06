# Admin profile-picture controls

Deployed release: `20261013-133842`.

Admins can open another user's profile and upload, crop, or remove their Cloudinary profile picture. Removing it restores the generated avatar. Regular users retain controls only for their own picture.

The target-user POST and DELETE routes require the admin role on the server, validate the ID, and check that the account exists before touching cloud storage. Existing file limits, image conversion, per-user cooldown, operation locking, thumbnail delivery and cache invalidation are retained. No database migration was needed.

Verification passed:

- API and web type checks and production builds.
- Existing image-service regression checks, plus missing-account rejection.
- Actual frontend HTTP helpers for self and target-user upload/deletion.
- Live anonymous denial (401), regular-user denial (403), missing accounts (404), invalid IDs (400), self upload, admin replacement/removal and Cloudinary delivery.
- Browser: temporary admin could edit another user's generated test picture; save completed and removal dialog appeared correctly.
- All six grader identities and start times were unchanged during deployment. Final service checks passed and the website returned HTTP 200.

Only temporary diagnostic accounts and generated fixtures were used; their accounts, pictures and login files were removed after verification.

Backups: `D:\otog-grader\vm-setup\admin-avatars-backups\20261013-133842` (previous source, database snapshot, web service configuration, tests and grader comparison). Cloudinary credentials were not copied into the backup.

Browser proof: `D:\otog-grader\vm-setup\admin-avatar-ui-test\admin-controls-verified.png`.
