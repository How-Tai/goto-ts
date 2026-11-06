# Stable worker button layout — 12 October 2026

Deployed fixed 7-rem widths for Pause/Resume and Kill, a fixed 14.5-rem action group aligned to the right, and a consistent minimum 5-rem worker row height. Longer pending labels no longer widen buttons or push nearby buttons sideways, and normal job-to-idle transitions retain row height.

Only `D:\otog\apps\web\src\pages\admin\grading.tsx` changed in the application. Immediate Kill, per-worker concurrency, duplicate-click protection and API restart behavior were preserved.

Typechecking and the isolated production website build passed. The initial staging script had Windows line endings and stopped before any production change; the scripts were normalized to Linux line endings and the build was started successfully. A Google font download retry then succeeded. Existing unrelated lint/module/Browserslist warnings were retained.

The new grading-page asset was retrieved over HTTP, matched the built asset's hash and included the fixed-dimension classes. The website returned HTTP 200. API startup timestamp and all six grader container IDs/start timestamps were unchanged during activation. No live Kill tests or grading changes were performed for this styling update.

Guest release: `/home/otog/otog/apps/web-worker-buttons-20261012-132139`.

Previous page/service configuration and verification copied to D: `D:\otog-grader\vm-setup\worker-buttons-backups\20261012-132139`. The previous web release remains available for rollback.

Refresh the grading-status page to load the stable button dimensions.
