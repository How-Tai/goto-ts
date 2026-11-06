# Directory-depth cleanup correction — 17 October 2026

> Current mount policy: the subsequently deployed [4,096-inode cap](INODE-CAP-4096-20261017.md) bounds directory growth independently of time limits. Native/source files described here remain active. Use the cap report for the current compose rollback.

Deployed and verified on all six graders. This fixes the reproduced deep-directory traversal failure. The separate, unreproduced reference-631 runtime-error incident remains unexplained.

## Cause and correction

The pinned Isolate revision is `b5e87ec10c5c83830b0ab4b9d908437e4c14e426` (2.1.2). Its `util.c` recursively walks directories while retaining one directory stream per nesting level. A finite C++ program creating 1,100 directories exited successfully, but Isolate's ownership pass returned `status:XX` and `Cannot open directory d: Too many open files`. This was reproduced in a disposable container with reserved sandbox ID 20.

Isolate now uses an explicit heap stack and closes each parent stream before descending, keeping a bounded number of traversal descriptors. Parent directories are reopened component by component; Linux directory cookies resume enumeration on the deployed tmpfs. Device/inode checks verify directory transitions. Existing `O_NOFOLLOW`/`AT_SYMLINK_NOFOLLOW` protections and post-order ownership/removal callbacks remain in place.

Python's fd-safe `shutil.rmtree` also uses recursion. It remains the normal fast path. Recursion-limit, descriptor-limit and overlong-path failures fall back to coreutils `/bin/rm -rf --one-file-system -- <exact-private-path>`, bounded to 20 seconds by the existing infrastructure helper. Only the configured sandbox box and root-owned baseline are accepted; symlink roots/parents are rejected. Other filesystem errors still propagate into recovery.

The native patch is retained at `deployment/isolate-depth-20261017.patch`. LF endings are enforced, and `Dockerfile.glibc` checks/applies it against the pinned upstream source for future builds. Patch application was verified against the pristine pinned source.

## Validation

All tests used disposable sandbox 20, separate from live IDs 1–6, with no production result writes:

- Old binary reproduced the native depth failure.
- Ten grading scenarios passed: finite C++/Python 1,100-level trees, C++ depth 5,000, 1,200 components of length 200, branching trees, symlinks/FIFOs, private temporary paths, a 32-descriptor limit, TLEs with deep trees, and subsequent healthy C++/Python submissions. These completed correctly in the same process without restarting.
- Three native checks passed: 4,900 initially foreign-owned files all received expected ownership; external symlink canaries stayed unchanged and special files were removed; native cleanup fully removed wide and 6,000-level trees under a 32-descriptor limit.
- Six cleanup-target/fallback guard tests, 19 infrastructure/watchdog/retry tests, 14 verdict/custom-checker tests, 24 expanded C/C++/Python/subtask/Codeforces checks, and 17 filesystem-isolation checks passed.
- Five accepted references (problems 48, 52, 53, 54, 56) remained accepted.
- Alternating small-tree cleanup samples: previous median 0.148 ms, candidate median 0.285 ms, **0.137 ms additional cleanup overhead**. A separate 30-sample test measured ordinary reset median 1.322 ms and testcase-with-reset median 13.522 ms. These are isolated examples, not universal performance bounds. Cleanup is outside contestant CPU time.

## Deployment

- Active source: `/opt/otog/grader-depth-cleanup-20261017/source/`, with 12 read-only module mounts. Only `sandbox_security.py` changed from the preceding runtime-diagnostics bundle.
- Active native binary: `/opt/otog/grader-depth-cleanup-20261017/isolate/isolate`, read-only at `/usr/local/bin/isolate` in each grader.
- Native SHA-256: `977336451a55eb945b2580915899917605597f73e8bca651833ae1692afce906`.
- Sandbox module SHA-256: `dfe64e8fc3ccca8989e55bfd500b0be0766cf565b2032a15135234f954855d02`.
- Image identity remains `otog-grader:security-20261016`, preserving the worker-control whitelist.

New claims were paused, active leases drained and only the six graders recreated. Result/score/policy/retry fingerprints, image, CPU affinity, memory/swap/process/tmpfs limits and restart policies were preserved. Website/control services were not restarted. Enabled flags were restored conditionally to respect concurrent administrator changes. Existing stage watchdogs, durable retry limits and bounded private runtime diagnostics remain unchanged.

Post-deployment: all six graders enabled with fresh heartbeats, no active leases, retry table empty; localhost and ngrok returned HTTP 200. Local compose maintenance copy synchronized.

Evidence: `vm-setup/depth-cleanup-evidence-20261017/`, including source/native hashes, original failure metadata, test logs and deployment verification.

## Rollback and limits

Follow-up maximum-speed depth test: an unbounded C++ `mkdir("d")`/`chdir("d")` loop ran under the configured 1,000 ms testcase limit in disposable sandbox 20. It reached depths **112,603** and **114,004** in two cases; native metadata recorded CPU times 1.099/1.096 seconds and ordinary `status:TO`. Both cases received TLE (`TT`), and the next normal C++ submission received AC on both cases (`PP`) in the same grader process, without restart. Very large-tree cleanup took several seconds. This diagnostic also counted each tree after execution, adding observation overhead to overall test-job elapsed time; total diagnostic duration should not be presented as pure production grading cost. Evidence: `vm-setup/depth-until-limit-evidence-20261017/`. The probe container was removed and no live submissions or settings were changed.

Previous compose: `/opt/otog/grader-depth-cleanup-20261017/compose.before.yml`. Original native binary retained as `isolate.before`; preceding source release unchanged. Rollback should pause/drain workers, restore compose and recreate only the six grader services. No database restore is needed for code rollback.

Very large trees can still exhaust bounded time, memory, inodes or storage. Kernel/VM hangs remain outside this fix. Unexpected cleanup failures retain container restart recovery as a fallback. Contestant limits and scoring were not changed.
