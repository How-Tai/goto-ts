# Stronger grader CPU isolation — 31 October 2026

The existing allocator restricted ordinary userspace services, sessions and containers, but device interrupts and unbound kernel workqueues could still use grading CPUs. The initial audit found active AHCI disk interrupts on CPU 0, network interrupts on CPU 1, and a global unbound workqueue mask of `ff` (all eight guest CPUs).

The user's current selection is **five graders**. That selection was preserved: graders use CPUs **0–4**, while ordinary services use **5–7**. This change adds kernel housekeeping placement to the existing dynamic allocator.

## Implementation

- `tools/grader-allocation/kernel-affinity.py` applies the allocator's ordinary-service CPU list to the default IRQ mask, movable existing IRQs, and the global unbound-workqueue mask. For five graders the masks are **e0**, meaning CPUs 5–7.
- The helper runs before the allocator enables additional grading workers. The existing plan keeps busy retiring graders reserved until their jobs and scratch cleanup finish. New count selections and periodic reconciliation update kernel routing alongside existing userspace placement.
- `otog-kernel-affinity.service` initializes housekeeping on always-available CPU 7 before Docker on subsequent boots. The normal allocator expands that mask to the currently selected ordinary-service pool. It is enabled and ran successfully on the live VM; a VM reboot was not performed for testing.
- The allocator retains its service restrictions, with two explicit writable kernel paths added for IRQ and global workqueue configuration. The Docker ordering drop-in does not restart Docker. No sandbox capabilities, contestant/checker limits, native Isolate or grading code were changed.
- Unsupported IRQ changes are reported rather than silently treated as isolated. IRQ 0, the legacy timer, returned `EIO` and is left under kernel control. Some inactive device IRQs retain their previous effective destination until their next interrupt applies the pending request.

The kernel documents [IRQ routing controls](https://docs.kernel.org/core-api/irq/irq-affinity.html) and how the [global unbound-workqueue mask limits effective workqueue affinity](https://docs.kernel.org/core-api/workqueue.html). This uses live kernel interfaces and requires no grader or VM restart.

## Observed routing and validation

| Work | Before | After |
| --- | --- | --- |
| Network IRQ 19, enp0s3 | CPU 1 | CPU 5 |
| Disk IRQ 21, AHCI | CPU 0 | CPU 7 |
| ATA IRQ 14 | CPU 2 | CPU 6 |
| Global unbound-workqueue mask | CPUs 0–7 | CPUs 5–7 |

During the three-second post-change observation, **833 network interrupts** ran on CPU 5, **10 AHCI interrupts** on CPU 7, and **2 ATA interrupts** on CPU 6. No numbered device IRQ increments occurred on grading CPUs 0–4 in that sample. The pre-change audit used different traffic, so the counts do not establish a percentage reduction in load or jitter.

New unbound worker pools showed allowed CPUs 5–7. Older pools can remain visible with broader masks while old work drains and idle workers await reclamation. In a subsequent five-second sample, those older workers accumulated zero CPU time; the active sampled new worker used CPUs 5–7. This observation does not imply every kernel thread can be moved.

Policy tests covered all counts 1–7, non-contiguous ordinary pools during draining, fixed/pending IRQ behavior and eleven invalid-input cases. Existing allocator plan tests and Node syntax checks passed. The deployed allocator converged at **count 5, revision 66**, with zero allocator restarts after its intentional service restart and no allocation errors.

Two matched, paced HTTP smoke probes each issued 120 requests through the host's forwarded VM port, with at most six simultaneous requests. Both had **zero failures**:

| Route | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Login | 9.39 / 20.03 ms | 9.02 / 20.64 ms |
| API ping | 3.53 / 13.67 ms | 3.40 / 13.59 ms |

These are short availability/regression checks, not a contest load benchmark or proof of lower grading variance. Public HTTPS login and API ping also returned 200. All seven existing grader containers retained their IDs, PIDs and restart counts; the five selected workers remain pinned individually, and unselected workers remain in the ordinary pool. API, web, nginx and Docker PIDs were unchanged. No production submission, result, testcase or selected-count setting was modified.

## Remaining interference

This improves **guest** CPU isolation. Local timer interrupts, per-CPU kernel threads, cross-CPU synchronization and kernel work performed by grading itself remain. See the kernel's [OS-jitter guidance](https://docs.kernel.org/admin-guide/kernel-per-CPU-kthreads.html).

It does not reserve physical laptop cores from Windows or other host applications. Windows reports eight physical cores and sixteen logical processors, with SMT sibling pairs 0/1, 2/3, through 14/15. No host affinities or power settings were changed. The read-only thread-description query did not identify named VirtualBox vCPU threads, so no per-vCPU host mapping was inferred or modified. Host scheduling, shared caches/memory bandwidth and CPU frequency can still affect execution times. No claim of exclusive physical cores or elimination of runtime variance is made.

## Maintenance and recovery

Canonical sources are in `tools/grader-allocation/`. Live allocator/helper files are `/usr/local/lib/otog/grader-allocation.cjs` and `/usr/local/lib/otog/kernel-affinity.py`; the boot unit is `/etc/systemd/system/otog-kernel-affinity.service`. The allocation-service and Docker ordering drop-ins are installed under their respective `.service.d` directories. Kernel routing details appear in the allocator's loopback `/status` response; the existing dashboard needs no UI change for count selection to keep working.

Release and backups: `/opt/otog/kernel-isolation-20261031`. Remote helper: `/home/otog/kernel-isolation-candidate/release.py`. Local helpers and non-private evidence: `tmp/kernel-isolation-20261031`; audit/activity JSON is also under `tmp/timing-variance-20261031`. The automatic rollback timer protected deployment and was stopped after successful verification.

Manual rollback, as root: `python3 /home/otog/kernel-isolation-candidate/release.py rollback`. It checks that policy files still match this release or its baseline before changing them, restores the old allocator and kernel masks, removes only the new unit/drop-ins, and restarts the allocator. It does not restore dated grader counts, pause flags, Compose contents or verdicts. Inspect newer kernel-policy edits before using an old rollback.
