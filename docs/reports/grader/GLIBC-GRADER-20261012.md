# Deployed glibc grader — 12 October 2026

All six production graders were replaced together after pausing new claims and draining active work. Deployment completed at approximately 09:05 Asia/Bangkok. The existing VirtualBox VM remains in use. Windows security, VM CPU/RAM settings, problem limits, scoring rules, worker CPU affinity and worker controls were not changed.

## Deployed configuration

- Image tag: `otog-grader:glibc-20261012`.
- Immutable image ID: `sha256:4ab70ca67f21efdd78453c3e1e916737617dc8a202df6db474e6e7f07187961e`.
- Six workers enabled, assigned to virtual CPUs 0–5 as before.
- Current per-user worker cap: 6. The deployment did not modify this setting.
- GCC 14.2.0; C/C++ retain `-O2` and their existing language-standard flags.
- Grader Python remains 3.10.19; submitted Python remains 3.12.15.
- Sandbox remains enabled, cgroup mode remains false, grader time factor remains 1, and existing container CPU quotas/RAM caps remain unchanged.
- Live Compose file: `/home/otog/otog/docker-compose.vm.yml`, with only the six grader image references changed. This persists across normal VM startup. Local mirrors are `vm-setup/docker-compose.vm.yml` and `vm-setup/docker-compose.glibc.vm.yml`.
- `Dockerfile.glibc` provides the new build definition alongside the existing legacy Dockerfile. The deployed image was built from a copy of the actual running grader source and entry script; no environment/credential file was copied into it.

## Full sandbox speed measurements

The accepted Beautiful Number source from submission 176 was run through the actual sandbox, output checker and grading pipeline on three real testcase copies. Both environments scored 100 and matched every answer. A diagnostic 15-second limit allowed unrestricted completion; production problem limits were not altered. One comparison per environment was performed, so these measurements are not a guarantee under concurrent load.

| Original testcase | Previous CPU (ms) | New CPU (ms) | Reduction |
|---|---:|---:|---:|
| 49 | 4337 | 2929 | 32.5% |
| 54 | 3446 | 2894 | 16.0% |
| 64 | 4879 | 2872 | 41.1% |

- Total testcase CPU: 12.662 → 8.695 seconds (31.3% lower).
- Total grading wall time, including compilation/checking: 24.48 → 16.56 seconds (32.3% shorter).
- Peak memory on these cases was slightly lower on the candidate, approximately 123–124 MiB versus 129 MiB.
- The million-line simple `printf` fixture passed through the real sandbox/checker in two runs per image. Median CPU time was 195 → 122 ms, and median total grading time was 1.65 → 1.15 seconds.
- The earlier 19× result applies to the earlier mixed C++ stream/`freopen` benchmark. That setup differs from the actual sandbox output path; it must not be used as a claim that all submissions or all `printf` programs become 19× faster.

## Validation

- C, C++ and Python accepted solutions; wrong answers; C++/Python compile errors; runtime errors; CPU-limit termination; memory allocation rejection; inaccessible private files; trailing-whitespace checking.
- Synthetic partial checker accepted and 50% scores; the installed partial checker compiled on both environments and returned identical probe verdicts.
- All 18 database/worker tests passed in a disposable test database. They covered duplicate-job prevention, six concurrent claimers, per-user limits, pause/resume, restart recovery, scoring order, all scoring modes, rollback of failed score writes and rejudge queue timestamps.
- Six disposable workers completed six actual C++ jobs with six correct contest-score/history entries and no remaining leases. Six same-account jobs also passed with a configured cap of three in the test database. The live cap was left at its current value of six.
- No test submissions were inserted into the production queue and no historical submissions were rejudged.
- Fixture repairs during staging: read permissions for a restricted checker test, workspace initialization for the old-image speed test, and using the full existing queue-time migration rather than a column-only test stub. These were confined to disposable tests; no production source or schema repair was required.

## Final live checks

- All six containers use the new immutable image and have fresh worker registrations/heartbeats. All are enabled.
- API, website, nginx, ngrok and monitor active; PostgreSQL healthy; no diagnostic containers left running.
- Guest website HTTP 200, approximately 0.130 seconds; ngrok HTTP 200, approximately 0.371 seconds.
- About 2.5 GiB of guest RAM available and no swap used. The kernel-message filter found no soft lockup, RCU stall, OOM or I/O error in this boot.

## Rollback and storage

- Original immutable image retained as `otog-grader:musl-rollback-20261012` (`sha256:6bca3684f09e5f2ae0a174ec5ab024f9b049fa8183e18f320b61cdd543b74eb7`).
- Protected VM backup: `/home/otog/glibc-release-20261012/backup`, containing the original Compose configuration, enabled worker states and a pre-deployment database dump.
- The deployment script included automatic rollback if replacement health verification failed. Rollback was not required.
- For an image rollback, pause/drain work and restore the previous Compose image configuration. Do not restore an old database dump merely to undo the image switch: that could overwrite subsequent submissions.
- Downloads, images, test files and backups are on the VM disk stored on D. Nonsecret validation/activation evidence is archived in `vm-setup/glibc-release-evidence-20261012` on D. No large scheduler trace was created.

## Remaining limits

Gains depend on the program. Some input microbenchmarks were mixed, and CPU-only code did not show a consistent improvement. The tested reference remains close to its 3-second production time limit; behavior under heavy concurrent load is not guaranteed by this quiet comparison. This deployment improves tested library/input-output/allocation workloads but does not establish a fix for VirtualBox’s historical long stalls.

Build uses the [official Python images](https://hub.docker.com/_/python) with pinned interpreter versions. Runtime/compiler versions and all raw timing records are retained in the evidence folder.
