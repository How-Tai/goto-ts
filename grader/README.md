# OTOG hardened graders

Run on a Linux host with cgroup v2, Docker's default seccomp profile, and AppArmor enforcing. Each container has one worker, private sandbox/cgroup namespaces, bounded scratch, memory and PIDs. Testcases are read-only. Do not use privileged mode, host PID/cgroup namespaces, the Docker socket, or unconfined profiles.

1. Apply the application migrations, including CF tables, before starting current workers. Set up a least-privilege grader database account.
2. Copy `.env.template` to `.env`, supply private database credentials, and ensure `../apps/api/source` contains the immutable problem bundles.
3. Install the profile: `sudo install -m0644 deployment/otog-grader.apparmor /etc/apparmor.d/otog-grader && sudo apparmor_parser -r /etc/apparmor.d/otog-grader`.
4. Build: `docker compose -f docker-compose.prod.yml build`.
5. Validate: `python3 deployment/verify-deployment.py`. Optionally render 1–7 workers with `python3 deployment/render-workers.py --workers 6`; keep the output beside the base file.
6. Start a fresh installation with `docker compose -f docker-compose.prod.yml up -d`. For existing installations, drain each worker before recreating it and preserve admin pause/allocation settings. This file does not configure host service/IRQ CPU affinity.

The build pins official Isolate 2.7 commit `8f185bb37f3f23e29b33b0c7727c91c13429abe3` and applies `deployment/isolate-2.7-hardened.patch`, preserving memory-only cgroup accounting, CPU timing and descriptor-bounded cleanup. Both Dockerfiles build the same reviewed implementation. The enforcing profile and resource policy are mandatory; startup fails on incompatible hosts.

The historical privileged local/test/mod-balance/HTTP-sync Compose modes, privileged worker test scripts, and unpinned `installIsolate.sh` are retired. Use disposable containers with the production containment policy for regression testing; do not point their worker process at a production database. CI builds this image and runs container/checker tests with dummy settings. Custom checkers compile for each job; they are not cached across submissions.

## VM CPU resizing

The VM allocator caps the active grader count at the configured count or the number of online CPUs minus one, whichever is lower. A one-CPU VM leaves submissions queued.

For the existing seven-container VM layout, install `kernel-affinity.py` and `prepare-cpus.py` from [the allocator tools](../tools/grader-allocation/) in `/usr/local/lib/otog/`. Install their systemd units as `otog-kernel-affinity.service` and `otog-prepare-cpus.service`, add `prepare-cpus.conf` as a drop-in for the allocator and API services, and enable `otog-prepare-cpus.service`. The boot unit repairs saved CPU masks before the allocator starts.

## Development reports

Historical grader audits, benchmarks, and deployment notes are indexed in [grader reports](../docs/reports/grader/README.md).
