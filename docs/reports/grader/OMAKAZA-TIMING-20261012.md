# Omakaza sorting and counting timing — 12 October 2026

## Findings

Problem 11, Omakaza, has a 1,000 ms CPU limit, 128 MiB memory limit and ten cases. The provided ZIP contains those ten cases. Hashes of cases 5, 6, 8, 9 and 10 match their deployed copies.

Case 8 contains 5,000 pairs of strings, totaling 9,250,406 characters; the longest string is 1,000 characters. The strings use all 26 uppercase letters. Case 9 is slightly larger at 10 million characters but averages only 1.75 distinct letters per string. These distributions make sorting effort different even when file sizes are similar.

Sorting submission 234 and ten other recent submissions share the exact same source hash (`61db3dae3fcb`). They use fast, untied C++ streams and sort both strings before comparing. Among those eleven recorded results, submission 381 passed with case 8 at 973 ms; the other ten timed out on case 8 at approximately 1,025–1,107 ms. Other sorting variants passed with maxima 797 and 980 ms. The 1 s limit therefore has little margin for these sorting implementations in this VM.

Frequency-counting submission 443 and 34 other submissions share source hash `312ac8de3610`. They check lengths, accumulate a 26-element character-count array and compare counts. All 33 submissions that compiled scored 100; maximum-case times across those results ranged from 73 to 461 ms. Two compiler failures are excluded from the timing comparison.

Those two compiler failures, submissions 424 and 433, were recorded as `Compilation Time Limit Exceeded`, rather than source syntax errors. This is a separate deadline issue during the batch; it is additional evidence that identical submissions have encountered variable server completion times. The final kernel-message filter found no lockup or OOM entries in the current boot, and all production services remained active.

Counting scans each character once. Sorting compares and rearranges characters repeatedly. Both inspected implementations already enable fast C++ streams and emit comparable output, so the gap cannot be assigned solely to a slow input stream. The counting implementation also skips work when lengths differ, while submission 234 always sorts both strings.

## Exact-source bounded comparison

The inspected original sources from submissions 234 and 443 were compiled with `-O2 -std=c++17 -fomit-frame-pointer -Wunused-result`. Each ran against the exact same full case 8, with input and output redirected to files and output checked against the supplied answer. There were three native runs for each source on each platform.

| Environment | Sorting CPU seconds | Counting CPU seconds |
| --- | --- | --- |
| Windows host, GCC 15.2.0 | 0.2344, 0.2344, 0.2344 | 0.0312, 0.0469, 0.0312 |
| VM, deployed glibc image, GCC 14.2.0, without isolate | 0.4417, 0.4115, 0.9532 | 0.0342, 0.0316, 0.0354 |
| Actual isolated grader, one diagnostic run | 0.421 | 0.048 |

The native VM sorting executable varied by over 2× between runs without recompilation. This reproduces server-side timing variability before the judge sandbox is involved. The sandbox run itself was within the faster native VM range; these samples do not identify isolate as the dominant source of the slowdown.

For original case 10, actual sandbox CPU times were 205 ms for sorting and 19 ms for counting. Both programs scored 100 on copied cases 8 and 10 with a diagnostic 5 s CPU limit. The real problem's 1 s limit was never changed. Total diagnostic grading elapsed time, including compilation and both cases, was 5.34 and 4.85 seconds respectively; that total is not the individual-testcase CPU limit.

The grader supplies isolate `--time` from the problem's limit and uses a separate longer `--wall-time` safety bound. CPU time and elapsed time have different meanings, as documented in the [isolate manual](https://www.ucw.cz/isolate/isolate.1.html). The code uses the maximum individual-case CPU time for the submission time displayed in the website. Queue waits and compilation are excluded from that displayed figure.

## Limits and operational scope

These observations establish both an algorithmic gap and a variable VM slowdown on this workload. They do not establish the exact VirtualBox/Windows scheduling mechanism behind that variation. Windows and Linux use different compiler versions, and the comparisons are short samples under changing host/server load; this is not a controlled proof of one universal virtualization penalty. CPU usage chart corrections do not change isolate's timing or verdicts.

The diagnostic container used spare guest CPU 6, inherited low process priority, had a 384 MiB memory limit and no network connection. It used read-only copies of code and cases, no database credentials or production queue, and was removed after completion. Source/ZIP files, production results, problem limits, worker concurrency, Windows security and VM settings were left unchanged.

If sorting is intended to earn full credit, its limit needs to be calibrated against representative grader measurements with enough headroom for observed variation. Reducing judging concurrency is another candidate to test for consistency, but this investigation did not change that setting or establish its benefit quantitatively.

Local evidence: `vm-setup/omakaza-evidence-20261012/host-results.json`, `vm-results.log`, `submissions.json`, and the inspected source/testcase copies.
