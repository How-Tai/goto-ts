# VM build cleanup — 14 October 2026

Removed 18 obsolete website build/cache directories after checking resolved paths, systemd references, Docker mounts, and running processes. Deletion stayed within `/home/otog/otog` and did not follow directory symlinks.

Retained the active website release `web-guest-access-20261014-141235`, the immediate previous rollback release `web-keyword-dialog-20261014-004810`, both standalone runtime trees, current source, dependencies, database/object storage, submission source, grader files, and diagnostic/source backups. Removed webpack caches from retained releases because they are not used to serve the standalone website.

Filesystem usage decreased by **5.97 GiB**, to **14.58 GiB used** and **41.16 GiB available**. Database record counts, container identities/start times and service start times were unchanged. Anonymous and authenticated public/hidden access checks passed, including PDF loading. All six graders remained running, without restart.

Inventory and verification archive: `D:\otog-grader\vm-setup\build-cleanup-record-20261014.tgz`. Deleted build outputs are not duplicated in this archive; the live and previous standalone releases are retained in the VM.

The dynamically allocated VDI file on D was not compacted. Free space inside Ubuntu is immediately reusable, but the Windows file size need not decrease automatically.
