"""Per-submission checker compilation and unprivileged, isolated execution.

Checkers get a separate UID/PID/network/filesystem namespace and fresh memory
counters. No database environment or worker paths are passed to the sandbox.
The compiled binary exists only until the current job's teardown.
"""
from pathlib import Path
import os
import re
import shutil
import stat
import time
from grader_safety import SandboxHealthError, infrastructure_command, watchdog_phase

ROOT = Path('/var/local/lib/isolate')
STATE = ROOT / '.otog-checker-state'
MAX_FILE = 64 * 1024 * 1024
_session = None
_initialized = False
_box_identity = None


def _id():
    worker = os.environ.get('OTOG_WORKER_ID', '')
    if worker not in tuple(str(i) for i in range(1, 8)):
        raise SandboxHealthError('Invalid checker sandbox identity.')
    return 100 + int(worker)


def _native():
    return ['/usr/local/bin/isolate', '--cg', '--cg-memory-only', '--box-id=' + str(_id())]


def _read_regular(path, limit=65536):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SandboxHealthError('Checker file is not a bounded regular file.')
        return stream.read(limit)


def _copy_regular(source, target, mode=0o444, limit=MAX_FILE):
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SandboxHealthError('Checker input is not a bounded regular file.')
        with Path(target).open('xb') as destination:
            shutil.copyfileobj(stream, destination, 65536)
    Path(target).chmod(mode)


def _clear_group():
    # The native --run call has returned. Drain only this checker's private
    # group before touching files; never carry processes or counters forward.
    from memory_limits import SANDBOX_GROUP
    group = SANDBOX_GROUP / ('box-' + str(_id()))
    if not group.exists():
        return group
    if group.is_symlink() or group.parent.resolve() != SANDBOX_GROUP:
        raise SandboxHealthError('Unexpected checker memory group.')
    (group / 'cgroup.kill').write_text('1')
    deadline = time.monotonic() + 3
    while (group / 'cgroup.procs').read_text().strip():
        if time.monotonic() >= deadline:
            raise SandboxHealthError('Checker memory group did not drain.')
        time.sleep(.01)
    group.rmdir()
    return group


def _fresh_group(memory_kib):
    from memory_limits import SANDBOX_GROUP
    if Path('/run/isolate/cgroup').read_text().strip() != str(SANDBOX_GROUP):
        raise SandboxHealthError('Unexpected checker memory delegation.')
    group = _clear_group()
    group.mkdir(mode=0o755)
    (group / 'memory.max').write_text(str(memory_kib * 1024))
    (group / 'memory.swap.max').write_text('0')
    (group / 'memory.oom.group').write_text('1')


def _new_box():
    global _initialized, _box_identity
    box = ROOT / str(_id()) / 'box'
    if box.is_symlink() or box.resolve() != box:
        raise SandboxHealthError('Unexpected checker sandbox path.')
    if not _initialized:
        # --init itself resets an existing box. Namespace creation still
        # happens independently on EVERY --run, not here.
        code, _, _ = infrastructure_command(_native() + ['--init'], 20)
        if code:
            raise SandboxHealthError('Checker sandbox initialization failed.')
        _initialized = True
        info = box.stat()
        _box_identity = (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
    else:
        _clear_group()
        from sandbox_security import _remove_private_tree
        _remove_private_tree(box)
        box.mkdir(mode=_box_identity[2])
        os.chown(box, _box_identity[0], _box_identity[1])
    return box


def _run(command, seconds, memory_kib, problem, testcase_files=()):
    _fresh_group(memory_kib)
    box = ROOT / str(_id()) / 'box'
    for name in ('.tmp', '.shm'):
        directory = box / name
        directory.mkdir(mode=0o1777)
        directory.chmod(0o1777)
    meta = Path('env/checker-meta.txt').resolve()
    meta.unlink(missing_ok=True)
    args = _native() + [
        '--dir=/usr/src=/opt/otog-empty', '--dir=/problem=' + str(problem),
        '--dir=/tmp=' + str(box / '.tmp') + ':rw',
        '--dir=/var/tmp=' + str(box / '.tmp') + ':rw',
        '--dir=/dev/shm=' + str(box / '.shm') + ':rw',
        '--env=PATH=/usr/bin:/bin', '--env=HOME=/box', '--env=LANG=C.UTF-8',
        '--env=TMPDIR=/tmp', '--meta=' + str(meta),
        '--stdout=checker-stdout.txt', '--stderr=checker-stderr.txt',
        '--processes=64', '--time=' + str(seconds), '--wall-time=' + str(seconds),
        '--mem=' + str(memory_kib), '--cg-mem=' + str(memory_kib),
        '--fsize=65536']
    for name, original in testcase_files:
        args.append('--dir=/problem/' + name + '=' + str(original))
    args += ['--run', '--', *command]
    code, _, native_error = infrastructure_command(args, seconds + 5)
    if not meta.is_file():
        raise SandboxHealthError('Checker sandbox produced no status: ' + native_error[:1024].decode(errors='replace'))
    metadata = dict(line.split(':', 1) for line in meta.read_text().splitlines() if ':' in line)
    if metadata.get('status') == 'XX':
        raise SandboxHealthError('Checker sandbox reported an infrastructure error.')
    if code or metadata.get('status') or metadata.get('exitcode', '0') != '0':
        # Checker diagnostics can contain hidden input/answers. Never include
        # them in the submission error returned to the contestant.
        raise RuntimeError('PROBLEM\nChecker failed within its resource limits.')


@watchdog_phase('isolated checker compilation', 135)
def prepare(problem, filename):
    global _session
    problem = Path(problem).resolve()
    if filename not in ('check.cpp', 'thaco.cpp', 'partial.cpp', 'interactive_script.py'):
        raise SandboxHealthError('Unknown checker implementation.')
    # Repeated type lookups in the same job need not compile twice. release()
    # runs after every job, including failures, so nothing is cached across jobs.
    if _session == (problem, filename):
        return
    release()
    STATE.mkdir(mode=0o700)
    helpers = STATE / 'problem'
    helpers.mkdir(mode=0o755)
    for directory, dirs, files in os.walk(problem, followlinks=False):
        relative = Path(directory).relative_to(problem)
        target = helpers / relative
        target.mkdir(mode=0o755, parents=True, exist_ok=True)
        for name in dirs:
            if (Path(directory) / name).is_symlink():
                raise SandboxHealthError('Problem helper directory must not be a symlink.')
        for name in files:
            if re.fullmatch(r'\d+\.(?:in|sol)', name) or name == 'binCheck':
                continue
            original = Path(directory) / name
            mode = 0o555 if original.stat().st_mode & 0o111 else 0o444
            _copy_regular(original, target / name, mode)
    _session = (problem, filename)
    if filename.endswith('.cpp'):
        box = _new_box()
        _run(['/usr/bin/g++', '/problem/' + filename, '-O2', '-std=c++17',
              '-fomit-frame-pointer', '-o', '/box/binCheck'], 120, 768 * 1024, helpers)
        _copy_regular(box / 'binCheck', STATE / 'binCheck', 0o555)


@watchdog_phase('isolated custom answer checking', 75)
def run(style, testcase, problem):
    if _session is None or _session[0] != Path(problem).resolve():
        raise SandboxHealthError('Checker was not prepared for this job.')
    number = int(testcase.testCase)
    if number < 1:
        raise SandboxHealthError('Invalid checker testcase.')
    box = _new_box()
    _copy_regular(testcase.userPath, box / 'output.txt')
    _copy_regular(testcase.srcPath, box / 'submission.txt')
    helpers = STATE / 'problem'
    # Large immutable testcase data are bind-mounted read-only by a fresh
    # directory rule, without copying them into scratch or exposing other cases.
    mounts = STATE / 'case'
    if mounts.exists():
        shutil.rmtree(mounts)
    shutil.copytree(helpers, mounts)
    testcase_files = []
    for extension in ['in', 'sol']:
        original = Path(problem) / (str(number) + '.' + extension)
        if original.exists():
            # Trusted testcase links are resolved here; the contestant never
            # supplies this path. Use a file bind rather than copying large data.
            target = mounts / original.name
            resolved = original.resolve(strict=True)
            if resolved.stat().st_mode & stat.S_IROTH:
                target.touch(mode=0o444)
                testcase_files.append((original.name, resolved))
            else:
                # Existing admin uploads may be 0600/0660. Preserve their host
                # permissions; expose an independent, read-only current-case
                # copy only inside this checker's bounded scratch space.
                _copy_regular(resolved, target, limit=256 * 1024 * 1024)
    if style == 'cpp':
        _copy_regular(STATE / 'binCheck', box / 'binCheck', 0o555)
        command = ['/box/binCheck', '/problem/' + str(number) + '.sol',
                   '/problem/' + str(number) + '.in', '/box/submission.txt']
    elif style == 'thaco':
        _copy_regular(STATE / 'binCheck', box / 'binCheck', 0o555)
        command = ['/box/binCheck', '/problem/' + str(number) + '.in',
                   '/problem/' + str(number) + '.sol', '/box/output.txt']
    elif style == 'python':
        command = ['/usr/bin/python3', '/problem/interactive_script.py',
                   '/box/output.txt', '/problem/', str(number)]
    else:
        raise SandboxHealthError('Invalid checker style.')
    _run(command, 60, 512 * 1024, mounts, testcase_files)
    return _read_regular(box / ('grader_result.txt' if style == 'cpp' else 'checker-stdout.txt'))


@watchdog_phase('checker scratch cleanup', 30)
def release():
    global _session, _initialized, _box_identity
    if _initialized:
        code, _, _ = infrastructure_command(_native() + ['--cleanup'], 20)
        if code:
            raise SandboxHealthError('Checker sandbox cleanup failed.')
        _initialized = False
        _box_identity = None
    _session = None
    if STATE.exists() or STATE.is_symlink():
        from sandbox_security import _remove_private_tree
        _remove_private_tree(STATE)
