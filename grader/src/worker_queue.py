"""Atomic shared queue and session locks for independent grader containers."""
import os
import select
import time
from pathlib import Path
import psycopg2
from psycopg2 import sql
from psycopg2.extras import NamedTupleCursor
from memory_guard import MemoryGuard
from grader_safety import watchdog_phase
from memory_reservations import (MEMORY_LOCK, MIN_JOB_KIB, JOB_PADDING_KIB,
                                 MIN_FAST_JOB_KIB, needs_full_compilation,
                                 pool_kib, read_snapshot_kib, reservation_kib, evaluation_kib)

WORKER_LOCK = 140011
USER_LOCK = 140012
PROBLEM_LOCK = 140013
QUEUE_CHANNEL = 'otog_queue_wakeup'
memory_guard = MemoryGuard()
ALLOW_FAST_COMPILATION = True


def queue_priority(alias):
    """Current contests, other contest work, then practice; evaluated per claim."""
    if alias not in ('S', 'earlier', 'submission'):
        raise ValueError('Unsupported queue alias.')
    return f'''CASE WHEN {alias}."contestId" IS NULL THEN 2
        WHEN {alias}."contestId"=ANY(ARRAY(SELECT queue_contest.id
            FROM contest queue_contest
            WHERE queue_contest."timeStart"<=CURRENT_TIMESTAMP
            AND CURRENT_TIMESTAMP<queue_contest."timeEnd")) THEN 0 ELSE 1 END'''


def queue_key(alias):
    # Rejudges enter FIFO at their latest enqueue, not their original creation.
    return f'({queue_priority(alias)}, {alias}."queuedAt", {alias}.id)'


class QueueWakeup:
    """Notifications are hints; durable claims and periodic checks remain authoritative."""
    def __init__(self, config, channel=QUEUE_CHANNEL):
        self.config = config
        self.channel = channel
        self.conn = None
        self.retry_at = 0
        self.last_wait_return = 0
        self._connect()

    def _connect(self):
        if time.monotonic() < self.retry_at:
            return
        try:
            self.conn = psycopg2.connect(**self.config, connect_timeout=3,
                                         application_name='otog-queue-listener')
            self.conn.autocommit = True
            with self.conn.cursor() as cursor:
                cursor.execute("SET statement_timeout='3s'")
                cursor.execute(sql.SQL('LISTEN {}').format(sql.Identifier(self.channel)))
        except psycopg2.Error:
            self.close()
            self.retry_at = time.monotonic() + 5

    def wait(self, timeout=5):
        # Coalesce floods: at most the previous two empty-queue checks/second.
        remaining = self.last_wait_return + 0.5 - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        if self.conn is None or self.conn.closed:
            self.close()
            self._connect()
        if self.conn is None:
            time.sleep(0.5)
        else:
            try:
                self.conn.poll()
                if not self.conn.notifies:
                    select.select([self.conn], [], [], timeout)
                    self.conn.poll()
                self.conn.notifies.clear()
            except (psycopg2.Error, OSError, ValueError):
                self.close()
                self.retry_at = time.monotonic() + 5
                time.sleep(0.5)
        self.last_wait_return = time.monotonic()

    def close(self):
        if self.conn is not None:
            self.conn.close()
            self.conn = None


def lock_worker(conn, worker_id):
    with conn.cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_lock(%s,%s)', (WORKER_LOCK, worker_id))
        locked = cursor.fetchone()[0]
    conn.commit()
    if not locked:
        raise RuntimeError(f'Worker {worker_id} is already running.')


def recover_owned(conn, worker_id):
    """Only recover leases of this worker after acquiring its exclusive lock."""
    with conn.cursor() as cursor:
        cursor.execute('''UPDATE submission S SET status='waiting', "updateDate"=NOW()
            FROM "otogWorkerJob" J WHERE J."submissionId"=S.id
            AND J."workerId"=%s AND S.status='grading'
            AND NOT EXISTS (SELECT 1 FROM "submissionResult" R WHERE R."submissionId"=S.id)
            RETURNING S.id''', (worker_id,))
        recovered = [row[0] for row in cursor.fetchall()]
        cursor.execute('DELETE FROM "otogWorkerJob" WHERE "workerId"=%s', (worker_id,))
    conn.commit()
    return recovered


@watchdog_phase('releasing finished-job memory reservation', 30)
def release_memory(conn, worker_id):
    """Call only after sandbox cleanup or a confirmed container restart.

    Result persistence releases the queue lease, but deliberately keeps this
    reservation. Heartbeat age is never sufficient to reclaim running memory.
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)', (MEMORY_LOCK, 1))
            cursor.execute('''DELETE FROM "otogWorkerMemoryReservation"
                WHERE "workerId"=%s RETURNING "workerId"''', (worker_id,))
            if cursor.fetchone() is not None:
                cursor.execute('SELECT pg_notify(%s,%s)', (QUEUE_CHANNEL, 'memory-released'))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


@watchdog_phase('reducing compilation memory reservation', 30)
def begin_evaluation(conn, worker_id, submission_id, memory_limit_mib, custom_checker):
    """Shrink only after both contestant and checker compilation have ended.

    Never wait for additional memory between testcases: the evaluation envelope
    covers contestant execution, scratch and the chosen checker for the rest of
    the job. A phase transition may only reduce a reservation, never grow it.
    """
    amount = evaluation_kib(memory_limit_mib, custom_checker)
    try:
        with conn.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)', (MEMORY_LOCK, 1))
            cursor.execute('''SELECT "reservedKiB",phase FROM "otogWorkerMemoryReservation"
                WHERE "workerId"=%s AND "submissionId"=%s FOR UPDATE''', (worker_id, submission_id))
            row = cursor.fetchone()
            if row is None or amount > row[0]:
                raise RuntimeError('Evaluation reservation is missing or would need to grow.')
            # A repeated identical transition is harmless, but changing checker
            # classification after evaluation starts is an infrastructure error.
            if row[1] == 'evaluating' and amount != row[0]:
                raise RuntimeError('Evaluation reservation already established.')
            if row[1] != 'evaluating':
                cursor.execute('''UPDATE "otogWorkerMemoryReservation" SET "reservedKiB"=%s,
                    phase='evaluating',"updatedAt"=NOW() WHERE "workerId"=%s AND "submissionId"=%s''',
                    (amount, worker_id, submission_id))
            if amount < row[0]:
                cursor.execute('SELECT pg_notify(%s,%s)', (QUEUE_CHANNEL, 'compilation-memory-released'))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


@watchdog_phase('requeuing compilation with original memory limit', 30)
def retry_full_compilation(conn, worker_id, submission_id):
    """Caller has stopped compilation and fully cleaned its private sandbox.

    Release the entire allowance while waiting for the larger retry: no worker
    holds partial memory while trying to grow it. Preserve real crash attempts.
    The profile survives rejudges, so the same submission does not retry twice.
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)', (MEMORY_LOCK, 1))
            cursor.execute('''SELECT S.status FROM submission S JOIN "otogWorkerJob" J
                ON J."submissionId"=S.id WHERE S.id=%s AND J."workerId"=%s FOR UPDATE OF S''',
                (submission_id, worker_id))
            row = cursor.fetchone()
            if row is None or row[0] != 'grading':
                raise RuntimeError('Compilation retry no longer owns the active job.')
            cursor.execute('SELECT 1 FROM "submissionResult" WHERE "submissionId"=%s', (submission_id,))
            if cursor.fetchone() is not None:
                raise RuntimeError('Completed submission cannot be rescheduled as a compilation retry.')
            cursor.execute('''INSERT INTO "otogCompilationProfile" ("submissionId") VALUES (%s)
                ON CONFLICT ("submissionId") DO NOTHING RETURNING "submissionId"''', (submission_id,))
            if cursor.fetchone() is None:
                raise RuntimeError('The original-memory compilation retry was already requested.')
            cursor.execute('''DELETE FROM "otogWorkerAttempt" WHERE "submissionId"=%s AND attempts=1''', (submission_id,))
            cursor.execute('''UPDATE "otogWorkerAttempt" SET attempts=attempts-1
                WHERE "submissionId"=%s AND attempts>1''', (submission_id,))
            from compile_pipeline import enabled as pipeline_enabled
            if pipeline_enabled():
                cursor.execute("SELECT set_config('otog.internal_stage_handoff','on',true)")
            cursor.execute('''UPDATE submission SET status='waiting',"updateDate"=NOW() WHERE id=%s''', (submission_id,))
            cursor.execute('DELETE FROM "otogWorkerJob" WHERE "submissionId"=%s AND "workerId"=%s', (submission_id, worker_id))
            cursor.execute('DELETE FROM "otogWorkerMemoryReservation" WHERE "submissionId"=%s AND "workerId"=%s', (submission_id, worker_id))
            from compile_pipeline import enabled as pipeline_enabled
            if pipeline_enabled():
                cursor.execute('DELETE FROM "otogCompiledArtifact" WHERE "submissionId"=%s AND "ownerWorkerId"=%s AND state=\'compiling\'', (submission_id,worker_id))
            cursor.execute('SELECT pg_notify(%s,%s)', (QUEUE_CHANNEL, 'full-compilation-retry'))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def claim(conn, worker_id):
    # Refuse claims above the online CPU cap even if the saved worker state is stale.
    if worker_id >= (os.cpu_count() or 1):
        conn.rollback()
        return None
    excluded = []
    excluded_problems = []
    excluded_jobs = []
    ready_only = False
    from compile_pipeline import enabled as pipeline_enabled
    pipeline = pipeline_enabled()
    from compile_pipeline import dedicated, compiler, queue_filter
    split = pipeline and dedicated()
    if split and compiler() != (worker_id in (7, 8, 9, 10, 11, 12, 13, 14, 15, 16)):
        raise RuntimeError('Compiler role and slot identity disagree.')
    role_table = 'otogCompilerState' if split and compiler() else 'otogWorkerState'
    filters = {}
    try:
        if split and compiler():
            # An empty compiler queue needs no filesystem metadata or admission
            # locks. This is only a necessary-condition hint: claim below still
            # validates fresh problem files and all scheduling limits.
            with conn.cursor() as cursor:
                cursor.execute('''SELECT EXISTS (
                    SELECT 1 FROM submission S
                    WHERE S.status='waiting' AND S.language IN ('c','cpp')
                    AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" J WHERE J."submissionId"=S.id)
                    AND NOT EXISTS (SELECT 1 FROM "otogCompiledArtifact" A
                        WHERE A."submissionId"=S.id AND A.state IN ('ready','evaluating','bypass')))''')
                waiting = cursor.fetchone()[0]
            if not waiting:
                conn.commit()
                return None
            # Earlier work from the same user keeps execution priority. Only S
            # needs filesystem eligibility; the other predicates are unconditional.
            filters = {'S': queue_filter('S'), 'earlier': 'TRUE', 'submission': 'TRUE'}
        else:
            # Graders may execute ready binaries or any direct-language/custom
            # job, so this hint must not restrict language or artifact state.
            with conn.cursor() as cursor:
                cursor.execute('''SELECT EXISTS (
                    SELECT 1 FROM submission S WHERE S.status='waiting'
                    AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" J WHERE J."submissionId"=S.id))''')
                waiting = cursor.fetchone()[0]
            if not waiting:
                conn.commit()
                return None
            if split:
                from compile_pipeline import queue_problem_ids
                problem_ids = queue_problem_ids()
                filters = {alias: queue_filter(alias, problem_ids) for alias in ('S', 'earlier', 'submission')}
        if split:
            # CF jobs compile validators/reference solutions inside the grader;
            # the optional dedicated compiler cannot stage these multi-step jobs.
            for alias in filters:
                cf_exists = f'EXISTS (SELECT 1 FROM "cfRun" CF WHERE CF."submissionId"={alias}.id)'
                filters[alias] = f'(({filters[alias]}) AND NOT {cf_exists})' if compiler() else f'(({filters[alias]}) OR {cf_exists})'
        if not memory_guard.allows():
            conn.commit()
            return None
        # Every independent container spends the same durable pool. Lock only
        # the short claim transaction, never compilation or testcase execution.
        with conn.cursor() as cursor:
            # The main connection already bounds lock waits to ten seconds.
            # Waiting briefly here lets a submitted batch fill available slots
            # immediately instead of making losers sleep for a polling cycle.
            cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)', (MEMORY_LOCK, 1))
            cursor.execute('SELECT "memoryReservationsEnabled" FROM "otogGradingSettings" WHERE id=1 FOR SHARE')
            policy = cursor.fetchone()
            if policy is None:
                raise RuntimeError('Memory reservation policy is not configured.')
            reservations_enabled = policy[0]
            cursor.execute('SELECT "workerId","reservedKiB" FROM "otogWorkerMemoryReservation"')
            reservations = cursor.fetchall()
            if any(w == worker_id for w, _ in reservations):
                # A previous job still owns memory; cleanup must release it.
                conn.commit()
                return None
            cursor.execute('SELECT "budgetKiB" FROM "otogWorkerMemoryBudget" WHERE id=1 FOR UPDATE')
            budget_row = cursor.fetchone()
            if budget_row is None:
                raise RuntimeError('Shared memory budget is not configured.')
            budget = budget_row[0]
            if not reservations:
                budget = pool_kib(read_snapshot_kib())
                if budget is None:
                    conn.commit()
                    return None
            epoch_budget = budget
            if not reservations_enabled:
                # Continue durable accounting and cleanup while bypassing only
                # capacity admission. Re-enabling counts every active job.
                budget = 1 << 50
            remaining = budget - sum(amount for _, amount in reservations)
            minimum_initial = MIN_FAST_JOB_KIB if ALLOW_FAST_COMPILATION else MIN_JOB_KIB
            if pipeline:
                minimum_initial = 257 * 1024
            if remaining < minimum_initial:
                conn.commit()
                return None
        with conn.cursor() as cursor:
            cursor.execute(f'''SELECT W.enabled, G."maxWorkersPerUser",
                ARRAY(SELECT running."userId" FROM "otogWorkerJob" active
                    JOIN submission running ON running.id=active."submissionId"
                    GROUP BY running."userId" HAVING COUNT(*) >= G."maxWorkersPerUser")
                FROM "{role_table}" W CROSS JOIN "otogGradingSettings" G
                WHERE W."workerId"=%s AND G.id=1 FOR UPDATE OF W FOR SHARE OF G''', (worker_id,))
            state = cursor.fetchone()
        if state is None or not state[0]:
            conn.commit()
            return None
        if split and compiler():
            with conn.cursor() as cursor:
                cursor.execute('SELECT EXISTS (SELECT 1 FROM "otogWorkerState" WHERE enabled)')
                if not cursor.fetchone()[0]:
                    conn.commit()
                    return None
        # Count the at-most-eight active leases once, rather than for every queued row.
        # The per-user lock and fresh check below still enforce concurrent claims.
        limit = state[1]
        excluded = list(state[2])
        with conn.cursor() as cursor:
            # Limits are database-backed, so they also apply to rejudges and
            # survive worker/VM restarts. Hold policy rows stable until commit.
            cursor.execute('SELECT "problemId","maxWorkers" FROM "otogProblemGradingLimit" FOR SHARE')
            problem_limits = dict(cursor.fetchall())
            if problem_limits:
                cursor.execute('''SELECT running."problemId",COUNT(*)
                    FROM "otogWorkerJob" active JOIN submission running
                    ON running.id=active."submissionId" GROUP BY running."problemId"''')
                excluded_problems = [pid for pid,count in cursor.fetchall()
                                     if pid in problem_limits and count >= problem_limits[pid]]
            # An unfit older problem must not block a smaller job belonging to
            # the same user. Reuse this exclusion in all FIFO eligibility checks.
            cursor.execute('''SELECT id FROM problem WHERE "memoryLimit"<1
                OR "memoryLimit">1048576
                OR "memoryLimit"::bigint*1024+%s>%s
                OR (NOT %s AND GREATEST(%s::bigint,"memoryLimit"::bigint*1024+%s)>%s)''',
                (JOB_PADDING_KIB, budget, pipeline, minimum_initial, JOB_PADDING_KIB, remaining))
            excluded_problems.extend(row[0] for row in cursor.fetchall())
        for _ in range(64):
            with conn.cursor(cursor_factory=NamedTupleCursor) as cursor:
                candidate_sql = f'''SELECT S.*, B."timeLimit", B."memoryLimit", B."case",
                    B.score AS "maxScore", {queue_priority('S')} AS "queuePriority",
                    EXISTS(SELECT 1 FROM "otogCompilationProfile" C WHERE C."submissionId"=S.id)
                    AS "fullCompilation" FROM submission S JOIN problem B ON B.id=S."problemId"
                    WHERE S.status='waiting' AND NOT (S."userId"=ANY(%s::integer[]))
                    AND NOT (S."problemId"=ANY(%s::integer[]))
                    AND NOT (S.id=ANY(%s::integer[]))
                    AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" owned WHERE owned."submissionId"=S.id)
                    AND NOT EXISTS (SELECT 1 FROM submission earlier
                        WHERE earlier."userId"=S."userId" AND earlier.status='waiting'
                        AND NOT (earlier."problemId"=ANY(%s::integer[]))
                        AND NOT (earlier.id=ANY(%s::integer[]))
                        AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" owned WHERE owned."submissionId"=earlier.id)
                        AND {queue_key('earlier')}<{queue_key('S')})
                    ORDER BY {queue_key('S')} LIMIT 1 FOR UPDATE OF S SKIP LOCKED'''
                if split:
                    candidate_sql = candidate_sql.replace("WHERE S.status='waiting'", "WHERE S.status='waiting' AND " + filters['S'])
                    candidate_sql = candidate_sql.replace("earlier.status='waiting'", "earlier.status='waiting' AND " + filters['earlier'])
                if ready_only:
                    candidate_sql = candidate_sql.replace("WHERE S.status='waiting'",
                        "WHERE S.status='waiting' AND EXISTS (SELECT 1 FROM \"otogCompiledArtifact\" P WHERE P.\"submissionId\"=S.id AND P.state='ready')")
                cursor.execute(candidate_sql,
                    (excluded, excluded_problems, excluded_jobs, excluded_problems, excluded_jobs))
                job = cursor.fetchone()
            if job is None:
                conn.commit()
                return None
            try:
                with conn.cursor() as cursor:
                    cursor.execute('SELECT plan FROM "cfRun" WHERE "submissionId"=%s', (job.id,))
                    cf_plan = cursor.fetchone()
                if cf_plan:
                    cfg = cf_plan[0]['config']
                    job = job._replace(timeLimit=int(cfg['timeLimit']), memoryLimit=int(cfg['memoryLimit']))
                if split and compiler() and job.problemId in problem_limits:
                    with conn.cursor() as cursor:
                        cursor.execute('''SELECT EXISTS (SELECT 1 FROM "otogCompiledArtifact" A
                            JOIN submission S ON S.id=A."submissionId"
                            WHERE A.state='ready' AND S.status='waiting' AND S."problemId"=%s)''', (job.problemId,))
                        if cursor.fetchone()[0]:
                            excluded_problems.append(job.problemId)
                            continue
                static_full = (bool(cf_plan) or not ALLOW_FAST_COMPILATION or needs_full_compilation(
                    job.language, job.memoryLimit, Path('/usr/src/app/shared-source') / str(job.problemId)))
                full_compilation = static_full or job.fullCompilation
                allowance = reservation_kib(job.memoryLimit, full_compilation)
                if cf_plan:
                    # Include the 768-MiB trusted-tool compiler and padding;
                    # retain this allowance through multi-stage hack evaluation.
                    allowance = max(allowance, MIN_JOB_KIB)
                choice = {'stage': 'legacy'}
                if pipeline and not cf_plan:
                    from compile_pipeline import plan
                    with conn.cursor() as cursor:
                        choice = plan(cursor, job, full_compilation, remaining, budget)
                    if split and choice is not None and ((choice['stage'] == 'compile') != compiler()):
                        excluded_jobs.append(job.id)
                        continue
                    if choice is None:
                        excluded_jobs.append(job.id)
                        # The compiler/store is full. Check ready work directly
                        # rather than inspecting 64 more uncompiled submissions.
                        ready_only = True
                        continue
                    if choice['stage'] != 'legacy':
                        full_compilation = choice['full']
                        allowance = choice['amount']
            except ValueError:
                excluded_problems.append(job.problemId)
                continue
            if allowance > remaining:
                if pipeline and allowance <= budget and (choice['stage'] == 'evaluate' or
                        choice['stage'] == 'compile' and choice['full']):
                    # Drain active allocations for an older ready program;
                    # compilation must not starve a large execution reservation.
                    conn.commit()
                    return None
                if pipeline:
                    if job.memoryLimit * 1024 + JOB_PADDING_KIB > budget:
                        excluded_problems.append(job.problemId)
                    else:
                        excluded_jobs.append(job.id)
                    continue
                if static_full:
                    excluded_problems.append(job.problemId)
                else:
                    # An eligible full-memory retry holds no partial budget.
                    # Let active jobs drain instead of repeatedly admitting
                    # younger small jobs that could starve this retry.
                    conn.commit()
                    return None
                continue
            job = job._replace(fullCompilation=full_compilation)
            with conn.cursor() as cursor:
                if job.problemId in problem_limits:
                    # Serialize only short claims for a limited problem. The
                    # fresh count after the lock closes concurrent-claim races.
                    cursor.execute('SELECT pg_try_advisory_xact_lock(%s,%s)', (PROBLEM_LOCK, job.problemId))
                    if not cursor.fetchone()[0]:
                        excluded_problems.append(job.problemId)
                        continue
                    cursor.execute('''SELECT COUNT(*) FROM "otogWorkerJob" active
                        JOIN submission running ON running.id=active."submissionId"
                        WHERE running."problemId"=%s''', (job.problemId,))
                    if cursor.fetchone()[0] >= problem_limits[job.problemId]:
                        excluded_problems.append(job.problemId)
                        continue
                cursor.execute('SELECT pg_try_advisory_xact_lock(%s,%s)', (USER_LOCK, job.userId))
                if not cursor.fetchone()[0]:
                    excluded.append(job.userId)
                    continue
                # A fresh statement after acquiring the user's short lock sees
                # claims committed since the candidate query's snapshot.
                cursor.execute('''SELECT
                    (SELECT COUNT(*) FROM "otogWorkerJob" active JOIN submission running
                        ON running.id=active."submissionId" WHERE running."userId"=%s) < %s
                    AND NOT EXISTS (SELECT 1 FROM submission WHERE "userId"=%s AND status='waiting' ''' + ((' AND ' + filters['submission']) if split else '') + '''
                        AND NOT ("problemId"=ANY(%s::integer[]))
                        AND NOT (id=ANY(%s::integer[]))
                        AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" owned WHERE owned."submissionId"=submission.id)
                        AND ''' + queue_key('submission') + '''<(%s,%s,%s))''',
                    (job.userId, limit, job.userId, excluded_problems, excluded_jobs,
                     job.queuePriority, job.queuedAt, job.id))
                if not cursor.fetchone()[0]:
                    excluded.append(job.userId)
                    continue
                # Recheck immediately before creating the durable lease. Low
                # memory leaves status unchanged and releases claim locks.
                if not memory_guard.allows():
                    conn.commit()
                    return None
                # The ML/profile snapshot and the selected allowance travel
                # together even if an administrator edits future job settings.
                if not reservations:
                    # Don't rewrite the budget during empty-queue/pause polls.
                    # Start an epoch only when actually making its first claim.
                    cursor.execute('''UPDATE "otogWorkerMemoryBudget" SET "budgetKiB"=%s,
                        "updatedAt"=NOW() WHERE id=1''', (epoch_budget,))
                cursor.execute('''INSERT INTO "otogWorkerMemoryReservation"
                    ("workerId","submissionId","reservedKiB",phase) VALUES (%s,%s,%s,%s)''',
                    (worker_id, job.id, allowance, 'evaluating' if choice['stage']=='evaluate' else 'compiling'))
                cursor.execute('''UPDATE submission SET status='grading',"updateDate"=NOW()
                    WHERE id=%s AND status='waiting' ''', (job.id,))
                cursor.execute('''INSERT INTO "otogWorkerJob" ("submissionId","workerId")
                    VALUES (%s,%s)''', (job.id, worker_id))
                # Increment in the same transaction as the durable claim. This
                # follows a submission across containers and process deaths.
                cursor.execute('''INSERT INTO "otogWorkerAttempt" ("submissionId",attempts)
                    VALUES (%s,1) ON CONFLICT ("submissionId") DO UPDATE
                    SET attempts="otogWorkerAttempt".attempts+1''', (job.id,))
                if pipeline:
                    from compile_pipeline import claim_stage
                    job = claim_stage(cursor, worker_id, job, choice)
            conn.commit()
            return job
        conn.commit()
        return None
    except Exception:
        conn.rollback()
        if 'job' in locals() and job:
            unlock_user(conn, job.userId)
        raise


@watchdog_phase('final queue cleanup', 30)
def unlock_user(conn, user_id):
    # User locks are transaction scoped; claim/persist commit releases them.
    conn.commit()


@watchdog_phase('retry budget lookup', 30)
def retry_exhausted(conn, submission_id):
    with conn.cursor() as cursor:
        cursor.execute('SELECT attempts FROM "otogWorkerAttempt" WHERE "submissionId"=%s', (submission_id,))
        row = cursor.fetchone()
    conn.commit()
    # Allow one retry after an interrupted attempt, then quarantine as Judge Error.
    return row is not None and row[0] > 2


@watchdog_phase('saving grading results and scores', 90)
def persist(conn, db_module, submission, result, worker_id=None):
    """Commit result, verdicts, contest score and lease release together."""
    commit = db_module.db.update
    init_score = db_module.initContestScore
    try:
        with conn.cursor() as cursor:
            cursor.execute('SELECT P."contestId" FROM "cfRun" R JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE R."submissionId"=%s', (submission.id,))
            cf = cursor.fetchone()
            if cf:
                cursor.execute('SELECT pg_advisory_xact_lock(140131,%s)', (cf[0],))
            # Serialize only result/score commits, not contestant execution.
            # Take this before the submission row to keep lock order consistent.
            cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)', (USER_LOCK, submission.userId))
            cursor.execute('SELECT status FROM submission WHERE id=%s FOR UPDATE', (submission.id,))
            row = cursor.fetchone()
            if not row or row[0] != 'grading':
                raise RuntimeError('Submission was removed or requeued during grading.')
            cursor.execute('DELETE FROM "submissionResult" WHERE "submissionId"=%s', (submission.id,))
        db_module.db.update = lambda: None
        db_module.updateResult(result)
        import cf_grading
        with conn.cursor() as cursor:
            is_cf = cf_grading.complete(cursor, submission, result)
        if submission.contestId and not is_cf:
            def completed_history(*args):
                score = init_score(*args)
                # Rejudging deletes results while retaining history. Pending
                # entries must not be read as completed scores; when they finish
                # the original scoring logic recomputes history in ID order.
                with conn.cursor() as cursor:
                    cursor.execute('SELECT "submissionId" FROM "submissionResult" WHERE "submissionId"=ANY(%s)',
                                   ([entry.submissionId for entry in score.history],))
                    completed = {row[0] for row in cursor.fetchall()}
                score.history = [entry for entry in score.history if entry.submissionId in completed]
                return score
            # Each container has one judging thread and its own dbQuery module.
            # The heartbeat uses a separate connection and never calls scoring.
            db_module.initContestScore = completed_history
            db_module.updateContestScore(submission, result)
        with conn.cursor() as cursor:
            cursor.execute('DELETE FROM "otogWorkerAttempt" WHERE "submissionId"=%s', (submission.id,))
            cursor.execute('DELETE FROM "otogWorkerJob" WHERE "submissionId"=%s AND "workerId"=%s',
                           (submission.id, worker_id if worker_id is not None else int(__import__('os').environ['OTOG_WORKER_ID'])))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db_module.db.update = commit
        db_module.initContestScore = init_score
