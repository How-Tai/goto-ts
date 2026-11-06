"""One queue dispatcher admits multiple concurrent, isolated compilation jobs."""
import os
import signal
import secrets
import ctypes
from pathlib import Path
import subprocess
import sys
import time

import compile_pipeline as pipeline
import compiler_dispatch as dispatch
from grader_safety import JobWatchdog, watchdog_stage
from postgresql.dbInit import init as open_connection
from postgresql.dbConfig import dbConfig
from worker_control import register, start_heartbeat
from worker_queue import QueueWakeup, claim, lock_worker, recover_owned, release_memory, retry_exhausted, persist

SLOTS = dispatch.SLOTS
JOB_DEADLINE_SECONDS = 300
SHUTDOWN_SECONDS = 90
PREPARE_SECONDS = 90
RETRY_PREPARE_SECONDS = 2
stopping = False


def stop(signum, frame):
    global stopping
    stopping = True


def launch(slot, token=None):
    env = dict(os.environ, OTOG_WORKER_ID=str(slot), OTOG_WORKER_ROLE='compiler',
               OTOG_COMPILER_ASSIGNED_JOB='1')
    if token is not None:
        env['OTOG_COMPILER_WARM_TOKEN'] = token
    return subprocess.Popen([sys.executable, str(dispatch.__file__), '--launch',
        str(os.getpid()), str(slot)], env=env, stdin=subprocess.PIPE if token is not None else subprocess.DEVNULL, start_new_session=True)


def terminate(process):
    # Killing the launcher also kills its PID-namespace init and all descendants.
    # Reap it before recovering the lease or releasing any memory allowance.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=15)
    if process.stdin is not None:
        process.stdin.close()


def reap_orphans(managed):
    """Reap adopted namespace inits without consuming Popen return statuses."""
    owned = {process.pid for process, _, _ in managed.values()}
    for raw in Path('/proc/thread-self/children').read_text().split():
        pid = int(raw)
        if pid in owned:
            continue
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass


def recover(conn, slot):
    recovered = recover_owned(conn, slot)
    pipeline.cleanup_owned(conn, slot)
    release_memory(conn, slot)
    dispatch.remove(slot)
    return recovered


def quarantine(conn, slot, job):
    # Admission failures must also have a bounded retry budget, even if a job
    # runner cannot start far enough to apply its own retry check.
    from DTO.submission import SubmissionDTO
    from DTO.result import ResultDTO
    from constants.Enums import SubmissionStatus
    from postgresql import dbQuery as database
    database.db.conn = conn
    submission = SubmissionDTO(job.id, job.userId, job.problemId, '', job.contestId,
        job.sourceCode, job.language, job.maxScore, job.timeLimit, job.memoryLimit, job.case, 'classic')
    result = ResultDTO(job.id, 'Judge Error', 0, 0, 0,
        'Compilation was interrupted twice; automatic retries stopped. Please contact an administrator.',
        SubmissionStatus.judgeError, [])
    persist(conn, database, submission, result, slot)
    recover(conn, slot)


def main():
    # Killing a namespace launcher can orphan its init before unshare reaps it.
    # Adopt those descendants even when tests do not run this dispatcher as PID 1.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'Could not supervise compiler descendants')
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    children = {}
    tokens = {}
    retry_prepare = {}
    heartbeats = []
    conn = wakeup = None
    shutdown_started = None
    next_admission = 0.0
    guard = JobWatchdog(45, 'compiler-dispatcher')
    guard.attach()
    guard.arm(stage='compiler dispatcher startup')
    try:
        if os.sched_getaffinity(0) != {dispatch.CPU_ID}:
            raise RuntimeError(f'Compiler dispatcher requires only VM CPU {dispatch.CPU_ID}; no jobs claimed.')
        with watchdog_stage('compiler dispatcher database connection', 15):
            conn = open_connection()
        with watchdog_stage('compiler dispatcher registration and recovery', 45):
            with conn.cursor() as cursor:
                cursor.execute("SELECT set_config('application_name','otog-compiler-dispatcher',false)")
            conn.commit()
            # Both slot locks deliberately belong to ONE backend/dispatcher.
            for slot in SLOTS:
                lock_worker(conn, slot)
            for slot in SLOTS:
                register(conn, slot)
                with conn.cursor() as cursor:
                    cursor.execute('UPDATE "otogCompilerState" SET "cpuId"=%s WHERE "workerId"=%s',
                                   (dispatch.CPU_ID, slot))
                conn.commit()
                recover(conn, slot)  # Container startup guarantees old children have stopped.
                heartbeats.append(start_heartbeat(dbConfig, slot))
            wakeup = QueueWakeup(dbConfig)
        print(f'COMPILER dispatcher ready; pid={os.getpid()} slots={len(SLOTS)}', flush=True)
        while True:
            guard.arm(stage='compiler dispatch loop')
            now = time.monotonic()
            if stopping and shutdown_started is None:
                shutdown_started = now
            for slot, (process, started, submission_id) in list(children.items()):
                prepared = submission_id is None and dispatch.ready(slot, tokens[slot])
                expired = now - started > (JOB_DEADLINE_SECONDS if submission_id is not None else PREPARE_SECONDS) and not prepared
                if submission_id is None and stopping:
                    terminate(process)
                shutdown_expired = shutdown_started is not None and now - shutdown_started > SHUTDOWN_SECONDS
                if process.poll() is None and (expired or shutdown_expired):
                    print(f'COMPILER dispatcher terminating stuck job {submission_id} in slot {slot}', flush=True)
                    terminate(process)
                if process.poll() is not None:
                    process.wait()
                    if process.stdin is not None:
                        process.stdin.close()
                    with watchdog_stage('compiler job recovery and cleanup', 45):
                        recovered = recover(conn, slot)
                    del children[slot]
                    tokens.pop(slot, None)
                    if submission_id is None:
                        retry_prepare[slot] = time.monotonic() + RETRY_PREPARE_SECONDS
                    next_admission = 0.0
                    print(f'COMPILER dispatcher finished slot {slot}; job={submission_id} '
                          f'exit={process.returncode} recovered={recovered}', flush=True)
            reap_orphans(children)
            if stopping:
                if not children:
                    return
            else:
                pipeline.collect(conn)
                if now >= next_admission:
                    with watchdog_stage('compiler concurrency setting', 15):
                        with conn.cursor() as cursor:
                            cursor.execute('SELECT "maxCompilerJobs" FROM "otogGradingSettings" WHERE id=1')
                            policy = cursor.fetchone()
                            cursor.execute('SELECT "workerId" FROM "otogCompilerState" WHERE enabled')
                            enabled_slots = {row[0] for row in cursor.fetchall()}
                        conn.commit()
                    if policy is None or type(policy[0]) is not int or not 1 <= policy[0] <= len(SLOTS):
                        raise RuntimeError('Invalid compiler job limit.')
                    compiler_limit = policy[0]
                if now >= next_admission:
                    # Lowering the limit only retires unused runners. Active jobs drain.
                    for slot in sorted(children, reverse=True):
                        if len(children) <= compiler_limit:
                            break
                        process, _, submission_id = children[slot]
                        if submission_id is None:
                            terminate(process)
                            recover(conn, slot)
                            del children[slot]
                            tokens.pop(slot)
                    active = sum(job is not None for _, _, job in children.values())
                    for slot, (process, _, submission_id) in list(children.items()):
                        if active >= compiler_limit or stopping:
                            break
                        if submission_id is not None or slot not in enabled_slots or not dispatch.ready(slot, tokens[slot]):
                            continue
                        with watchdog_stage('compiler queue admission', 30):
                            job = claim(conn, slot)
                        if job is None:
                            # As with a regular grader: one unsuccessful claim,
                            # then wait for work instead of repeating the same
                            # admission scan for every unused compiler slot.
                            break
                        if retry_exhausted(conn, job.id):
                            # Recover removes the ready marker; retire this unused runner.
                            terminate(process)
                            quarantine(conn, slot, job)
                            del children[slot]
                            tokens.pop(slot)
                            print(f'COMPILER dispatcher quarantined repeatedly interrupted job {job.id}', flush=True)
                            continue
                        dispatch.publish(conn, slot, job, tokens[slot])
                        children[slot] = (process, time.monotonic(), job.id)
                        process.stdin.write((tokens[slot] + '\n').encode())
                        process.stdin.flush()
                        process.stdin.close()
                        active += 1
                        print(f'COMPILER dispatcher assigned job {job.id} to prepared slot {slot}; '
                              f'active={active}', flush=True)
                    # A used namespace is never reused. Replacements prepare before
                    # claiming any job, using no per-job memory reservation while idle.
                    for slot in SLOTS:
                        if len(children) >= compiler_limit or stopping:
                            break
                        if slot in children or now < retry_prepare.get(slot, 0):
                            continue
                        dispatch.remove(slot)
                        token = secrets.token_hex(16)
                        process = launch(slot, token)
                        tokens[slot] = token
                        children[slot] = (process, time.monotonic(), None)
                if now >= next_admission:
                    next_admission = time.monotonic() + .5
            active_or_preparing = any(job is not None or not dispatch.ready(slot, tokens[slot])
                                      for slot, (_, _, job) in children.items())
            if active_or_preparing:
                time.sleep(.1)
            elif not stopping:
                with watchdog_stage('compiler queue notification wait', 15):
                    wakeup.wait()
                next_admission = 0.0
    finally:
        # Keep dispatcher locks until every launched sandbox has stopped.
        # On fatal errors Docker restarts the service and performs recovery.
        for process, _, _ in children.values():
            terminate(process)
        reap_orphans({})
        for heartbeat in heartbeats:
            heartbeat.set()
        if wakeup is not None:
            wakeup.close()
        if conn is not None:
            conn.close()
        guard.cancel()


if __name__ == '__main__':
    main()
