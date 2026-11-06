"""Per-testcase kernel memory accounting, contained by the grader's Docker cgroup."""
from pathlib import Path
import os
import time
import subprocess
from grader_safety import SandboxHealthError

ROOT = Path('/sys/fs/cgroup')
WORKER_GROUP = ROOT / 'otog-worker'
SANDBOX_GROUP = ROOT / 'otog-sandboxes'


def enabled():
    return os.environ.get('OTOG_MLE_CGROUP') == '1'


def _box():
    worker = os.environ.get('OTOG_WORKER_ID', '')
    if worker not in tuple(str(i) for i in range(1, 8)):
        raise SandboxHealthError('Invalid memory accounting sandbox identity.')
    return SANDBOX_GROUP / ('box-' + worker)


def initialize():
    """PID 1 delegates memory inside this container; Docker's limits stay above it."""
    if not enabled():
        return
    if os.getpid() != 1 or Path('/proc/self/cgroup').read_text().strip() != '0::/':
        raise SandboxHealthError('Memory delegation requires the container init and a private cgroup namespace.')
    if os.environ.get('OTOG_RESTRICTED_CONTAINER') == '1':
        # Remount only the existing private cgroup namespace, never bind the
        # host hierarchy. Docker mounts it read-only in non-privileged mode.
        subprocess.run(['/bin/mount', '-o', 'remount,rw,nosuid,nodev,noexec', str(ROOT)],
                       check=True, timeout=5)
    WORKER_GROUP.mkdir(mode=0o755, exist_ok=True)
    # No contestant is running during container initialization.
    for pid in (ROOT / 'cgroup.procs').read_text().split():
        (WORKER_GROUP / 'cgroup.procs').write_text(pid)
    if (ROOT / 'cgroup.procs').read_text().strip():
        raise SandboxHealthError('Container cgroup still contains undelegated processes.')
    (ROOT / 'cgroup.subtree_control').write_text('+memory')
    SANDBOX_GROUP.mkdir(mode=0o755, exist_ok=True)
    (SANDBOX_GROUP / 'cgroup.subtree_control').write_text('+memory')
    config = Path('/run/isolate')
    config.mkdir(mode=0o755, exist_ok=True)
    path = config / 'cgroup'
    path.write_text(str(SANDBOX_GROUP) + '\n')
    path.chmod(0o644)


def cleanup():
    if not enabled():
        return
    group = _box()
    if not group.exists():
        return
    if group.is_symlink() or group.parent != SANDBOX_GROUP:
        raise SandboxHealthError('Invalid memory accounting group.')
    # Kill only this worker's dedicated box group, never the container/runtime.
    (group / 'cgroup.kill').write_text('1')
    deadline = time.monotonic() + 3
    while (group / 'cgroup.procs').read_text().strip():
        if time.monotonic() >= deadline:
            raise SandboxHealthError('Memory accounting group did not drain.')
        time.sleep(.01)
    group.rmdir()


def prepare_testcase(memory_kib):
    if not enabled():
        return False
    if not isinstance(memory_kib, int) or not 0 < memory_kib <= 1048576 * 1024:
        raise SandboxHealthError('Invalid testcase memory limit.')
    cleanup()
    group = _box()
    group.mkdir(mode=0o755)
    # Set the cap before Isolate moves the payload into this empty group.
    (group / 'memory.max').write_text(str(memory_kib * 1024))
    (group / 'memory.swap.max').write_text('0')
    (group / 'memory.oom.group').write_text('1')
    if not (group / 'memory.peak').is_file():
        raise SandboxHealthError('Kernel peak memory accounting is unavailable.')
    return True


def was_memory_killed(metadata):
    # Root-owned Isolate metadata generated from this fresh group's memory.events.
    if metadata.get('cg-oom-killed') != '1':
        return False
    if not enabled():
        return True
    events = dict(line.split() for line in (_box() / 'memory.events.local').read_text().splitlines())
    if int(events.get('oom', '0')) > 0:
        return True
    # An ancestor/container or VM OOM must not become a contestant verdict.
    raise SandboxHealthError('Sandbox was killed by external memory pressure.')
