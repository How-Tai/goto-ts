# Checker memory hardening, 17 October 2026

Deployed and verified on all six live graders. This closes two concrete memory-exhaustion weaknesses identified during the defensive review. No new submission-triggered worker crash was reproduced before this change.

## Changes

- Standard answer comparison retains bounded chunks instead of complete output lines. Small lines keep a fast path; long lines are scanned for their last non-whitespace character and compared in chunks. Existing UTF-8 handling, universal newlines, per-line `rstrip()` rules, trailing blank-line behavior and WA results are preserved. Reference-file errors remain administrative failures.
- C++, partial-score and Python custom-checker executions now inherit a hard 512 MiB `RLIMIT_AS` address-space limit. This is a per-process virtual-address-space bound, including libraries, rather than an aggregate RAM limit across child processes. The separate helper sets it before executing a checker; the parent worker, contestant limits, native Isolate operations and checker compilation are unchanged.
- A checker that fails under the limit yields Judge Error. It is not misreported as a contestant WA or TLE. The existing worker/container recovery mechanisms remain in place.

## Verification

- 425 old-versus-new comparison pairs covering Unicode, whitespace, EOF, CR/LF, chunk boundaries and long lines matched.
- Matching 48 MiB Unicode lines, trailing whitespace and a following line were accepted with 3,157,281 bytes of peak traced Python allocation during comparison (about 3 MiB; not total process/container RSS).
- A test checker could not allocate 600 MiB under the 512 MiB cap. Full judging reported Judge Error, then accepted a normal job in the same process.
- 14 ordinary pipeline checks, 24 expanded pipeline checks, 19 watchdog checks and 16 actual-main-loop checks passed.
- All three installed custom checker sources (problems 1, 44 and 48) passed accepted/wrong/malformed-output protocol fixtures: 9 checks. Accepted reference submissions were unavailable for every checker problem, so these fixtures supplement the reference runs rather than being described as accepted-solution runs.
- Five stored accepted reference solutions (problems 48, 52, 53, 54 and 56) retained full scores against current testcase data. All reference runs were offline and did not modify production submissions or results.

## Deployment and rollback

Release: `/opt/otog/checker-hardening-20261017/`.

Only five read-only source mounts changed: `grader_safety.py`, `evaluate/verdict/standard.py`, `cppCheck.py`, `thaco.py` and `ogogi.py`. The other source mounts and the patched Isolate binary remain from the depth-cleanup release. The Docker image identity, six-worker count, CPU assignments, memory limits, restart policies, private tmpfs and 4,096-inode cap are unchanged.

New claims were paused while active jobs drained. The six grader containers were replaced, code hashes and mounts verified, and original enabled states restored. Stored result/policy fingerprints were unchanged and web services were not restarted. Final checks found six enabled workers with fresh heartbeats, no active jobs or retry rows, and HTTP 200 from localhost and ngrok.

`compose.before.yml` in this release is the rollback configuration. It retains the previous directory-depth fix and inode cap. A rollback should drain jobs before recreating the six grader services; restoring the database is not needed for this code-only change.

Raw evidence on drive D: `vm-setup/checker-hardening-evidence-20261017/tests.json`, `deployment.json`, and individual test logs. No credentials or reference solution fixtures were exported.

## Limits of the fix

This is not a proof that workers cannot crash. A trusted checker that deliberately forks multiple memory-consuming children is still subject to the existing container-wide memory/process limits rather than a new checker-only aggregate cgroup. The 4,096-inode quota does not count every hard-link name as a separate inode; byte, process and time limits still apply. A whole-VM/kernel scheduling failure remains outside an in-process watchdog's ability to recover. Those are distinct issues; this release does not claim to solve them.
