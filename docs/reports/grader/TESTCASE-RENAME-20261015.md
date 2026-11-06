# Testcase filename correction — 15 October 2026

Renamed testcase files for problems 36 and 39–45, preserving their original numeric input/output pairing:

- Problem 36: `testcase_01.in/.sol` through `testcase_10.in/.sol` → `1.in/.sol` through `10.in/.sol`.
- Problems 39–45: `01.in/.sol` through `09.in/.sol` → `1.in/.sol` through `9.in/.sol`; existing `10.in/.sol` retained.

Total: eight problems, 80 input/output pairs, 146 renamed files. SHA256 hashes of all 160 testcase files matched before/after. Duplicate numbering and existing-destination collisions were checked before changes; no testcase contents were edited.

New grading claims were briefly paused and existing jobs allowed to finish. All six workers can see all 80 canonical testcase pairs, and their original enabled flags were restored. Existing submission results and contest scores were checked unchanged; no submissions were automatically rejudged. API, website, nginx, ngrok and monitor remained active, and the public problem-page health check passed.

Original files and rename/verification records: `D:\otog-grader\vm-setup\testcase-rename-evidence-20261015.tar` (contains `original-testcases.tgz`). Guest audit marker: `/home/otog/worker-setup/testcase-rename-current-20261015.txt`.

Previously failed Judge Error submissions require rejudging to obtain fresh verdicts. Future uploads must use sequential canonical filenames or be normalized before upload; this correction changes the affected uploaded files only.
