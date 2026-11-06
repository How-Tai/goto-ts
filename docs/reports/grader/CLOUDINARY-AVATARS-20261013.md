# Cloudinary profile pictures — 13 October 2026

Implemented and deployed for the user's own Cloudinary account. The private credential file remains `/home/otog/otog/apps/api/.env.cloudinary`, mode 600. A systemd API-only EnvironmentFile drop-in loads it. Values were never displayed in tool output or copied into website builds. Authentication initially failed until the user corrected the Cloud name; subsequent authentication and signed upload/delete checks passed. Public browser bundles were checked for absence of the API secret.

## Behavior

Users open their own Profile page from the top-right menu, choose Upload, crop the image, and Save picture. JPG/PNG up to 2 MiB and 20 megapixels are accepted. Controls are visible on touch devices as well as desktop. Cropping and progress/error messages are present. Removing a picture restores the generated fallback avatar.

Images are stored in Cloudinary, with bounded 640x640 JPEG normalization and stripped image profiles. Cloudinary delivers 32x32 optimized thumbnails directly to visitors. The VM stores only a small database reference per user, not user image files. Image bytes pass through bounded memory during authenticated upload.

`POST /user/avatar` and `DELETE /user/avatar` derive ownership from the authenticated user; they accept no target user ID. Public `GET /user/avatar/:id?size=default|small` returns a versioned Cloudinary URL or null. Multipart upload has a 2 MiB/one-file limit, image header/dimension validation, three concurrent operations maximum, a per-user 10-second change cooldown, and a bounded 60-second metadata cache. New uploads use unique asset IDs; the previous picture is retained until database commit, then cleaned up. Cloud/database failure paths are tested. Existing Firebase avatars are not migrated or modified because that account is not the user's.

A dedicated `otogUserAvatar` metadata table references the existing user table with cascading row deletion. Its migration and Prisma UserAvatar relation are recorded, and the staged Prisma schema validated. The existing Prisma client is used through parameterized SQL; no grader code or settings changed.

## Verification and deployment

- Actual API service regression tests: image validation, request signing, thumbnail URLs, cache behavior, cooldown/overlap, replacement, storage/database failures and asset cleanup.
- API and web TypeScript checks and production builds passed.
- Database and changed source backed up before activation; application rollback prepared. Only API/website services were briefly restarted.
- Live temporary-account tests rejected anonymous uploads/deletes, target-user routes, extra owner fields, invalid bytes, oversized files and rapid repeats. Full images and thumbnails loaded from Cloudinary.
- Browser verification caught an initial frontend request-builder error. It was corrected, with an HTTP regression test of the actual frontend helper proving correct multipart payload and POST/DELETE paths. A website-only deployment preserved API and all grader processes.
- Real browser crop/save succeeded afterward. The profile photo loaded at natural width 640 and navbar thumbnail at width 32, both from Cloudinary.
- Replacement and deletion were verified. The temporary diagnostic user, refresh tokens, generated Cloudinary images and temporary login files were removed, and the browser signed out.
- All six grader container identities/start times were unchanged during deployment. Final API, website, nginx, ngrok and monitoring services active; PostgreSQL healthy; website HTTP 200.

Initial release: 20261013-121144. Website request correction: 20261013-125601. Backups are on D under `vm-setup/cloudinary-avatars-backups` and `vm-setup/avatar-request-backups`. The screenshot of the temporary verification profile is `vm-setup/cloudinary-ui-test/profile-picture-verified.png`.

Keep the Cloudinary credential file private and outside Git. API key rotation can be done by editing that file and restarting only otog-api. Images count toward the user's Cloudinary plan. The feature does not switch the existing problem attachments or other Firebase configuration to Cloudinary.
