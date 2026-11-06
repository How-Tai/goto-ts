# Fractional grading scores

Deployed on 3 November 2026, build `rpjXcV7wPOf2TJScoRSMP`. All scoring,
PostgreSQL/Prisma/HTTP, React rendering, type, production build, and page checks
passed. All seven workers were updated; their allocation and resource/isolation
settings were preserved. Public HTTPS verification passed.

Submission 805 exposed two sources of rounding: the batch evaluator rounded its
final score to a whole number, and PostgreSQL stored earned/subtask scores in
integer columns. A valid partial-credit result could consequently show 100/100
with a Rejected verdict.

The batch evaluator now keeps its calculated score. Submission results, subtask
scores and maxima, contest scores, and contest score history use double precision.
The generated database client and validation schemas must be rebuilt with the
migration. Problem maximum scores and CF's integer points rules are unchanged.

The frontend rounds fractional values to two decimal places for display, keeping
whole values compact. This applies to submission summaries, subtask badges,
contest task cards, sidebar totals, standings, and history tables/tooltips. Partial
testcase details also show their percentage with two decimal places. Calculations,
comparisons, and ranking use the stored values, rather than the formatted text.

The saved verdicts for 805 reproduce 99.52799842055708 overall and
59.52799842055708 for subtask 4. Only its scores were repaired using those saved
verdicts and the unchanged four average-based subtask rules, preserving its verdict,
source, testcase records, execution time, and memory. A subsequent live rejudge
also produced the correct fractional score (its new execution time was 525 ms).
Other historical submissions were not
silently recalculated; future grading retains fractional values.

Verification includes a replay of 805 through the actual evaluator, average/min/
max and grouped scoring, fractional weight normalization, actual React submission
rendering, and real PostgreSQL/Prisma/HTTP contract checks for all changed score
columns. Deploy workers individually after their current jobs drain, preserving
their CPU allocation and other containment/resource settings.
