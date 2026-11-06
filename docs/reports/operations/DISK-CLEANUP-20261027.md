# VM disk cleanup — 27 October 2026

Recovered **21.38 GiB** by deleting 14 obsolete build/dependency/tool directories and six unused Docker image versions. Available space increased from **8.62 GiB to 30.00 GiB**; filesystem usage fell from **85% to 47%**.

Retained installations were checked for dependency links before deletion. Live process paths, open file handles, mapped libraries, effective service commands, environment paths, nginx paths, and all container bind mounts were protected. No service or container was restarted. Live immutable file hashes remained unchanged. Public HTTPS login/API ping and local login/problem/contest/API ping returned 200 afterward.

Kept the current frontend (`problem-shell-20261027/workspace`), frontend rollback (`page-render-efficiency-20261026/workspace`), API dependencies (`page-load-20261026/workspace`), original API working directory under `releases`, and the active Node runtime under `cve-remediation-20261025`. The audit cache was retained because another retained installation links to it. Application evidence, private backups, and source metadata remain.

Only obsolete `workspace` subdirectories were removed from release folders that also contain live grader files. **Do not delete `/opt/otog/performance-20261026` as a whole**: its `mainWorkers.py` is still mounted into the graders. Its obsolete app workspace was removed safely.

Three active Docker image versions and all eight containers remain. No database, document, source-upload, or container-volume data was removed. Final database counts: 33 users, 622 submissions and results, maximum submission ID 769. All six graders had current heartbeats.

Historical helpers may reference removed build workspaces for old build/replay operations; use the retained current frontend workspace as the base for new deployments. The shared contest-load recovery helper remains available and its SQL/runtime helpers do not require the removed workspaces.

Cleanup receipt and explicit removed-path/image lists: `tmp/disk-audit-20261027/evidence/cleanup-final.json`. Retention plan and dependency-link evidence are alongside it. The VM originals remain in `/opt/otog/disk-audit-20261027/`.

Follow-up after the announcement editor fix: the active frontend is now `announcement-editor-fix-20261027/workspace`, with `problem-shell-20261027/workspace` retained as its rollback. The older `page-render-efficiency-20261026/workspace` was removed after dependency checks, reclaiming 2.07 GiB and offsetting the new build. Available space remains approximately 30.0 GiB. See `ANNOUNCEMENT-EDITOR-FIX-20261027.md`.
# Retention after the 28 October startup release

The live frontend is now `/opt/otog/startup-efficiency-20261028/workspace`; the immediate rollback is `/opt/otog/announcement-editor-fix-20261027/workspace`. The superseded `/opt/otog/problem-shell-20261027/workspace` was removed after live process/service/container references and retained dependency symlinks were checked. Release evidence and helper sources were retained. The current API workspace, original API working directory, Node runtime and grader-mounted files remain protected.

This retirement reclaimed 2,225,106,944 bytes (about 2.07 GiB), offsetting the new build. Available disk is about 29.93 GiB, at 47% filesystem usage. Live file hashes, service PIDs, container identities/mounts/restarts and public/local health remained unchanged. Evidence: `tmp/disk-cleanup-startup-20261028/evidence/`.

