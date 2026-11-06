"""Untrusted compilation and execution must stay inside the same private box."""
from pathlib import Path
import os
import shlex
import signal
import subprocess
import shutil
import stat
import errno
from grader_safety import SandboxHealthError, watchdog_phase, watchdog_stage
from memory_reservations import compilation_memory_kib, FullCompilationRequired, STRICT_COMPILE_BUDGET

PRIVATE_MASK = '--dir=/usr/src=/opt/otog-empty'
COMPILE_MEMORY_KIB = 786432
OUTPUT_KIB = 65536
_baseline = None


@watchdog_phase('finished-job scratch cleanup', 35)
def release_sandbox():
    """Reclaim only this worker's private scratch, even before RAM admission.

    No contestant process may be running when this is called. Result diagnostics
    and persistence finish first; a failure here requires retiring the worker.
    """
    global _baseline
    from checker_sandbox import release as release_checker
    release_checker()
    from memory_limits import cleanup as cleanup_memory_group
    cleanup_memory_group()
    worker = os.environ.get('OTOG_WORKER_ID', '0')
    root = Path('/var/local/lib/isolate')
    box = _checked_box(root / worker / 'box')
    baseline = root / '.otog-case-baseline'
    _baseline = None
    for directory in (box, baseline):
        if directory.exists() or directory.is_symlink():
            _remove_private_tree(directory)
    # These are copied out of tmpfs before checking/logging. They are not the
    # retained, bounded admin-only diagnostic records under Logging/.
    for name in ('output.txt', 'error.txt', 'isoResult.txt'):
        (Path('env') / name).unlink(missing_ok=True)


def _remove_private_tree(directory):
    """Fast fd-safe Python cleanup, with bounded coreutils fallback for depth.

    Only our exact sandbox and root-owned baseline may be removed.  GNU rm
    traverses physically (no symlink following), component by component; its
    fd-bounded traversal also handles paths deeper than Python's call stack.
    """
    worker = os.environ.get('OTOG_WORKER_ID', '0')
    if worker not in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'):
        raise SandboxHealthError('Invalid sandbox cleanup identity.')
    directory = Path(directory)
    root = Path('/var/local/lib/isolate')
    allowed = (root / worker / 'box', root / '.otog-case-baseline', root / '.otog-checker-state')
    if worker in ('1', '2', '3', '4', '5', '6', '7'):
        allowed += (root / str(100 + int(worker)) / 'box',)
    if directory not in allowed or directory.is_symlink():
        raise SandboxHealthError('Unexpected sandbox cleanup target.')
    if directory.parent.is_symlink() or directory.parent.resolve() != directory.parent:
        raise SandboxHealthError('Sandbox cleanup parent changed.')
    try:
        shutil.rmtree(directory)
        return
    except RecursionError:
        pass
    except OSError as exc:
        if exc.errno not in (errno.EMFILE, errno.ENFILE, errno.ENAMETOOLONG):
            raise
    from grader_safety import infrastructure_command
    code, _, _ = infrastructure_command(
        ['/bin/rm', '-rf', '--one-file-system', '--', str(directory)], 20)
    if code != 0 or directory.exists() or directory.is_symlink():
        raise SandboxHealthError('Deep sandbox cleanup failed; recovery required.')


def _checked_box(iso_path):
    # The production entrypoint selects --box-id=$OTOG_WORKER_ID. Disposable
    # standalone tests use Isolate's default ID 0 when no worker is configured.
    worker = os.environ.get('OTOG_WORKER_ID', '0')
    if worker not in ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'):
        raise RuntimeError('Invalid configured sandbox ID.')
    box = Path(iso_path)
    expected = Path('/var/local/lib/isolate') / worker / 'box'
    if box.is_symlink() or box.resolve() != expected:
        raise RuntimeError(f'Unexpected sandbox path {box!s} (resolved {box.resolve()!s}, expected {expected!s}); execution refused.')
    return box


def _copy_owned(source, destination):
    """Independent copies: hard links would allow mutation of the baseline."""
    shutil.copy2(source, destination, follow_symlinks=False)
    info = os.lstat(source)
    os.chown(destination, info.st_uid, info.st_gid, follow_symlinks=False)
    return destination


def _copy_tree(source, destination, ignore_logs=False):
    def ignore(folder, names):
        if ignore_logs and Path(folder) == Path(source):
            return {'error.txt', 'output.txt', 'compile-output.txt'}.intersection(names)
        return set()
    shutil.copytree(source, destination, symlinks=True, copy_function=_copy_owned, ignore=ignore)
    # copytree preserves directory modes, but not ownership.
    for folder, directories, files in os.walk(source, followlinks=False):
        relative = Path(folder).relative_to(source)
        for name in [None] + directories:
            original = Path(folder) if name is None else Path(folder) / name
            target = Path(destination) / relative
            if name is not None:
                target = target / name
            info = os.lstat(original)
            os.chown(target, info.st_uid, info.st_gid, follow_symlinks=False)


def _discard_baseline():
    global _baseline
    if _baseline is not None:
        old = _baseline
        _baseline = None
        _remove_private_tree(old['directory'])


@watchdog_phase('compiled baseline snapshot', 60)
def _save_baseline(box):
    """Keep the successfully compiled tree outside the contestant's mount view."""
    global _baseline
    box = _checked_box(box)
    directory = box.parent.parent / '.otog-case-baseline'
    if directory.is_symlink():
        raise RuntimeError('Invalid sandbox baseline directory.')
    if directory.exists():
        _remove_private_tree(directory)
    info = box.stat()
    try:
        _copy_tree(box, directory, ignore_logs=True)
        os.chown(directory, 0, 0)
        directory.chmod(0o700)
    except Exception:
        if directory.exists():
            _remove_private_tree(directory)
        raise
    _baseline = {'box': box, 'directory': directory,
                 'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}


@watchdog_phase('testcase filesystem reset', 60)
def prepare_testcase(iso_path):
    """Restore files in-process, without reinitializing Isolate or recompiling."""
    if _baseline is None or Path(iso_path) != _baseline['box']:
        raise RuntimeError('No compiled sandbox baseline; execution refused.')
    box = _baseline['box']
    if box.is_symlink():
        raise RuntimeError('Sandbox root changed; execution refused.')
    # Isolate has finished and reaped contestant processes before this is called.
    # rmtree does not traverse contestant-created symlinks.
    if box.exists():
        _remove_private_tree(box)
    _copy_tree(_baseline['directory'], box)
    os.chown(box, _baseline['uid'], _baseline['gid'])
    box.chmod(_baseline['mode'])


@watchdog_phase('testcase output collection', 60)
def copy_testcase_output(box, name, destination):
    """Do not follow a replaced stdout/stderr symlink, FIFO or device as root."""
    target = Path(destination)
    target.unlink(missing_ok=True)
    descriptor = None
    try:
        descriptor = os.open(Path(box) / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > OUTPUT_KIB * 1024:
            raise ValueError('Invalid output file.')
        with os.fdopen(descriptor, 'rb') as source:
            descriptor = None
            with target.open('wb') as output:
                shutil.copyfileobj(source, output)
        return True
    except (OSError, ValueError):
        target.write_bytes(b'')
        return False
    finally:
        if descriptor is not None:
            os.close(descriptor)


def sandbox_args(use_cgroups=False, iso_path=None):
    args = ['isolate']
    if use_cgroups:
        args.append('--cg')
    if not iso_path:
        raise RuntimeError('Private temporary directories require the initialized sandbox.')
    box = _checked_box(iso_path)
    for name in ('.tmp', '.shm'):
        folder = Path(iso_path) / name
        if folder.is_symlink():
            raise RuntimeError('Invalid sandbox temporary directory.')
        folder.mkdir(exist_ok=True)
        folder.chmod(0o1777)
    args += ['--dir=/tmp=' + str(Path(iso_path) / '.tmp') + ':rw',
             '--dir=/var/tmp=' + str(Path(iso_path) / '.tmp') + ':rw',
             '--dir=/dev/shm=' + str(Path(iso_path) / '.shm') + ':rw']
    return args + [PRIVATE_MASK, '--env=PATH=/usr/bin:/bin',
                   '--env=HOME=/box', '--env=LANG=C.UTF-8',
                   '--env=TMPDIR=/box/.tmp']


def run_bounded(args, timeout, watchdog_name='submission sandbox', **kwargs):
    with watchdog_stage(watchdog_name, max(15.0, timeout + 10.0)):
        return _run_bounded(args, timeout, **kwargs)


def _run_bounded(args, timeout, **kwargs):
    proc = subprocess.Popen(args, start_new_session=True, **kwargs)
    try:
        return proc.communicate(timeout=timeout), proc.returncode
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.communicate(timeout=5)
        raise SandboxHealthError('Sandbox did not terminate within its wall-time budget.')


@watchdog_phase('submission compilation preparation', 60)
def compile_submission(language, source_path, problem_path, iso_path, command, use_cgroups=False):
    _discard_baseline()
    if not iso_path:
        raise RuntimeError('Compilation requires an initialized sandbox.')
    box = Path(iso_path)
    if Path(source_path).resolve().parent != box.resolve():
        raise RuntimeError('Source file must be inside the initialized sandbox.')
    from compile_pipeline import restore
    if restore(box, source_path, command):
        sandbox_args(use_cgroups, box)
        Path('env/error.txt').touch()
        Path('env/output.txt').touch()
        _save_baseline(box)
        return None
    temp = box / '.tmp'
    temp.mkdir(exist_ok=True)
    temp.chmod(0o777)
    # prepareEnv already copied permitted problem libraries, excluding checkers.
    inside = '/box/' + Path(source_path).name
    cmd = command.replace('[sourcePath]', inside).replace('[problemPath]', '/box')
    cmd = cmd.replace('[binPath]', '/box/out').replace('[env]', '/box')
    cmd = cmd.replace('2>/box/error.txt', '')
    Path('env/compile-meta.txt').unlink(missing_ok=True)
    compile_memory = compilation_memory_kib()
    args = sandbox_args(use_cgroups, box) + ['--meta=compile-meta.txt', '--processes=64',
        '--time=30', '--wall-time=35', f'--mem={compile_memory}',
        f'--fsize={OUTPUT_KIB}', '--stderr=error.txt', '--stdout=compile-output.txt',
        '--run', '--', '/bin/sh', '-c', cmd]
    run_bounded(args, 40, watchdog_name='submission compilation', cwd='env', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    meta = Path('env/compile-meta.txt')
    if not meta.is_file():
        raise RuntimeError('Compiler sandbox produced no status.')
    data = dict(line.split(':', 1) for line in meta.read_text().splitlines() if ':' in line)
    if data.get('status') == 'XX':
        raise RuntimeError('Compiler sandbox reported an infrastructure error: ' + data.get('message', 'unknown'))
    if data.get('status') == 'TO':
        if not STRICT_COMPILE_BUDGET and compile_memory < COMPILE_MEMORY_KIB:
            raise FullCompilationRequired('Retry compilation with its original memory allowance.')
        return 'Compilation TLE'
    if data.get('status') or data.get('exitcode', '0') != '0' or data.get('exitsig'):
        if not STRICT_COMPILE_BUDGET and compile_memory < COMPILE_MEMORY_KIB:
            raise FullCompilationRequired('Retry compilation with its original memory allowance.')
        return 'Compilation Error'
    if language != 'python' and not (box / 'out').is_file():
        if not STRICT_COMPILE_BUDGET and compile_memory < COMPILE_MEMORY_KIB:
            raise FullCompilationRequired('Retry compilation with its original memory allowance.')
        return 'Compilation Error'
    Path('env/error.txt').touch()
    Path('env/output.txt').touch()
    _save_baseline(box)
    from compile_pipeline import completed
    completed(box, source_path)
    return None


def execution_command(language_command, source_path, iso_path):
    if not iso_path:
        raise RuntimeError('Submission execution requires an initialized sandbox.')
    command = language_command.replace('[ioRedirect]', '')
    command = command.replace('[sourcePath]', Path(source_path).name)
    command = command.replace('[binPath]', './out').replace('[uBin]', '/usr/bin/')
    return shlex.split(command)
