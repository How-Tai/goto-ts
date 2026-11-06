# Profile-picture investigation — 13 October 2026

Investigation only: no application source changes, deployment, upload, account changes or grader restarts were performed.

## Confirmed findings

- The existing profile page has upload, crop and delete controls shown only to its owner. Controls become visible on hover. JPG/JPEG/PNG are accepted; the client converts pictures to JPEG.
- Uploads go directly from the browser to Firebase Storage at images/<local user ID>.jpeg. The API has no avatar upload endpoint. Production configuration has offline mode false and Firebase bucket otog-60cff.appspot.com. This is external storage, not the VM's disk or its MinIO service.
- A read-only metadata GET for images/1.jpeg on that configured Firebase bucket returned HTTP 402. Firebase's response says the owning project's billing account is disabled in state closed. No image metadata or download tokens were printed and no write request was attempted. This confirms the configured storage currently cannot serve that avatar request; an upload was not attempted.
- No Firebase authentication integration was found in the checked web/API authentication code. Local OTOG authentication alone does not establish Firebase identity; bucket rules/ownership must be checked if retaining Firebase. No remote rules were inspected, and no claim of publicly writable storage is made.
- Smaller avatars request images/<ID>_32.jpeg, but the clone's upload code writes only the original JPEG. No matching thumbnail generation implementation was found in this repository. An external Firebase function may have supplied it on the original deployment; its existence/running state was not verified.
- Upload failures are logged to the browser console without a visible failure toast. There is no configured input file-size cap in the uploader. Initial client resizing targets a 640-pixel short side and preserves aspect ratio, so extreme aspect ratios can still create large canvases.

## Suggested implementation for this VM

Use an authenticated OTOG API endpoint and dedicated avatar storage on the VM/D-backed disk (or its existing MinIO). Derive ownership from the signed-in session, validate byte size/type/dimensions server-side, decode and re-encode to bounded JPEG/WebP dimensions, create both full and thumbnail images, and serve them through the existing localhost/ngrok origin. Include visible progress/errors, replacement/delete handling and cache versioning. Keep generated fallback avatars for users without pictures. This avoids depending on the inherited Firebase project or sharing its numeric user-ID namespace.

Relevant source: apps/web/src/components/avatar-upload.tsx, apps/web/src/firebase/get-avatar-url.ts, apps/web/src/firebase/index.ts, apps/web/src/pages/user/[userId].tsx and apps/web/src/components/user-avatar.tsx.

Firebase references: [Storage error handling](https://firebase.google.com/docs/storage/web/handle-errors), [Storage security rules](https://firebase.google.com/docs/storage/security/get-started).
