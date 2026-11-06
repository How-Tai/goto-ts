# NPK Cafe testcase strengthening - 15 October 2026

Deployed to problem 46, `01-NPK_Cafe`, in the Linux VM. The bundle now contains 30 input/answer pairs, including all ten original pairs unchanged and 20 additional cases. The existing published statement was preserved.

## Rules and coverage

The statement asks for the maximum and second **distinct** occupancy counts over open hours 1 through K. Visits include both endpoints, as its examples explicitly demonstrate (including a one-hour visit). Every generated case has two distinct occupancy values, 10 <= N <= 300,000, 2 <= K <= 1,000,000, and 1 <= arrival <= departure <= K. The two existing sample-sized cases with N=3 and N=5 were retained; all new cases meet the score table's minimum N=10.

The old ten answers all happened to have `second = maximum - 1`, and the largest old input had only 50,000 customers. The additions cover:

- Maximum and runner-up separated by a large gap, including a legitimate runner-up of zero during empty open hours.
- Maximum already present at hour 1; a better runner-up appearing afterward; repeated maximum values that must not be counted twice.
- Simultaneous arrivals/departures with inclusive endpoints and one-hour visits.
- No vacant hours, K=2, and correct exclusion of hour 0 and K+1.
- Visits extending to K=1,000,000, sparse hours, overlapping/nested intervals and shuffled input order.
- N=3,000 and N=3,001 score-band boundaries, plus multiple N=300,000 datasets with different overlap patterns.

Every answer has exactly two lines. The existing standard checker remains appropriate to that explicit output format.

## Scoring and limits

Added the native `subtask.json` configuration to retain the statement's 20% weighting for small inputs (N <= 3,000) and 80% for large inputs. There are 16 small cases and 14 large cases. Scoring is proportional per case within each band (`group: false`), since this statement does not specify all-or-nothing groups. A solution passing every small case and no large case scores exactly 20/100, verified through the actual grader. The database's numeric case count is 30.

The deployment changed only the numeric testcase count in the problem row; its before/after snapshots both retained the then-current 1,000 ms limit and 128 MB memory limit. The subsequent live verification observed a 200 ms limit, matching the statement. This workflow did not issue that time-limit change. Both the correct reference and accepted submission 607 were therefore explicitly verified at 200 ms. Memory remained 128 MB.

## Verification

- All 30 saved answers agree between a Python compressed-event sweep and an independent C++ hourly difference-array reference. Small saved cases were also directly simulated per customer per hour.
- 1,000 seeded small random instances matched the direct simulation, event sweep and C++ reference.
- Actual isolated grading: correct reference scored 100 at 200 ms per testcase, with a maximum observed case CPU time of 121 ms. Existing accepted submission 607 initially scored 100 at 1,000 ms (maximum case CPU time 100 ms), and a targeted final verification at the observed live 200 ms limit also scored 100 (maximum case CPU time 108 ms).
- A small-band-only reference scored exactly 20. A deliberately incorrect `second = maximum - 1` implementation now scores 56 rather than passing.
- Previously accepted submission 601 has incorrect second-maximum maintenance; the stronger bundle catches it and it scores 68 in an offline grading run. Its historical database verdict was not changed. This test demonstrates a previously undetected error rather than assuming every old accepted implementation is correct.
- Additional mutation checks confirm rejection of treating the top two hours as distinct values, exclusive departure endpoints, and ignoring the final open hour.
- Deployed file hashes match the tested candidate hashes. All six graders see the new files and score configuration. Previous Isekai and Logistics bundles remain unchanged.

## Deployment and recovery

Backed up the original testcase folder, statement and settings before generation. Active jobs were allowed to finish before the brief switch; new claims were paused during it. Live hashes and settings were checked against the backup snapshot, source folders switched with rollback handling, and the numeric count updated transactionally. All prior worker enable flags were restored. No worker or website service restarted.

Database fingerprints confirm existing submission results, testcase verdicts, contest scores/history and the per-user worker cap were preserved. Historical submissions were not automatically rejudged. Post-deployment checks found six enabled workers with fresh heartbeats, healthy services, successful localhost/ngrok problem pages and no new Judge Errors in the preceding 15 minutes.

Backups and evidence are on D:

- `vm-setup/npk-original-20261015.tgz`
- `vm-setup/npk-evidence-20261015.tgz`
- `vm-setup/npk-evidence-20261015/problem-46-strengthened-20261015.zip`

The ZIP includes the input/output files and `subtask.json`; preserve that configuration in future replacement uploads to keep the 20/80 weighting. Successful reference runs and mutation checks strengthen confidence and coverage, without proving that every incorrect implementation will be rejected or that all implementations have the same performance margin under load.
