# Six independent graders — 24 October 2026

Latest update 30 October: the selected 1–7 grader count now dynamically assigns CPUs 0 through N−1 to grading, with remaining CPUs available for ordinary services. Inactive grader rows are hidden after draining. See [DYNAMIC-GRADER-CPUS-20261030.md](DYNAMIC-GRADER-CPUS-20261030.md).

Update 30 October: `/admin/grading/` now selects 1–7 active independent graders on CPUs 0–6, with ordinary services on CPU 7. The initial count remains six. See [GRADER-COUNT-20261030.md](GRADER-COUNT-20261030.md). This supersedes the fixed six-worker CPU allocation below.

Update 30 October: ordinary services and login sessions are now restricted to CPUs 6–7 through a persistent service default and user-slice policy. The six grader cores remain 0–5. This does not isolate kernel/interrupt work. See [SERVICE-CPU-PLACEMENT-20261030.md](../operations/SERVICE-CPU-PLACEMENT-20261030.md) for verification, measured tradeoffs and rollback instructions.

Deployed and verified on the VM. Each worker claims a submission, compiles it,
and evaluates it itself. The separate compiler service has been removed.

| CPUs | Allocation |
| --- | --- |
| 0–5 | Six graders, one per CPU |
| 6–7 | Web, API, database and supporting services |

All six workers use `OTOG_COMPILE_PIPELINE=0`, `OTOG_DEDICATED_COMPILER=0`,
and `OTOG_STRICT_COMPILE_BUDGET=1`. The existing 384 MiB compiler address-space
limit and strict compilation policy remain enforced. Idle direct workers now
use the inexpensive empty-queue check before loading grading metadata.

The dashboard shows six combined compilation/grading workers and hides the
separate compilation panel and compiler concurrency selector. One-second
refresh, the memory reservation toggle, and worker controls remain available.
The current per-user concurrency limit remains **5**; memory reservations
remain **off**. Existing results and settings were checked against the
pre-deployment snapshot. The public C++ reference link is preserved.

## Validation

- Twelve isolated checks passed, including six simultaneous C++ submissions
  compiled and evaluated by their respective workers, all accepted.
- C++, Python, compile errors, interrupted-job recovery, retry limits,
  per-user/problem limits, and optional memory reservations passed.
- Web TypeScript checking and the production build passed.
- Live checks confirmed six enabled workers on CPUs 0–5, no compiler service,
  fresh dashboard telemetry, and supporting services on CPUs 6–7.
- Tests created no production submissions. This was a functional concurrency
  check; no numerical throughput improvement is claimed.

## Configuration and recovery records

Local deployment evidence and the resulting Compose/monitor configuration:
`tmp/independent-graders-20261024/evidence/`.

VM deployment and pre-deployment backups:
`/opt/otog/independent-graders-20261024/`.
This includes the prior Compose file, monitor source, control states,
settings, artifact metadata/binaries and maintenance source backups.
Frontend build/deployment records:
`/opt/otog/independent-graders-web-20261024/`.

Canonical grader source changes are synchronized in `D:/otog-grader/src/`.
Their previous versions are saved under
`D:/otog-grader/vm-setup/independent-graders-before-20261024/`.

Recovery must pause admission and drain active work before restoring the
previous Compose and control state. The deployment script contains the
failure rollback sequence for reference. Avoid replaying stale worker flags
or artifact metadata over newly queued work.
