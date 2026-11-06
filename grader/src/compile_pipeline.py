"""Bounded, submission-specific binary handoff between the six trusted workers.

Contestant processes never see this store: its mount is below /usr/src, which
Isolate masks. Artifacts are regular files copied independently into fresh boxes.
There is no cross-submission cache, executable deserialization, or pickle input.
"""
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import os
import re
import stat
import threading
import time
import uuid

from memory_reservations import (MEMORY_LOCK, MIB, JOB_PADDING_KIB, COMPILE_PADDING_KIB,
    FAST_COMPILE_MEMORY_KIB, FULL_COMPILE_MEMORY_KIB, evaluation_kib)
from grader_safety import watchdog_phase

ROOT = Path('/usr/src/app/compile-cache')
MAX_COMPILERS = 10 if os.environ.get('OTOG_DEDICATED_COMPILER') == '1' else 3
MAX_READY = 12
MAX_BINARY_BYTES = 64 * 1024**2
MAX_STORE_BYTES = 768 * 1024**2
TOKEN = re.compile(r'[0-9a-f]{32}\Z')
SOURCE = re.compile(r'temp[A-Za-z0-9]{5}\.(?:cpp|c)\Z')
_local = threading.local()
_last_gc = 0.0


class CompilationStaged(Exception):
    """Successful compilation; publication occurs after sandbox cleanup."""


class ArtifactInvalid(Exception):
    """Never recompile while holding only an execution-sized reservation."""


def enabled():
    return os.environ.get('OTOG_COMPILE_PIPELINE') == '1'


def dedicated():
    return os.environ.get('OTOG_DEDICATED_COMPILER') == '1'


def compiler():
    return os.environ.get('OTOG_WORKER_ROLE') == 'compiler'


def queue_problem_ids():
    """Fresh eligibility snapshot for one queue claim, never a persistent cache."""
    root = Path('/usr/src/app/shared-source')
    return sorted(int(p.name) for p in root.iterdir()
                  if p.name.isascii() and p.name.isdigit() and eligible('cpp', p))


def queue_filter(alias, problem_ids=None):
    # Only trusted integer directory names enter SQL. A grader reuses one fresh
    # snapshot across its three predicates; per-job validation remains fresh.
    ids = queue_problem_ids() if problem_ids is None else problem_ids
    numbers = ','.join(str(i) for i in ids) or '-1'
    plain = f"({alias}.language IN ('c','cpp') AND {alias}.\"problemId\" IN ({numbers}))"
    staged = f"EXISTS (SELECT 1 FROM \"otogCompiledArtifact\" QP WHERE QP.\"submissionId\"={alias}.id AND QP.state IN ('ready','evaluating','bypass'))"
    return f'({plain} AND NOT {staged})' if compiler() else f'(NOT {plain} OR {staged})'


def eligible(language, problem):
    if language not in ('cpp', 'c'):
        return False
    p = Path(problem)
    try:
        if not p.is_dir() or p.is_symlink():
            return False
        # Auxiliary source/custom commands/checkers retain the existing path.
        # This keeps their compilation inputs and semantics completely intact.
        for f in p.iterdir():
            if f.name in ('command.yaml', 'interactive_script.py'):
                return False
            if f.suffix in ('.c', '.cpp', '.h', '.hpp', '.py'):
                return False
        return True
    except OSError:
        return False


def fingerprint(job, problem):
    if not eligible(job.language, problem):
        return None
    from cmdManager import get
    payload = [1, 'otog-grader:security-20261016', job.id, job.problemId,
               job.language, job.sourceCode, get(job.language, 'compile')]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False,
        separators=(',', ':')).encode()).hexdigest()


def plan(cursor, job, full, remaining, budget):
    cursor.execute('SELECT * FROM "otogCompiledArtifact" WHERE "submissionId"=%s', (job.id,))
    names = [c[0] for c in cursor.description]
    values = cursor.fetchone()
    artifact = dict(zip(names, values)) if values else None
    if artifact and artifact['state'] in ('compiling', 'evaluating'):
        return None
    if artifact and artifact['state'] == 'ready':
        return {'stage': 'evaluate', 'amount': evaluation_kib(job.memoryLimit, False),
                'full': full, 'artifact': artifact}
    if artifact and artifact['state'] == 'bypass':
        return {'stage': 'legacy'}
    compiler_full = bool(job.fullCompilation)
    amount = (FULL_COMPILE_MEMORY_KIB if compiler_full else FAST_COMPILE_MEMORY_KIB) + COMPILE_PADDING_KIB
    if not dedicated() and evaluation_kib(job.memoryLimit, False) <= amount:
        # The coupled path already covers both phases with this allowance.
        # Avoid a disk/queue round trip when separating them saves no memory.
        return {'stage': 'legacy'}
    shared = Path('/usr/src/app/shared-source') / str(job.problemId)
    key = fingerprint(job, shared)
    if evaluation_kib(job.memoryLimit, False) > budget:
        # Do not fill the bounded ready store with jobs that cannot execute
        # even after every running job drains at this epoch's memory budget.
        return {'stage': 'legacy'}
    if key is None or artifact and artifact['state'] == 'bypass':
        return {'stage': 'legacy'}
    if dedicated() and compiler():
        # Keep space for the oldest ready executable. Otherwise two dedicated
        # compilers could repeatedly consume the allowance needed by graders.
        cursor.execute('''SELECT P."memoryLimit" FROM "otogCompiledArtifact" A
            JOIN submission S ON S.id=A."submissionId"
            JOIN problem P ON P.id=S."problemId"
            WHERE A.state='ready' AND S.status='waiting'
              AND P."memoryLimit" BETWEEN 1 AND 1048576
              AND P."memoryLimit"::bigint*1024+%s<=%s
            ORDER BY S."creationDate",S.id LIMIT 1''', (JOB_PADDING_KIB,budget))
        ready = cursor.fetchone()
        if ready and amount + evaluation_kib(ready[0], False) > remaining:
            return None
    # The compiler profile depends on prior compilation failure, not on the
    # program's future execution ML. No execution allowance is held here.
    full = compiler_full
    cursor.execute('''SELECT COUNT(*) FILTER(WHERE state='compiling'),
        COUNT(*) FILTER(WHERE state!='bypass'),COALESCE(SUM("sizeBytes"),0)
        FROM "otogCompiledArtifact" WHERE state!='bypass' ''')
    compiling, count, size = cursor.fetchone()
    compiler_limit = MAX_COMPILERS
    if dedicated():
        # claim() holds the settings row and memory admission lock until commit.
        cursor.execute('SELECT "maxCompilerJobs" FROM "otogGradingSettings" WHERE id=1')
        row = cursor.fetchone()
        if row is None or type(row[0]) is not int or not 1 <= row[0] <= 10:
            raise RuntimeError('Compiler job limit is not configured.')
        compiler_limit = min(compiler_limit, row[0])
    if compiling >= compiler_limit or count >= MAX_READY or size + MAX_BINARY_BYTES > MAX_STORE_BYTES:
        return None
    return {'stage': 'compile', 'amount': amount, 'full': full,
            'artifact': {'token': uuid.uuid4().hex, 'fingerprint': key}}


def claim_stage(cursor, worker, job, choice):
    if choice['stage'] == 'compile':
        a = choice['artifact']
        cursor.execute('''INSERT INTO "otogCompiledArtifact"
            ("submissionId",state,"ownerWorkerId",token,fingerprint,"sizeBytes")
            VALUES (%s,'compiling',%s,%s,%s,%s)''',
            (job.id, worker, a['token'], a['fingerprint'], MAX_BINARY_BYTES))
    elif choice['stage'] == 'evaluate':
        cursor.execute('''UPDATE "otogCompiledArtifact" SET state='evaluating',
            "ownerWorkerId"=%s,"updatedAt"=NOW() WHERE "submissionId"=%s AND state='ready' ''',
            (worker, job.id))
        if cursor.rowcount != 1:
            raise RuntimeError('Compiled artifact was already claimed.')
    return SimpleNamespace(**job._asdict(), pipelineStage=choice['stage'],
                           compiledArtifact=choice.get('artifact'))


def _root():
    info = ROOT.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Unsafe compiled artifact root.')
    return ROOT


def _directory(token):
    if not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise RuntimeError('Invalid compiled artifact identity.')
    return _root() / token


def remove(token):
    p = _directory(token)
    try:
        info = p.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISLNK(info.st_mode):
        p.unlink()
        return
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('Unsafe compiled artifact directory.')
    # Bounded flat layout. Never recurse or follow links supplied by a binary.
    entries = list(p.iterdir())
    if len(entries) > 2 or any(f.name not in ('out', '.out.tmp') for f in entries):
        raise RuntimeError('Unexpected compiled artifact contents.')
    for f in entries:
        if stat.S_ISDIR(f.lstat().st_mode):
            raise RuntimeError('Unsafe compiled artifact file.')
        f.unlink()
    p.rmdir()


def _copy(source, destination, expected_size=None, expected_digest=None):
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_BINARY_BYTES:
            raise ArtifactInvalid('Invalid compiled binary size/type.')
        if expected_size is not None and info.st_size != expected_size:
            raise ArtifactInvalid('Compiled binary size changed.')
        digest = hashlib.sha256()
        with os.fdopen(fd, 'rb') as inp:
            fd = None
            with destination.open('xb') as out:
                remaining = info.st_size
                while remaining:
                    chunk = inp.read(min(65536, remaining))
                    if not chunk:
                        raise ArtifactInvalid('Truncated compiled binary.')
                    digest.update(chunk); out.write(chunk); remaining -= len(chunk)
                if inp.read(1):
                    raise ArtifactInvalid('Compiled binary grew during transfer.')
        value = digest.hexdigest()
        if expected_digest is not None and value != expected_digest:
            destination.unlink()
            raise ArtifactInvalid('Compiled binary checksum changed.')
        return info.st_size, value
    finally:
        if fd is not None:
            os.close(fd)


@contextmanager
def context(job, submission):
    previous = getattr(_local, 'job', None)
    _local.job = (job, submission)
    try:
        yield
    finally:
        _local.job = previous


def source_name():
    pair = getattr(_local, 'job', None)
    if pair and getattr(pair[0], 'pipelineStage', None) == 'evaluate':
        name = pair[0].compiledArtifact['sourceName']
        if not isinstance(name, str) or not SOURCE.fullmatch(name):
            raise ArtifactInvalid('Invalid compiled source filename.')
        return name
    return None


@watchdog_phase('restoring compiled submission', 45)
def restore(box, source, command):
    pair = getattr(_local, 'job', None)
    if not pair or getattr(pair[0], 'pipelineStage', None) != 'evaluate':
        return False
    job, sub = pair; a = job.compiledArtifact
    if fingerprint(job, sub.problemPath) != a['fingerprint']:
        raise ArtifactInvalid('Compilation inputs changed.')
    if Path(source).name != a['sourceName']:
        raise ArtifactInvalid('Compiled source identity changed.')
    p = _directory(a['token'])
    try:
        info = p.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise ArtifactInvalid('Unsafe binary directory.')
        _copy(p/'out', Path(box)/'out', a['sizeBytes'], a['digest'])
        (Path(box)/'out').chmod(0o755)
        owner = Path(box).stat()
        os.chown(Path(box)/'out', owner.st_uid, owner.st_gid)
    except OSError as exc:
        raise ArtifactInvalid('Compiled artifact unavailable; recompilation required.') from exc
    return True


@watchdog_phase('staging compiled submission', 45)
def completed(box, source):
    pair = getattr(_local, 'job', None)
    if not pair or getattr(pair[0], 'pipelineStage', None) != 'compile':
        return
    job, sub = pair; a = job.compiledArtifact
    if fingerprint(job, sub.problemPath) != a['fingerprint']:
        raise ArtifactInvalid('Compilation inputs changed during compilation.')
    name = Path(source).name
    if not SOURCE.fullmatch(name):
        raise ArtifactInvalid('Unexpected compiler source filename.')
    allowed = {name, 'out', '.tmp', '.shm', 'error.txt', 'compile-output.txt'}
    for f in Path(box).iterdir():
        if f.name not in allowed:
            raise ArtifactInvalid('Compiler produced auxiliary files; use normal grading.')
        if f.name in ('.tmp', '.shm') and (f.is_symlink() or not f.is_dir() or any(f.iterdir())):
            raise ArtifactInvalid('Compiler retained temporary files; use normal grading.')
    p = _directory(a['token']); p.mkdir(mode=0o700)
    size, digest = _copy(Path(box)/'out', p/'.out.tmp')
    (p/'.out.tmp').chmod(0o600)
    (p/'.out.tmp').rename(p/'out')
    a.update(sourceName=name, sizeBytes=size, digest=digest)
    raise CompilationStaged()


def _drop_attempt(cursor, sid):
    # A deliberate stage handoff is not an interrupted execution attempt.
    cursor.execute('DELETE FROM "otogWorkerAttempt" WHERE "submissionId"=%s AND attempts=1', (sid,))
    cursor.execute('UPDATE "otogWorkerAttempt" SET attempts=attempts-1 WHERE "submissionId"=%s AND attempts>1', (sid,))


@watchdog_phase('publishing compiled submission', 30)
def handoff(conn, worker, job, bypass=False):
    """Caller has stopped all processes and finished sandbox cleanup."""
    a = job.compiledArtifact
    if bypass:
        remove(a['token'])
    try:
        with conn.cursor() as c:
            c.execute('SELECT pg_advisory_xact_lock(%s,1)', (MEMORY_LOCK,))
            c.execute('''SELECT S.status FROM submission S JOIN "otogWorkerJob" J ON J."submissionId"=S.id
                WHERE S.id=%s AND J."workerId"=%s FOR UPDATE OF S''', (job.id, worker))
            if c.fetchone() != ('grading',):
                raise RuntimeError('Compilation handoff lost its submission lease.')
            if bypass:
                c.execute('''UPDATE "otogCompiledArtifact" SET state='bypass',"ownerWorkerId"=NULL,
                    "sizeBytes"=0,"updatedAt"=NOW() WHERE "submissionId"=%s AND "ownerWorkerId"=%s''', (job.id,worker))
            else:
                c.execute('''UPDATE "otogCompiledArtifact" SET state='ready',"ownerWorkerId"=NULL,
                    "sourceName"=%s,"sizeBytes"=%s,digest=%s,"updatedAt"=NOW()
                    WHERE "submissionId"=%s AND "ownerWorkerId"=%s AND state='compiling' ''',
                    (a['sourceName'],a['sizeBytes'],a['digest'],job.id,worker))
            if c.rowcount != 1:
                raise RuntimeError('Compilation handoff lost its artifact lease.')
            _drop_attempt(c, job.id)
            c.execute("SELECT set_config('otog.internal_stage_handoff','on',true)")
            c.execute('UPDATE submission SET status=\'waiting\',"updateDate"=NOW() WHERE id=%s', (job.id,))
            c.execute('DELETE FROM "otogWorkerJob" WHERE "submissionId"=%s AND "workerId"=%s',(job.id,worker))
            c.execute('DELETE FROM "otogWorkerMemoryReservation" WHERE "submissionId"=%s AND "workerId"=%s',(job.id,worker))
            c.execute("SELECT pg_notify('otog_queue_wakeup','compiled-ready')")
        conn.commit()
    except Exception:
        conn.rollback(); raise


@watchdog_phase('compiled artifact cleanup', 30)
def cleanup_owned(conn, worker):
    """Only after owning the worker lock, stopping processes and cleaning its box."""
    if not enabled():
        return
    try:
        with conn.cursor() as c:
            c.execute('SELECT pg_advisory_xact_lock(%s,1)', (MEMORY_LOCK,))
            c.execute('SELECT token FROM "otogCompiledArtifact" WHERE "ownerWorkerId"=%s FOR UPDATE', (worker,))
            for token, in c.fetchall():
                remove(token)
            c.execute('DELETE FROM "otogCompiledArtifact" WHERE "ownerWorkerId"=%s', (worker,))
        conn.commit()
    except Exception:
        conn.rollback(); raise


@watchdog_phase('compiled artifact expiry', 30)
def collect(conn):
    global _last_gc
    if not enabled() or time.monotonic() - _last_gc < 30:
        return
    try:
        with conn.cursor() as c:
            c.execute('SELECT pg_advisory_xact_lock(%s,1)', (MEMORY_LOCK,))
            c.execute('''DELETE FROM "otogCompiledArtifact" A WHERE state='ready'
                AND ("updatedAt"<NOW()-interval '15 minutes' OR NOT EXISTS
                    (SELECT 1 FROM submission S WHERE S.id=A."submissionId" AND S.status='waiting'))
                RETURNING token''')
            for token, in c.fetchall():
                remove(token)
            c.execute('SELECT token FROM "otogCompiledArtifact"')
            active = {r[0] for r in c.fetchall()}
            for p in _root().iterdir():
                if TOKEN.fullmatch(p.name) and p.name not in active:
                    remove(p.name)
        conn.commit(); _last_gc=time.monotonic()
    except Exception:
        conn.rollback(); raise
