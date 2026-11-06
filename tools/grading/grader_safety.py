"""Infrastructure failures, bounded trusted subprocesses, and job progress guard."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import hashlib
import json
import stat
from contextlib import contextmanager
from functools import wraps

_active = threading.local()
RUNTIME_DIAGNOSTICS = Path('Logging/.grader-runtime-diagnostics')
_NATIVE_LIMIT_LAUNCHER = Path('/usr/bin/prlimit')


def record_runtime_failure(problem, testcase, language, box, meta, exit_code, output_files):
    """Best-effort admin-only bounded evidence; never change the verdict."""
    try:
        directory = RUNTIME_DIAGNOSTICS
        if directory.is_symlink():
            return False
        directory.mkdir(mode=0o700, exist_ok=True)
        directory.chmod(0o700)
        binary = {}
        descriptor = None
        try:
            descriptor = os.open(Path(box) / 'out', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            info = os.fstat(descriptor)
            if stat.S_ISREG(info.st_mode):
                prefix = os.read(descriptor, 65536)
                binary = {'size': info.st_size, 'mode': oct(stat.S_IMODE(info.st_mode)),
                          'uid': info.st_uid, 'gid': info.st_gid,
                          'sha256First64KiB': hashlib.sha256(prefix).hexdigest()}
        except OSError:
            pass
        finally:
            if descriptor is not None:
                os.close(descriptor)
        error = Path('env/error.txt')
        stderr = ''
        if error.is_file():
            with error.open('rb') as stream:
                stderr = stream.read(2048).decode('utf-8', errors='replace')
        guard = getattr(_active, 'watchdog', None)
        record = {'timestampUnixNs': time.time_ns(), 'worker': os.environ.get('OTOG_WORKER_ID'),
                  'submission': guard.job_id if guard is not None else None,
                  'problem': Path(problem).name, 'testcase': testcase, 'language': language,
                  'returnedExitCode': exit_code, 'sandboxMeta': {str(k)[:80]:str(v)[:500] for k,v in meta.items()},
                  'outputFilesValid': output_files, 'stderrFirst2KiB': stderr, 'binary': binary}
        raw = json.dumps(record, ensure_ascii=True).encode()
        if len(raw) > 16384:
            record['stderrFirst2KiB'] = '[omitted to keep record bounded]'
            record['sandboxMeta'] = {k:v for k,v in record['sandboxMeta'].items() if k in ('status','message','exitcode','exitsig','time','time-wall','max-rss','killed')}
            raw = json.dumps(record, ensure_ascii=True).encode()
        if len(raw) > 16384:
            return False
        # Sixteen fixed slots per worker; no unbounded file accumulation.
        slot = record['timestampUnixNs'] % 16
        temporary = directory / '.pending'
        descriptor = os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
                stream.flush()
            os.replace(temporary, directory / f'runtime-{slot:02d}.json')
        finally:
            temporary.unlink(missing_ok=True)
        return True
    except Exception:
        # Disk-full/permission failures in diagnostics must not turn WA/RTE
        # into a different verdict or prevent the existing recovery handler.
        return False


@contextmanager
def watchdog_stage(name, seconds):
    guard = getattr(_active, 'watchdog', None)
    if guard is None:
        yield
        return
    previous = guard.enter_stage(name, seconds)
    try:
        yield
    finally:
        # Returning from an inner operation is genuine progress. Restore the
        # caller's stage with a fresh allowance, not the inner operation's TL.
        guard.enter_stage(*previous)


def watchdog_phase(name, seconds):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            with watchdog_stage(name, seconds):
                return function(*args, **kwargs)
        return wrapped
    return decorate


class JudgeInfrastructureError(RuntimeError):
    """Administrative failure; never turn this into a contestant verdict."""


class SandboxHealthError(JudgeInfrastructureError):
    """The worker must discard its sandbox before accepting another job."""


CHECKER_MEMORY_MIB = 512


def infrastructure_command(args, timeout, cwd=None, memory_mib=None):
    if memory_mib is not None and (type(memory_mib) is not int or not 32 <= memory_mib <= 1024):
        raise ValueError('Invalid trusted subprocess memory limit.')
    if '--cleanup' in args:
        stage = 'sandbox cleanup'
    elif '--init' in args:
        stage = 'sandbox initialization'
    elif Path(args[0]).name == 'g++':
        stage = 'checker compilation'
    elif any(str(a).endswith('interactive_script.py') for a in args):
        stage = 'interactive answer checking'
    else:
        stage = 'custom checker / infrastructure operation'
    with watchdog_stage(stage, timeout + 15):
        return _infrastructure_command(args, timeout, cwd, memory_mib)


def _infrastructure_command(args, timeout, cwd=None, memory_mib=None):
    # Capture into bounded files, rather than buffering arbitrary diagnostics in RAM.
    native_launcher = _NATIVE_LIMIT_LAUNCHER.is_file()
    if native_launcher:
        wrapper = [str(_NATIVE_LIMIT_LAUNCHER),
                   '--fsize=67108864:67108864', '--core=0:0']
        if memory_mib is not None:
            limit = memory_mib * 1024 * 1024
            wrapper.append(f'--as={limit}:{limit}')
        wrapper += ['--', *args]
    else:
        # Retain the same bounded behavior on images without util-linux.
        wrapper = [sys.executable, str(Path(__file__).resolve()), '--exec']
        if memory_mib is not None:
            wrapper += ['--memory-mib', str(memory_mib)]
        wrapper += list(args)
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        # The old Python helper ignored SIGPIPE/SIGXFSZ at interpreter startup.
        # Keep the worker's Python signal dispositions on the native path.
        proc = subprocess.Popen(wrapper, cwd=cwd, stdout=out, stderr=err,
                                start_new_session=True, restore_signals=not native_launcher)
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise SandboxHealthError('Infrastructure operation exceeded its wall-time budget.') from exc
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired as exc:
                raise SandboxHealthError('Infrastructure process could not be reaped.') from exc
        out.seek(0); err.seek(0)
        return proc.returncode, out.read(65536), err.read(65536)


class JobWatchdog:
    """Only touches its own process; durable claim attempts bound crash retries."""
    def __init__(self, seconds, job_id):
        self.seconds = seconds
        self.job_id = job_id
        self.lock = threading.Lock()
        self.condition = threading.Condition(self.lock)
        self.generation = 0
        self.monitor = None
        self.stage = 'between grading stages'
        self.budget = seconds
        self.started = time.monotonic()
        self.cancelled = False
        self.deadline = None

    def attach(self):
        if getattr(_active, 'watchdog', None) not in (None, self):
            raise RuntimeError('Another job watchdog is still attached.')
        _active.watchdog = self

    def arm(self, seconds=None, stage='between grading stages'):
        self.enter_stage(stage, seconds or self.seconds)

    def enter_stage(self, name, seconds):
        with self.condition:
            previous = (self.stage, self.budget)
            if self.cancelled:
                return previous
            self.generation += 1
            self.stage = name
            self.budget = seconds
            self.started = time.monotonic()
            self.deadline = self.started + seconds
            if self.monitor is None:
                self.monitor = threading.Thread(target=self._monitor, daemon=True,
                                                name=f'grader-watchdog-{self.job_id}')
                self.monitor.start()
            self.condition.notify_all()
            return previous

    def _monitor(self):
        while True:
            with self.condition:
                if self.cancelled:
                    return
                remaining = self.deadline - time.monotonic()
                if remaining > 0:
                    self.condition.wait(remaining)
                    continue
                generation = self.generation
            # A main-thread stage transition may win the race after the lock
            # is released. _expire checks its generation before terminating.
            self._expire(generation)

    def _expire(self, generation):
        with self.lock:
            if generation != self.generation:
                return
            elapsed = time.monotonic() - self.started
            os.write(2, (f'WORKER watchdog: submission={self.job_id} stage={self.stage!r} '
                         f'elapsed={elapsed:.1f}s budget={self.budget:.1f}s; exiting for recovery\n').encode())
            os._exit(71)

    def cancel(self):
        with self.condition:
            self.generation += 1
            self.cancelled = True
            self.condition.notify_all()
        if getattr(_active, 'watchdog', None) is self:
            del _active.watchdog


if __name__ == '__main__' and sys.argv[1:2] == ['--exec']:
    # A separate, single-threaded helper avoids preexec_fn in the threaded worker.
    import resource
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    command = sys.argv[2:]
    if command[:1] == ['--memory-mib']:
        memory_mib = int(command[1])
        if not 32 <= memory_mib <= 1024:
            raise ValueError('Invalid trusted subprocess memory limit.')
        limit = memory_mib * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        command = command[2:]
    os.execvp(command[0], command)
