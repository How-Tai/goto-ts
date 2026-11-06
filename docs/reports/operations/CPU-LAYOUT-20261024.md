# Permanent CPU layout — 24 October 2026

Activated the user's requested placement:

| VM CPUs | Work |
|---|---|
| 0–4 | Five grading workers (IDs 1–5) |
| 5 | One compiler dispatcher, up to ten isolated concurrent jobs |
| 6–7 | Web, API, PostgreSQL, MinIO, nginx, ngrok, telemetry and worker-control |

OS and general host scheduling remain unrestricted. This is application CPU
affinity, not full kernel/interrupt isolation.

The compiler dispatcher and its single-threaded namespace launcher now read
`OTOG_COMPILER_CPU`, with CPU 6 retained as the backwards-compatible default.
The VM compiler service explicitly sets `OTOG_COMPILER_CPU=5` and cpuset 5.
An affinity/configuration mismatch fails before claiming work. Compiler slot
registration publishes CPU 5, so the existing dashboard labels update dynamically.

The `grader6` service was removed from the VM Compose file after draining leases
and memory reservations. Its container was stopped and removed; log mounts were
preserved. Its idle operational worker-state row was backed up and retired.
No submission, result or score rows were removed. The existing dashboard reads
the five configured workers and shows 5/5. Its worker-6 resume endpoint now returns
404 because that worker is no longer configured. No API/frontend rebuild was
needed. The per-user concurrency setting remains unchanged because it applies
jointly to compilation and evaluation, and still has meaning with ten compiler
slots and five graders.

PostgreSQL/MinIO cpusets 6–7 are saved in Compose and applied live without restarting
either container. Supporting systemd services use persistent AllowedCPUs=6–7
properties under /etc/systemd/system.control. Persistence, effective cgroup masks
and service thread affinities were verified after daemon reload; the telemetry
service was restarted and retained the correct placement. API/web processes and
the five existing grader containers were not restarted. The compiler alone was
recreated with the new source/configuration and all ten clean slots became ready.
Telemetry's retired-grader entry was removed; one-second sampling was preserved.

Validation: 12 isolated checks covering CPU-5 configuration, fallback CPU 6,
invalid CPU values, mismatched affinity, five-grader admission, ten simultaneous
compiler jobs plus an eleventh queued job, eleven real C++ AC results without
recompilation, warm-pool restart and interrupted-namespace recovery. All passed
with the diagnostic memory guard intact (minimum available 1,941,216 KiB).
Authenticated live dashboard verification confirmed five connected graders on
0–4, ten connected compiler slots on CPU 5, fresh telemetry and rejection of a
retired-worker resume request. Compiler job limit 10, reservation policy Off and
other settings were preserved. Saved-result/settings fingerprints were unchanged.

The first activation automatically rolled back because the verification probe
mistakenly counted its own command string as an unshare process. The probe was
corrected to match the executable argument exactly; tested production source did
not change. The next activation and postflight checks passed. Rollback backups
include the Compose file, original systemd property files, monitor source, worker
state/enable flags and maintenance source.

This deployment was not followed by a fresh full contest load test. Prior two-core
HTTP measurements remain in SITE-TWO-CORE-LOADTEST-20261024.md and were performed
with grading idle. Functional compilation/evaluation on CPU 5 was validated in
the isolated tests; no synthetic production submissions were created.

Release and evidence: `/opt/otog/cpu-layout-20261024` and
`tmp/cpu-layout-20261024/evidence`. Live Compose:
`/home/otog/otog/docker-compose.vm.yml`. Canonical compiler source and the VM
maintenance copies match the deployed source hashes.
