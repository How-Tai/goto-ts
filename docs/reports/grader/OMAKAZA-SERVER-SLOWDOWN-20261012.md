# Deeper server slowdown investigation — 12 October 2026

## What is established

The substantial extra time is in executing the submitted program's sorting work inside the VM. The actual answer-checking routine is small for this problem. It compared all 5,000 lines of a copied case-8 answer in approximately 1.9–3.0 ms in five runs. The implementation reads the contestant output and expected answer line by line; it does not sort either input string. The reported submission runtime is the maximum testcase program CPU time, excluding this answer comparison, compilation and queue waiting.

The original-code comparison established sorting at 234 ms of CPU time on Windows, 412–953 ms in the VM without isolate, and 421 ms in one real-sandbox diagnostic run. Frequency counting on the same full input took approximately 31–47 ms on Windows and 32–35 ms without isolate in the VM. Thus the slowdown is workload dependent, and the native VM variation is already present before the judge sandbox.

An additional diagnostic separated reading, counting and sorting. It read the case into memory once, then performed counting and sorting on copies of the same strings. Copy allocation occurs outside the measured sorting phase. This helps locate work, but differs from the submitted program's streaming execution and must not replace the original-code measurements.

| Phase | Windows elapsed seconds | First VM phase diagnostic elapsed seconds |
| --- | --- | --- |
| Read the full input | 0.0238 | 0.0385 |
| Frequency counting | 0.0062–0.0082 | 0.0084–0.0143 |
| Sorting alone | 0.2108–0.2157 | 0.3893–0.4498 |

During the scheduler capture, sorting-only elapsed samples were 0.9990, 0.5203 and 0.8487 seconds. A later run without the recorder again varied, at 0.7998, 0.4002 and 0.7291 seconds. The extra variation cannot be attributed solely to having the recorder enabled. Windows uses GCC 15.2 and the deployed VM image uses GCC 14.2; that remains a cross-platform comparison limitation, but compiler differences cannot explain changes between repeated runs of the same already-compiled VM binary.

## VirtualBox backend and configuration

The live VM has 8 virtual CPUs, 4,096 MiB RAM, a 100% CPU execution cap, host CPU profile, KVM paravirtualization and the `kvm-clock` guest clock source. The Windows VM process has normal priority, all sixteen logical processors allowed and no Windows process power-throttling mask enabled. Production workers retain guest CPU affinity 0–5; diagnostic work used spare guest CPU 6 at low priority.

The current VirtualBox log reports that direct AMD-V is unavailable, falls back to NEM, and explicitly logs `Snail execution mode is active` and that the VM cannot run at full potential in that mode. This confirms the current Hyper-V/Windows Hypervisor Platform compatibility backend. Oracle documents [poor performance when VirtualBox and Hyper-V share a host](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/Troubleshooting.html). This backend is the strongest identified explanation for additional virtualization overhead; these diagnostics do not constitute an A/B test proving its exact contribution to this program. Windows security features and backend settings were not changed.

## Scheduler capture and VM-exit counters

The user approved a bounded Windows scheduler capture. It used an 8 MiB circular buffer pool without stack sampling. Recording automatically stopped after approximately thirteen seconds; the final ETL is 9,568,256 bytes (9.13 MiB). Windows Performance Recorder is no longer recording. There is no permanent recorder or background diagnostic task.

Circular traces retain different time ranges for different processor buffers. A whole-trace analysis initially produced apparent multi-second VM-thread ready delays by bridging incomplete earlier ranges. Those figures are not evidence of a real multi-second stall and are excluded. The audit identified the first retained timestamps per CPU, and analysis was restricted to the 11,800–12,300 ms tail window, with fresh thread states at the window boundary.

In that 500 ms retained window, the CPU-6 VirtualBox thread (`EMT-6`) switched in 2,820 times, had about 126 ms of Windows-side thread runtime and 32 ms of recorded ready-queue delay. Its longest individual ready delay was about 0.476 ms. This establishes frequent scheduling transitions, while ordinary Windows ready-queue waiting accounts for only a limited part of this window. Windows thread runtime is not a direct measurement of all guest execution in Hyper-V, and Executive waits may include normal hypervisor execution. These observations do not prove that every off-CPU interval was harmful or identify one particular VirtualBox defect.

Read-only VirtualBox counters for CPU 6 showed about 533 exits/second over a two-second idle baseline. A diagnostic interval including container startup showed about 1,911 exits/second, including memory-access exits, canceled runs and interrupt-window exits. These counters indicate frequent virtualization work. They do not identify the offending guest instruction/address or isolate a sorting-only interval. The existing reviewed native-backend source shows memory-access exits can require page-mapping checks or memory-mapped device emulation, and that canceled/interrupt exits return to host-side handling; counter names alone do not prove which operation dominates.

## Other checks

- A host sample had 2,057 MiB available RAM, 69% committed memory and zero pages being read from disk per second. That sample does not support active host paging as the cause of this run. It does not rule out earlier memory pressure.
- Host CPU utilization was 23% and processor performance 70% in that sample. A single snapshot is insufficient to identify thermal or frequency throttling during each sorting phase.
- Production grader processes had seccomp mode 0, indirect-branch speculation always enabled, and the guest reported STIBP disabled. No forced branch-speculation restriction was found in those process flags.
- The latest inspected boot had no kernel lockup/OOM entries, and the production queue was empty at the runtime-flags check. All six grader containers, the API, website, nginx, ngrok and monitoring service were running at the final check.
- Two earlier identical frequency-array submissions had compilation-deadline errors. Compilation uses a separate deadline; it is excluded from the individual-testcase CPU measurement.

## Conclusion and limits

The bottleneck has been narrowed to slower, variable VM execution of the computational workload, with a confirmed compatibility backend that has a documented performance limitation. Input handling contributes a smaller part in the initial phase test, and answer checking is only a few milliseconds. Ordinary Windows ready-queue delay alone did not explain the full sorting gap in the retained trace window. The exact division between native-backend overhead, guest/host CPU accounting, CPU frequency, memory mapping and scheduling still cannot be claimed from these samples. A controlled alternate-backend/platform comparison would be needed to quantify that division.

No problem limits, verdicts, worker concurrency, Windows security, VM configuration or production grader code were changed. All temporary diagnostic containers exited and were removed. Evidence is on D in `vm-setup/omakaza-evidence-20261012/`, including host/VM measurements, the phase results, the small scheduler trace, its audit and the retained-window analysis.
