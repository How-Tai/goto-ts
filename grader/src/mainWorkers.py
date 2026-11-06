"""One worker per container; shared queue claims, private files and sandbox ID."""
from pathlib import Path
import os
import shutil
import signal
import time
import traceback

import psycopg2
import judge
from DTO.submission import SubmissionDTO
from DTO.result import ResultDTO
from constants.Enums import SubmissionStatus
from handle import testEnv
from keyword_rules import policy_rejection
from postgresql import dbQuery as database
from postgresql.dbConfig import dbConfig
from worker_control import register, start_heartbeat
from worker_queue import QueueWakeup, claim, lock_worker, persist, recover_owned, unlock_user, retry_exhausted, release_memory, begin_evaluation, retry_full_compilation
from memory_reservations import on_evaluation_ready, compilation_profile, needs_full_compilation, FullCompilationRequired
from grader_safety import JobWatchdog, watchdog_stage
from sandbox_security import release_sandbox
import compile_pipeline as pipeline
import compiler_dispatch as dispatch
import cf_grading

WORKER = int(os.environ['OTOG_WORKER_ID'])
if WORKER not in ((7, 8, 9, 10, 11, 12, 13, 14, 15, 16) if os.environ.get('OTOG_WORKER_ROLE') == 'compiler' else (1, 2, 3, 4, 5, 6, 7)):
    raise RuntimeError('Invalid OTOG worker ID')
stopping = False
original_init_isolate = judge.initIsolate


def require_isolate(use_control_group):
    box = original_init_isolate(use_control_group)
    if box is None:
        raise RuntimeError('Sandbox initialization failed; submission execution refused.')
    return box


judge.initIsolate = require_isolate


def stop_after_job(signum, frame):
    global stopping
    stopping = True


def prepare_problem(problem_id):
    """Share immutable large test data; copy checker sources to private files."""
    shared = Path('/usr/src/app/shared-source') / str(int(problem_id))
    private = Path('source') / str(int(problem_id))
    if private.exists():
        shutil.rmtree(private)
    if not shared.is_dir():
        return str(private)
    private.mkdir(parents=True)
    for directory, dirs, files in os.walk(shared):
        relative = Path(directory).relative_to(shared)
        destination = private / relative
        destination.mkdir(parents=True, exist_ok=True)
        for filename in files:
            original = Path(directory) / filename
            target = destination / filename
            if original.suffix in ('.in', '.sol'):
                target.symlink_to(original)
            elif filename != 'binCheck':
                shutil.copy2(original, target)
    return str(private)


def progress_reporter(update, clock=time.monotonic):
    """Keep progress visible once per second; final results commit separately."""
    last_saved = float('-inf')

    def report(*args):
        nonlocal last_saved
        if clock() - last_saved < 1.0:
            return
        with watchdog_stage('saving testcase progress', 30):
            update(*args)
        last_saved = clock()

    return report


def main():
    global stopping
    signal.signal(signal.SIGTERM, stop_after_job)
    signal.signal(signal.SIGINT, stop_after_job)
    delegated = dispatch.assigned()
    startup = JobWatchdog(45, f'worker-{WORKER}-startup')
    startup.attach()
    startup.arm(stage='worker startup')
    try:
        testEnv()
        with watchdog_stage('main database connection', 15):
            database.DBConnect()
        conn = database.db.conn
        with watchdog_stage('worker registration and recovery', 30):
            with conn.cursor() as cursor:
                cursor.execute("SELECT set_config('application_name',%s,false)", (f'otog-worker-{WORKER}',))
            if not delegated:
                lock_worker(conn, WORKER)
                register(conn, WORKER)
                heartbeat_stop = start_heartbeat(dbConfig, WORKER)
                wakeup = QueueWakeup(dbConfig)
                recovered = recover_owned(conn, WORKER)
            else:
                heartbeat_stop = wakeup = None
                recovered = []
                with watchdog_stage('loading assigned compiler job', 15):
                    delegated_job = dispatch.read(conn, WORKER)
        release_sandbox()
        if not delegated:
            pipeline.cleanup_owned(conn, WORKER)
            release_memory(conn, WORKER)
    finally:
        startup.cancel()
    print(f'WORKER {WORKER} ready; recovered jobs={recovered}', flush=True)
    while not stopping:
        if delegated:
            # This process runs exactly one job already claimed by the sole
            # dispatcher. It never registers a worker or polls the queue.
            job = delegated_job
            stopping = True
        else:
            idle = JobWatchdog(30, f'worker-{WORKER}-queue')
            idle.attach()
            idle.arm(stage='queue admission')
            try:
                # This does not need a job or free-memory admission. It also
                # reclaims any stale scratch left before startup/idle recovery.
                release_sandbox()
                pipeline.collect(conn)
                with watchdog_stage('queue claim', 30):
                    job = claim(conn, WORKER)
                if not job:
                    with watchdog_stage('queue notification wait', 15):
                        wakeup.wait()
                    continue
            finally:
                idle.cancel()
        print(f'WORKER {WORKER} claimed submission {job.id}', flush=True)
        watchdog = None
        try:
            watchdog = JobWatchdog(60.0, job.id)
            watchdog.attach()
            watchdog.arm()
            if retry_exhausted(conn, job.id):
                submission = SubmissionDTO(job.id, job.userId, job.problemId, '', job.contestId,
                    job.sourceCode, job.language, job.maxScore, job.timeLimit, job.memoryLimit, job.case, 'classic')
                result = ResultDTO(job.id, 'Judge Error', 0, 0, 0,
                    'Grading was interrupted twice; automatic retries stopped. Please contact an administrator.',
                    SubmissionStatus.judgeError, [])
                persist(conn, database, submission, result, WORKER)
                print(f'WORKER {WORKER} stopped repeated interrupted grading for submission {job.id}', flush=True)
                continue
            progress = progress_reporter(database.updateRunningInCase)
            with watchdog_stage('problem preparation', 120):
                submission = SubmissionDTO(
                    id=job.id, userId=job.userId, problemId=job.problemId,
                    problemPath=prepare_problem(job.problemId), contestId=job.contestId,
                    sourceCode=job.sourceCode, language=job.language, maxScore=job.maxScore,
                    timeLimit=job.timeLimit, memoryLimit=job.memoryLimit, testcase=job.case,
                    mode='classic')
            cf_job = cf_grading.lookup(conn, submission.id)
            with watchdog_stage('submission rule lookup', 30):
                rejected = None if cf_job else policy_rejection(submission, conn)
            if rejected is not None:
                persist(conn, database, submission, rejected, WORKER)
            else:
                full_compilation = getattr(job, 'fullCompilation', True)
                if getattr(job, 'pipelineStage', 'legacy') == 'legacy' and not full_compilation and needs_full_compilation(
                        job.language, job.memoryLimit, submission.problemPath):
                    # An admin may add a checker/command between claim and
                    # copying the private problem files. Retry before compiling.
                    raise FullCompilationRequired('Problem preparation requires full compilation.')
                if cf_job:
                    with compilation_profile(True):
                        cf_grading.run(conn, submission, cf_job,
                            lambda result: persist(conn, database, submission, result, WORKER), progress)
                else:
                    with pipeline.context(job, submission), compilation_profile(full_compilation), on_evaluation_ready(lambda ml, custom: begin_evaluation(
                            conn, WORKER, job.id, ml, custom)):
                        judge.startJudge(
                            submission, lambda result: persist(conn, database, submission, result, WORKER),
                            progress, lambda *args: None)
            print(f'WORKER {WORKER} completed submission {job.id}', flush=True)
        except pipeline.CompilationStaged:
            release_sandbox()
            pipeline.handoff(conn, WORKER, job)
            print(f'WORKER {WORKER} compiled submission {job.id}; queued for execution', flush=True)
        except pipeline.ArtifactInvalid:
            release_sandbox()
            pipeline.handoff(conn, WORKER, job, bypass=True)
            print(f'WORKER {WORKER} invalidated artifact {job.id}; queued for normal compilation', flush=True)
        except FullCompilationRequired:
            # The smaller first attempt is not a verdict or an infrastructure
            # failure. Clean before atomically returning it to the queue; the
            # durable profile gives its next claim the original full allowance.
            release_sandbox()
            retry_full_compilation(conn, WORKER, job.id)
            print(f'WORKER {WORKER} queued full-memory compilation retry for submission {job.id}', flush=True)
        except psycopg2.Error:
            # Let Docker restart this worker. Its exclusive lease will then
            # requeue the interrupted job; never invent a contestant verdict.
            raise
        except Exception as exc:
            traceback.print_exc()
            conn.rollback()
            with conn.cursor() as cursor:
                cursor.execute('SELECT status FROM submission WHERE id=%s', (job.id,))
                row = cursor.fetchone()
            if row and row[0] == 'grading':
                error_result = ResultDTO(job.id, 'Judge Error', 0, 0, 0,
                                         f'Worker error: {type(exc).__name__}', SubmissionStatus.judgeError, [])
                # No testcase fabrication; report an administrative error
                # that remains rejudgeable, instead of a permanently stuck job.
                submission = SubmissionDTO(job.id, job.userId, job.problemId, '', job.contestId,
                                           job.sourceCode, job.language, job.maxScore,
                                           job.timeLimit, job.memoryLimit, job.case, 'classic')
                persist(conn, database, submission, error_result, WORKER)
            # An unexpected exception can leave Isolate or the private tree
            # unusable while this process still sends healthy heartbeats.
            # Persist first: startup recovery must not requeue the poison job.
            # Docker's existing restart policy then discards the sandbox tmpfs.
            print(f'WORKER {WORKER} recovery restart after submission {job.id}; '
                  f'error={type(exc).__name__}', flush=True)
            raise SystemExit(70) from exc
        finally:
            try:
                try:
                    release_sandbox()
                    pipeline.cleanup_owned(conn, WORKER)
                    release_memory(conn, WORKER)
                except Exception:
                    # This runs outside the result exception handler: never
                    # overwrite or requeue an already committed verdict.
                    traceback.print_exc()
                    print(f'WORKER {WORKER} retiring after scratch cleanup failure; '
                          f'submission={job.id}; committed results preserved', flush=True)
                    raise SystemExit(70)
            finally:
                try:
                    unlock_user(conn, job.userId)
                finally:
                    if watchdog is not None:
                        watchdog.cancel()
    if wakeup is not None:
        wakeup.close()
    database.DBDisconnect()
    if heartbeat_stop is not None:
        heartbeat_stop.set()


if __name__ == '__main__':
    main()
