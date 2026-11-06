# Worker memory admission guard

Deployed 16 October 2026, 11:16:36 Asia/Bangkok (04:16:36 UTC).

All six graders now withhold new job claims when the Ubuntu VM has less than **1536 MiB (1.5 GiB)** available RAM. At or above this threshold, claims are allowed automatically. This uses the Linux kernel's fresh `MemAvailable` value, not the amount of completely unused RAM and not cached monitoring data.

Workers read `/proc/meminfo` directly. Deployment verified that their exposed `MemTotal` matches the VM (4,007,812 KiB), and available-memory samples correspond to the same guest kernel. Reclaimable file cache is included in the available-memory estimate.

## Behavior

- Check before querying/locking the submission queue and again immediately before changing a submission to grading and creating its lease.
- If either check refuses, the submission stays waiting. Claim locks are released and no lease is created.
- Existing jobs continue normally; result persistence and sandbox execution are unchanged.
- Workers remain connected/enabled, and manual pause settings remain authoritative.
- Existing LISTEN/NOTIFY wakeups and the five-second fallback retry naturally resume claims after memory recovers. Recovery does not require clicking Resume or restarting workers.
- Missing, malformed or unreadable memory data withholds claims until a valid reading returns.
- State changes are logged with a `MEMORY GUARD` prefix, without logging on every retry.
- The policy survives worker and VM restarts through the deployed bind-mounted source/configuration.

The guard is an admission check, not a memory reservation or a guaranteed 1.5 GiB floor. Jobs admitted above the threshold and other VM services can allocate more memory afterward; several workers may be admitted before those allocations occur. This reduces admission during low-memory periods without cancelling active submissions, but cannot guarantee prevention of every out-of-memory event. It does not measure Windows host RAM or change VirtualBox's assigned RAM.

## Implementation

- `src/memory_guard.py`: strict KiB parser, direct kernel reading, threshold/recovery decisions and transition logging.
- `src/worker_queue.py`: two small admission checks. FIFO, per-user limits, global problem limits, leases, recovery and result/contest-score persistence remain intact.
- All six compose worker services now mount the tested memory module and updated queue module read-only.
- No database migration or API/web code change was required.

## Verification

40 memory checks passed, covering exact threshold boundaries, below/above transitions, unavailable/corrupt readings, quiet retry logging, six simultaneous low-memory workers, automatic recovery, preserving active leases, an available-memory drop between candidate lookup and lease creation, lock release after refusal, and respecting manual pauses.

The 15 existing queue-control checks also passed against an isolated temporary PostgreSQL database, including 40 rounds of six concurrent claimers (240 claims), FIFO/user caps, the Tull cap, recovery and notifications. Low-memory tests supplied simulated readings to the actual queue implementation; no RAM-filling stress test was used on the live VM. The temporary database/container were removed afterward.

Deployment backed up the previous worker sources and compose file, paused new claims, drained active work and recreated only the six graders. Rollback inputs are retained. Original enabled flags were restored. Historical result/verdict/contest fingerprints, problem metadata/limits, per-user cap 6 and NPK Tull's global one-worker cap were unchanged. API, web, nginx, ngrok and monitor process start times were unchanged.

All six workers were verified running, with fresh heartbeats, six queue listeners, original CPU assignments 0–5 and `unless-stopped` restart policies. Available RAM after deployment was approximately 2608 MiB; swap used 0. Local website checks returned HTTP 200.

## Backups and evidence on D

- Before backup: `vm-setup/memory-guard-original-20261016.tgz`.
- Deployment/test evidence: `vm-setup/memory-guard-evidence-20261016.tgz`.
- Extracted evidence: `vm-setup/memory-guard-evidence-20261016/`.
- Runtime release: `/home/otog/worker-setup/memory-guard-<timestamp>/`, referenced by the guest compose file.
- Deployment/test/transport scripts: `vm-setup/*memory-guard*20261016*`.

Downloaded source hashes, before/after result fingerprints, service timestamps, grading policies and enabled flags were verified. No credentials or environment files are included in these archives.
