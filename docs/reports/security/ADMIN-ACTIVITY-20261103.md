# Admin activity visibility

Admin submission history, solved problems, submission details/source/progress and contest score history are readable by the account owner and other administrators. Public basic profiles remain available, with admin rated-contest history omitted for other viewers. CF submission/source lists and hack targets apply the same admin activity restriction. Existing public contest standings already exclude admin accounts.

The API enforces these rules for direct requests as well as the profile UI. Viewer-dependent responses use private, no-store cache headers. Unauthorized activity requests return 404, while collection requests omit inaccessible admin records. Normal problem and contest access rules remain in force.

The existing leaderboard preference controls ranking visibility only. An ordinary user's submission and solved-problem activity remains public under the existing access rules when they disable leaderboard visibility. The profile explanation makes this explicit. No separate activity preference or database field was added.

Verification: local API and web TypeScript checks passed. The deployment candidate adds HTTP/PostgreSQL regression coverage for guests, ordinary users, the admin owner and another admin, guessed IDs, explicitly shared source, batch progress, contest history, role changes, CF source/list/hack access, and both leaderboard preference states. These fixtures run only in the disposable `otog_cf_catalog_test` database.

Deployed and verified on 4 November 2026. Release: `/opt/otog/admin-activity-20261103/workspace`; web build: `SoIouOPtARZP6K53e9fz0`; API SHA-256: `d37fe5c67224e5081ad52d69876dffc7b72a53d76390df7589466f95b9571de8`.

All four integration suites passed: 15 HTTP/PostgreSQL check groups (including five new privacy groups), five security regression groups, 15 React server-render checks and four built-page smoke checks. No browser visual inspection was performed. The first privacy fixture run used an incorrect profile URL; correcting it to `/user/:id/profile` made the full run pass.

Both reported admin activity URLs now return 404 anonymously through public HTTPS. Direct admin submission metadata, source and progress also return 404. Basic admin profile remains 200 without rated-contest history; ordinary users' submission/solved-problem endpoints remain 200. Live API/page checks and the public build-ID check passed. Grader container identities/restart counts, allocation, grading settings, account roles and leaderboard preferences were unchanged. There was no schema migration, grader restart or rejudge. Candidate build cache was removed after verification; VM free disk was 17.58 GiB.

Source changes accompany this deployment record in `How-Tai/goto`.
