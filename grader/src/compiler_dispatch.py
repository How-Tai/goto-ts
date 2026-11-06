"""Private, single-job handoff from the compiler dispatcher to a sandbox runner."""
from pathlib import Path
from types import SimpleNamespace
from datetime import date, datetime
from decimal import Decimal
import json
import os
import stat
import select
import sys
import re

ROOT = Path('/usr/src/app/compiler-jobs')
SLOTS = (7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
CPU_ID = int(os.environ.get('OTOG_COMPILER_CPU', '6'))
if CPU_ID < 0:
    raise ValueError('OTOG_COMPILER_CPU must be a nonnegative CPU index.')


def assigned():
    return os.environ.get('OTOG_COMPILER_ASSIGNED_JOB') == '1'


def directory():
    ROOT.mkdir(mode=0o700, exist_ok=True)
    info = ROOT.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Unsafe compiler assignment directory.')
    return ROOT


def path(slot):
    if slot not in SLOTS:
        raise RuntimeError('Invalid compiler job slot.')
    return directory() / f'{slot}.json'


def _encode(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f'Unsupported job value: {type(value).__name__}')


def publish(conn, slot, job, runner_token=None):
    target = path(slot)
    raw = json.dumps({'version': 1, 'slot': slot, 'ownerBackendPid': conn.get_backend_pid(),
                      'runnerToken': runner_token, 'job': vars(job)}, default=_encode).encode()
    temporary = target.with_suffix('.pending')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def remove(slot):
    path(slot).unlink(missing_ok=True)
    path(slot).with_suffix('.pending').unlink(missing_ok=True)
    path(slot).with_suffix('.ready').unlink(missing_ok=True)


def warm_token():
    token = os.environ.get('OTOG_COMPILER_WARM_TOKEN')
    if token is not None and not re.fullmatch(r'[0-9a-f]{32}', token):
        raise RuntimeError('Invalid prepared compiler identity.')
    return token


def ready(slot, token):
    """Only the exact root-owned, single-use runner may report readiness."""
    target = path(slot).with_suffix('.ready')
    try:
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError('Unsafe prepared compiler marker.')
        return stream.read(65) == token.encode()


def wait_for_assignment(slot, stopped):
    """Sleep on a private parent pipe; idle runners never poll the job queue."""
    token = warm_token()
    if token is None or not assigned():
        raise RuntimeError('Runner is not a prepared compiler.')
    target = path(slot).with_suffix('.ready')
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(token.encode())
    print(f'COMPILER slot {slot} prepared; waiting for assignment', flush=True)
    received = b''
    while not stopped():
        if not select.select([0], [], [], 1)[0]:
            continue
        chunk = os.read(0, 34 - len(received))
        if not chunk:
            raise RuntimeError('Compiler dispatcher assignment pipe closed.')
        received += chunk
        if b'\n' in received or len(received) >= 34:
            if received != (token + '\n').encode():
                raise RuntimeError('Compiler assignment pipe identity mismatch.')
            # No assignment channel is inherited by contestant subprocesses.
            devnull = os.open(os.devnull, os.O_RDONLY)
            os.dup2(devnull, 0)
            os.close(devnull)
            target.unlink()
            return True
    return False


def read(conn, slot):
    if not assigned() or os.environ.get('OTOG_WORKER_ROLE') != 'compiler':
        raise RuntimeError('Job runner was not launched by the compiler dispatcher.')
    descriptor = os.open(path(slot), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError('Unsafe compiler assignment file.')
        value = json.load(stream)
    if value.get('version') != 1 or value.get('slot') != slot:
        raise RuntimeError('Invalid compiler assignment.')
    if value.get('runnerToken') != warm_token():
        raise RuntimeError('Compiler assignment belongs to a different prepared runner.')
    job = SimpleNamespace(**value['job'])
    if job.pipelineStage != 'compile':
        raise RuntimeError('Compiler dispatcher assigned a non-compilation job.')
    # The dispatcher must still own both the lease and the slot's exclusive
    # session lock. Stale files never authorize a new compilation by themselves.
    with conn.cursor() as cursor:
        cursor.execute('''SELECT EXISTS (
            SELECT 1 FROM "otogWorkerJob" J
            JOIN submission S ON S.id=J."submissionId"
            JOIN "otogCompiledArtifact" A ON A."submissionId"=S.id
            JOIN pg_locks L ON L.locktype='advisory' AND L.granted
              AND L.classid=140011 AND L.objid=J."workerId"::oid AND L.objsubid=2
              AND L.pid=%s AND L.database=(SELECT oid FROM pg_database WHERE datname=current_database())
            WHERE J."workerId"=%s AND J."submissionId"=%s AND S.status='grading'
              AND A.state='compiling' AND A."ownerWorkerId"=J."workerId" AND A.token=%s)''',
            (value['ownerBackendPid'], slot, job.id, job.compiledArtifact['token']))
        valid = cursor.fetchone()[0]
    conn.commit()
    if not valid:
        raise RuntimeError('Compiler assignment no longer has a live dispatcher lease.')
    return job


if __name__ == '__main__':
    # Single-threaded launcher: no unsafe preexec_fn in the dispatcher's
    # heartbeat/watchdog threads. Its job namespace dies if the dispatcher dies.
    import ctypes
    import signal
    import sys
    if len(sys.argv) != 4 or sys.argv[1] != '--launch':
        raise SystemExit(64)
    parent, slot = int(sys.argv[2]), int(sys.argv[3])
    if slot not in SLOTS:
        raise SystemExit(64)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'Could not arm dispatcher-death signal')
    if os.getppid() != parent:
        raise SystemExit(71)
    os.sched_setaffinity(0, {CPU_ID})
    os.execv('/usr/bin/unshare', ['/usr/bin/unshare', '--mount', '--pid', '--fork',
        '--kill-child=KILL', '/bin/sh', '/usr/src/app/compiler-slot-entrypoint.sh'])
