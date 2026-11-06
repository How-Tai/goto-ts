# Announcement editor placeholder fix — 27 October 2026

Live frontend build: `cJpolX-x0KGMTh0lyDiYF`, under `/opt/otog/announcement-editor-fix-20261027/workspace`.

The empty announcement editor rendered its custom placeholder with `{...props}` instead of `{...props.attributes}`. This dropped Slate's `data-slate-placeholder`, `contentEditable=false`, and DOM ref. Clicking back into the placeholder and typing a digit reproduced `Cannot resolve a DOM point from Slate point: {"path":[0,0],"offset":20}`, followed by Next's client-side exception screen.

The renderer now spreads the correct attributes and explicitly renders the placeholder children. Appearance and formatting remain the same. No dependencies, API code, grader settings, or production announcement contents were changed.

The regression test fails against the original renderer and passes with the fix. A real browser reproduced the original crash, then verified the fixed production build against a fake administrator/API: placeholder clicks followed by digits 1, 2 and 9; repeated clearing/re-entry; saving and reopening 9; clicking back into saved text and appending 123. The fixed editor displayed 9123 and recorded no browser errors. All saves were to the disposable in-memory API. The preview services and secret were removed afterward.

Production build/typecheck, session regressions, request-efficiency checks, viewer-query isolation, and static-layout privacy checks passed. The deployment preserved the API bundle, grader identities/restart counts and one notification listener. Public HTTPS and the live public problem page load correctly with no browser exceptions. Existing browser tabs need a refresh to load the corrected JavaScript.

To retain the disk savings, the older `page-render-efficiency-20261026/workspace` rollback was removed after dependency checks. The immediate prior `problem-shell-20261027/workspace` is now the frontend rollback. The active frontend, API workspace, original API working directory and Node runtime are retained. Available disk space remains about 30.0 GiB (47% used).

Evidence: `tmp/announcement-editor-fix-20261027/evidence/`, `before-browser-errors.json`, `browser-observation.json` and `fixed-editor.png`. Disk retention receipt: `/opt/otog/disk-cleanup-editor-20261027/cleanup-final.json` on the VM.
