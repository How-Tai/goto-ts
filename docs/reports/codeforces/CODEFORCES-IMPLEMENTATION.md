# Codeforces contest area

The catalog/library follow-up was deployed on 3 November 2026 and is documented in [CODEFORCES-CATALOG-20261102.md](CODEFORCES-CATALOG-20261102.md). The historical deployment record below describes the earlier release.

Authorized scope: separate `/codeforces` and `/admin/codeforces` pages; shared accounts, queue and hardened graders; input validators and trusted reference solutions; immutable problem bundles; pretests and final system tests; points-based standings; in-contest contestant hacks. Successful counterexamples become system tests. Existing classic contests retain their behavior. Custom checkers compile for each job, without a cross-submission cache.

Implementation contract:
- A CF contest extends an ordinary contest for existing authentication, membership, statements and queue priority. Its configuration, jobs, locks and hacks have separate tables.
- Authoring selects an independent CF problem, created in `/admin/codeforces/problems` or copied there from OTOG, and explicit ordered pretest/full-test lists. Supply a C++ input validator, trusted reference solution, and optional testlib-compatible checker. Publishing requires successful validation of every input and a successful reference run against every answer.
- Test data/helpers are copied into an immutable, private version under `source/.codeforces`. Participants cannot edit bundles or see validator/reference sources. No compiler or uploaded program executes in the API.
- All jobs use the existing durable submission queue, per-worker sandbox, limits and watchdogs. CF outcomes commit atomically with ordinary result persistence and lease release. Infrastructure errors remain distinguishable from rejected submissions/hacks.
- Pretest success is provisional. Scoring uses server receipt time, not verdict time. Configurable initial points, linear decay, wrong-attempt penalty and minimum fraction. Latest pretest-passing submission is selected; a hacked or system-failed selected submission does not fall back to an older passing submission.
- To hack, register, pass pretests on the problem and lock it. Locking prevents further submissions on that problem. Contestants in this initial shared-room format can view/hack other participants' eligible solutions only after locking. No cross-contest or self hacks.
- Accept hack requests only during `[timeStart,timeEnd)`, with bounded text input and queue capacity/rate limits. Validate input, generate expected output with the reference solution, then judge the target using the same checker and limits. Malformed input is an invalid hack; a failing validator/reference/checker infrastructure is not a successful hack. Changed targets produce an ignored hack. Unique hack records prevent duplicate scoring on retries.
- Successfully accepted hack inputs/answers are retained as system tests. Subsequent pretests for the affected participant also include successful counterexamples against that participant.
- After the contest and after queued contest/hack jobs finish, a durable coordinator queues selected submissions for full tests plus successful hacks. Completion is recomputed from persisted jobs, with retry/recovery and explicit admin controls. Final standings are not published while pending or infrastructure-failed jobs remain.
- Test permissions, boundary times, scoring, invalid inputs, checker failures, concurrent hacks/resubmissions, restart recovery, end-to-end disposable contests, and classic grading compatibility before deployment. Do not create production benchmark users/submissions or change existing contest schedules.

Status: deployed and verified on 31 October 2026. Frontend build `5URPgrgAuLZuS67HD-WZu`.

Entry points:
- Contestants: https://quaintly-decorated-congenial.ngrok-free.dev/codeforces
- Administrators: https://quaintly-decorated-congenial.ngrok-free.dev/admin/codeforces

UI separation requested after the initial rollout: the main desktop/mobile navbar is restored to its original links, with no CF entry. The CF area has its own header and navigation, without main-homepage/profile links. It remains accessible directly at the URLs above and uses the existing account login, API and graders. The follow-up frontend release is tracked under `tmp/cf-separate-ui-20261031`; this does not require database, API or grader changes.

The separation update was deployed on 1 November 2026 with frontend build `t6be8b1jP3XVbjl6kRjO5`. Type checking, production build, existing CF render checks, preview HTTP checks and public HTTPS checks passed. API PID and grader container IDs/restart counts were unchanged. Live frontend runtime: `/opt/otog/cf-separate-ui-20261031/workspace/apps/web/.next/standalone/apps/web`. The original CF release remains the API/worker source; do not rerun its historical frontend readiness checks expecting the old build ID.

To create a contest, create a future draft in the admin area, add independent CF problems from `/admin/codeforces/problems` with ordered pretest/full-test numbers, and supply a C++17 validator and reference solution for each problem. OTOG problems can be copied into that catalog first. An optional testlib-compatible checker can be supplied; leaving it blank uses the existing OTOG text comparison. Run validation, review the job results, then publish. Publishing freezes the problem bundles and configuration.

The deployed release supports batch problems, C++17 library tasks, manual counterexample inputs, and one shared hacking room. Generator submissions, interactive CF problems, room partitioning, and a rating algorithm remain unimplemented. Existing OTOG interactive problems continue through their existing grading path.

Verification passed:
- 23 disposable fixture jobs across 11 integration check groups: validators, reference solutions, pretests, checker compilation, invalid/unsuccessful/successful hacks, scoring, locks, source permissions, and final system testing.
- Recovery after disposable worker/API restarts, including a hack queued before the contest cutoff and completed afterward.
- Individual, all-problem, and numeric per-problem rejudges preserve hack decisions and repeat system testing; a hacked selected solution cannot fall back to an older passing submission.
- Ordinary batch compatibility, compiler exclusion for multi-stage CF jobs, snapshot limits, and memory reservation policy.
- Production API/frontend builds and type checks; 11 React rendering states; eight HTTP routes with real NextAuth admin/non-admin checks and static-asset checks.
- Live endpoints, seven worker heartbeats, unchanged sandbox/security settings, zero worker restarts/local OOM kills after rollout, and existing CPU allocation. Five workers remain enabled on CPUs 0–4; service CPUs remain 5–7. Custom checker caching remains disabled.

Browser control was disabled in Work settings, so visual browser inspection was unavailable. HTTP and server-render checks do not establish visual appearance or interactive browser behavior.

Operational records:
- Release: `/opt/otog/codeforces-20261031`; evidence: `tmp/codeforces-20261031/evidence` in this checkout.
- Migration `20261031030000_codeforces` must precede updated workers. The additive migration and runtime grants were applied before rolling workers one at a time; API/web switched after worker readiness.
- Release helper: `tmp/codeforces-20261031/release.py`; SSH wrapper: `tools/codeforces/run.py`. Review current state before rerunning historical deployment actions. Rollback refuses an incompatible old application/worker rollout once CF contests exist; it retains tables/data.
- VM and host maintenance checkouts were synchronized only for the relevant release files. Worker source changes preserve the existing sandbox and batch optimizations.
- Disposable databases, fixture accounts and temporary credential files were removed. Production schedules and submission data were not changed. Final free disk: 17.13 GiB; available memory: 4,552 MiB.
- Pinned testlib commit: `3bf5ba5aca6007bf8dcde6d00949ec3116ee3cc7`; SHA256 `9a291937129e77f093ec712c1f663a0eb28bfa9673fb43a53fec525c8f14a6c6`. The upstream license notice is retained in `tools/grading/cf-testlib.h`.

Rule alignment: invalid-input hacks do not lose points; only valid unsuccessful hacks incur the configured penalty. Equal total scores share a rank. Successfully hacked targets display Hacked and are not run again as eligible final solutions. Reference: https://codeforces.com/blog/entry/4088 .
