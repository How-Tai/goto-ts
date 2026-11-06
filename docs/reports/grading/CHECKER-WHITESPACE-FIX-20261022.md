# Standard checker trailing-whitespace fix — 22 October 2026

A disposable copy of the live grader reproduced a standard answer-checking stall
after a contestant process had already exited. Its output remained within the
existing 64 MiB output-file limit. The checker processed trailing blank lines
individually until the phase watchdog exited the worker at exactly 60 seconds.
The normal follow-up submission scored 100 after recovery. Protected files were
unchanged; no sandbox escape or file destruction was found in these tests.

The recovery probe also confirmed that recompilation preserves interrupted
evaluation attempts: attempts 1 → 2 during compilation → 1 after handoff → 2
on the next evaluation. The initial fixture incorrectly expected a reset;
that assertion was corrected after inspecting the actual accounting. No retry
accounting defect was found.

The standard checker now scans remaining text in bounded 64 KiB chunks once
the other stream reaches EOF. Existing trailing-whitespace acceptance remains;
non-whitespace tails still reject. Invalid contestant UTF-8 still rejects and
reference decoding failures still report an infrastructure error. The phase
watchdog remains enabled.

Validation included 3,000 seeded comparisons against the previous checker,
64 long-line/buffer-boundary comparisons and five encoding/mismatch cases.
The historical test-result label says 3133; the actual loop count is 3069,
and the fixture label was corrected without changing the assertions.
Additional approximately 64 MiB whitespace checks covered both streams and
space-only tails. All 19 adversarial integration cases completed without worker
restart and accepted normal follow-ups. These exercised deep directories,
4096-inode exhaustion, 256 MiB scratch exhaustion, stdout/stderr limits,
special-file output, permissions/symlinks, process creation, memory/time limits,
private paths, a blocked localhost connection and testcase state reset.
The localhost connection test is not a general proof of network isolation.

The former watchdog case now completes the worker and its healthy follow-up in
**1.115 seconds**, versus the earlier **60-second watchdog exit**
(61.715 seconds including recovery/follow-up and retry-counter probe).

Only `evaluate/verdict/standard.py` was changed on the six graders. Live hashes,
CPUs 0–5 and all sixteen grader/compiler heartbeats were verified. All ten compiler
slots remained ready and its container identity was unchanged. Worker enable
flags, settings, saved results and web/API identities were preserved. The VM
maintenance copy and local canonical checker match the tested deployment; the
previous checker and Compose configuration have backups.

Release/evidence: `/opt/otog/checker-whitespace-fix-20261022` and
`tmp/checker-whitespace-fix/evidence`. Original reproduction:
`/opt/otog/grader-adversarial-20261022`. All adversarial executions used a disposable
database and sandbox with production queue/problem files excluded.
