# Contest C++ reference link — 24 October 2026

The live contest sidebar used NEXT_PUBLIC_CPP_REF_LINK compiled as
`http://localhost:4000/reference/en/`. Three previous client bundles contained
that development value. No reference mirror was hosted at that address on the VM.

Corrected the public URL to `https://en.cppreference.com/` in local development,
production and template defaults, and in the VM frontend build environment.
Rebuilt into `.next-cpp-reference-20261024` with an explicit production URL.
The build ran in an isolated low-priority scope on CPU 7 with bounded RAM/swap
and the 1536 MiB global available-memory guard. It completed in 203.36 seconds,
with minimum available memory 1,744,696 KiB. No TypeScript code changed; existing
frontend build settings skip repeated lint/typechecking in the constrained VM.

Validated the new client bundles contain the correct URL and omit the obsolete
reference URL. Switched only the web service, preserving older hashed assets for
open tabs. Confirmed the new build ID over HTTP, fetched its new client chunk,
and parsed the rendered C++ Reference anchor on contest 2: its href is the public
cppreference URL. Existing browser tabs need a full refresh to load the new build.

The first activation rolled back because a later existing systemd drop-in still
selected the previous frontend. Corrected override priority and verified the
effective WorkingDirectory before restarting. The successful deployment uses
`zzzzzzzzzzz-cpp-reference-20261024.conf` and retains rollback access to the old
build. API, graders, compiler, PostgreSQL and MinIO identities/restart counts were
unchanged. Saved-result and grading-setting fingerprints were unchanged. The web
service retained its permanent CPU 6–7 placement.

Evidence: `tmp/cpp-reference-20261024/evidence` and
`/opt/otog/cpp-reference-20261024`. Secret-containing source environment backups
remain private on the VM and were not copied into evidence.
