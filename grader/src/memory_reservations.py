"""Phase-aware shared judging allowances; no contestant timing changes.

The queue snapshots a pool only when no reservations exist. Subtracting full
reservations from a fresh MemAvailable reading would count resident job memory
twice. Within an epoch, claims spend that fixed pool instead. The independent
fresh 1536 MiB admission guard still applies to every claim.
The initial allowance shrinks only after contestant/checker compilation ends.
"""
from pathlib import Path
from contextlib import contextmanager
import threading
import os
from memory_guard import MIN_AVAILABLE_KIB, parse_available_kib
from grader_safety import JudgeInfrastructureError

MIB = 1024
JOB_PADDING_KIB = 256 * MIB
# Compilation is allowed 768 MiB; initially cover that plus scratch overhead.
# After compilation, evaluation_kib releases the excess. These are scheduling
# allowances, not replacement sandbox/container memory limits.
MIN_JOB_KIB = 1024 * MIB
# Ordinary code first compiles within 384 MiB; failures retain the existing
# one-time retry at the original 768 MiB limit. Keep the 256 MiB job padding.
FAST_COMPILE_MEMORY_KIB = 384 * MIB
FULL_COMPILE_MEMORY_KIB = 768 * MIB
MIN_FAST_JOB_KIB = FAST_COMPILE_MEMORY_KIB + JOB_PADDING_KIB
# Strict compilation policy: 512 MiB total admission allowance per compile.
# The compiler address-space limit leaves 128 MiB for scheduler/scratch overhead.
STRICT_COMPILE_BUDGET = os.environ.get(
    'OTOG_STRICT_COMPILE_BUDGET', os.environ.get('OTOG_DEDICATED_COMPILER', '0')) == '1'
COMPILE_PADDING_KIB = JOB_PADDING_KIB
if STRICT_COMPILE_BUDGET:
    FAST_COMPILE_MEMORY_KIB = FULL_COMPILE_MEMORY_KIB = 384 * MIB
    COMPILE_PADDING_KIB = 128 * MIB
    MIN_FAST_JOB_KIB = 512 * MIB
# Coupled custom-checker jobs keep their existing full initial envelope;
# checker execution can need 512 MiB plus the normal 256 MiB padding.
PEAK_SPARE_KIB = 512 * MIB
MEMORY_LOCK = 140014
CHECKER_KIB = 512 * MIB
_phase = threading.local()


def read_snapshot_kib():
    try:
        content = Path('/proc/meminfo').read_text(encoding='ascii')
        available = parse_available_kib(content)
        if available is None:
            return None
        total = next(int(line.split()[1]) for line in content.splitlines()
                     if line.startswith('MemTotal:'))
        return total, available
    except (OSError, UnicodeError, ValueError, StopIteration):
        return None


class FullCompilationRequired(JudgeInfrastructureError):
    """Retry once at the original compiler limit; never a contestant verdict."""


def reservation_kib(memory_limit_mib, full_compilation=True):
    if type(memory_limit_mib) is not int or not 1 <= memory_limit_mib <= 1048576:
        raise ValueError('Invalid problem memory limit; claim refused.')
    if type(full_compilation) is not bool:
        raise ValueError('Invalid compilation profile.')
    return max(MIN_JOB_KIB if full_compilation else MIN_FAST_JOB_KIB,
               memory_limit_mib * MIB + JOB_PADDING_KIB)


def needs_full_compilation(language, memory_limit_mib, problem_path):
    reservation_kib(memory_limit_mib)
    if language not in ('c', 'cpp', 'python') or memory_limit_mib >= 768:
        return True
    try:
        problem = Path(problem_path)
        if not problem.is_dir():
            return True
        return any((problem / name).exists() for name in (
            'check.cpp', 'thaco.cpp', 'partial.cpp', 'interactive_script.py', 'command.yaml'))
    except OSError:
        return True


@contextmanager
def compilation_profile(full_compilation):
    if type(full_compilation) is not bool:
        raise ValueError('Invalid compilation profile.')
    previous = getattr(_phase, 'full_compilation', True)
    _phase.full_compilation = full_compilation
    try:
        yield
    finally:
        _phase.full_compilation = previous


def compilation_memory_kib():
    return FULL_COMPILE_MEMORY_KIB if getattr(_phase, 'full_compilation', True) else FAST_COMPILE_MEMORY_KIB


def evaluation_kib(memory_limit_mib, custom_checker):
    # Validate the same ML snapshot that the initial claim used. A custom
    # checker runs after the contestant has exited, so use max, not their sum.
    reservation_kib(memory_limit_mib)
    if type(custom_checker) is not bool:
        raise ValueError('Invalid checker classification.')
    return max(memory_limit_mib * MIB, CHECKER_KIB if custom_checker else 0) + JOB_PADDING_KIB


@contextmanager
def on_evaluation_ready(callback):
    """Per-job opt-in; standalone grading retains its existing interface."""
    previous = getattr(_phase, 'callback', None)
    _phase.callback = callback
    try:
        yield
    finally:
        _phase.callback = previous


def evaluation_ready(memory_limit_mib, custom_checker):
    callback = getattr(_phase, 'callback', None)
    if callback is not None:
        callback(memory_limit_mib, custom_checker)


def pool_kib(snapshot):
    if not isinstance(snapshot, tuple) or len(snapshot) != 2:
        return None
    total, available = snapshot
    if (type(total) is not int or type(available) is not int or
            total <= 0 or not 0 <= available <= total or available < MIN_AVAILABLE_KIB):
        return None
    # Keep at least 1536 MiB outside the judging budget in total, including
    # existing OS/services. Also leave 512 MiB of the currently available RAM
    # uncommitted for their growth. The 1536 MiB pre-claim guard is unchanged;
    # it is not a promise that 1536 MiB remains free at a job's memory peak.
    return max(0, min(total - MIN_AVAILABLE_KIB, available - PEAK_SPARE_KIB))
