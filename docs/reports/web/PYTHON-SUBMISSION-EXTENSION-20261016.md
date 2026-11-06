# Python editor filename fix — deployed 16 October 2026

The editor used the language identifier as the filename extension. Selecting Python produced names such as `66.python`, while the API permits `.py`. The API rejected the filename and the frontend displayed the generic Thai submission-failure message. Python is a supported language; this was an editor filename mismatch.

Added `LanguageExtension` alongside the existing language identifiers and display names: `cpp → cpp`, `c → c`, `python → py`. The problem editor, contest problem editor and contest task-card editor now use this shared map for generated file names. The submission's language identifier remains `python`. Manual file uploads retain their original filenames.

## Verification

- Frontend typecheck and production build passed.
- Actual generated multipart filenames were checked against the deployed API's pure file filter: `.cpp`, `.c` and `.py` accepted; Python generated as `66.py`.
- The preview ran under the restricted `otog-web` account; pages, static assets, login and the CSRF endpoint loaded.
- The live release build ID was verified after activation. Home, login, public problem 66 and CSRF endpoints returned 200 on localhost and ngrok.
- All grader container identities/start times and all backend/control-service process identities remained unchanged during deployment.
- No test submissions or accounts were created. No failure payload was submitted to the live judge.
- The transient build workspace was removed after retaining the four changed sources and build/typecheck logs. All local archives and reports are on D.

## Current deployment

Web runtime: `/opt/otog/releases/python-extension-20261016/apps/web`

Build ID: `hUYzqZctuAz4RFvP-HBZQ`

Web-only override: `/etc/systemd/system/otog-web.service.d/zzz-python-extension-20261016.conf`. It changes the working directory and executable path, inheriting the existing restricted user, private environment and service hardening. The API runtime remains under `/opt/otog/releases/security-20261016/apps/api`; the six graders retain their v2 filesystem-reset overrides.

Rollback: remove only the new `zzz-python-extension-20261016.conf` override, reload systemd and restart `otog-web`. The old runtime is intact. Do not restore a database backup for this frontend change. Old hashed static assets were retained in the new release for clients open during the update.

The human maintenance checkout under `/home/otog/otog` contains the four patched sources. Future frontend builds must include those sources; the older security runtime's source remains unchanged for rollback.

Evidence: `D:/otog-grader/vm-setup/python-extension-evidence-20261016/filename-validation.json`, `preview-validation.json`, and `deployment.json`.

## Separate worker cleanup issue

This deployment fixes only the Python editor extension. The confirmed deeply nested-directory cleanup vulnerability remains unpatched. The worker Kill control restarts its container, whose temporary Isolate filesystem is removed when stopped; that provides recovery, not prevention. [Docker tmpfs documentation](https://docs.docker.com/engine/storage/tmpfs/).

A permanent solution still needs bounded cleanup and controlled worker recovery that does not endlessly retry the same offending submission. Details and isolated reproduction results are in `D:/otog-grader/WORKER-AVAILABILITY-FINDINGS-20261016.md`.
