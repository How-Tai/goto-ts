from DTO.testcaseData import TestcaseData
from constants.Enums import VerdictStatus
from grader_safety import JudgeInfrastructureError, watchdog_phase


_CHUNK = 65536


def _line(stream):
    """Describe one rstripped line without retaining an arbitrarily long line."""
    prefix = stream.readline(_CHUNK)
    if not prefix:
        return None
    if len(prefix) < _CHUNK or prefix.endswith('\n'):
        trimmed = prefix.rstrip()
        return len(trimmed), trimmed, None, None
    tail_start = stream.tell()
    length = len(prefix)
    significant = len(prefix.rstrip())
    while True:
        chunk = stream.readline(_CHUNK)
        if not chunk:
            break
        trimmed = chunk.rstrip()
        if trimmed:
            significant = length + len(trimmed)
        length += len(chunk)
        if chunk.endswith('\n'):
            break
    return significant, prefix, tail_start, stream.tell()


def _same_line(left, right, user, reference):
    # Historically, EOF compares equal to a trailing whitespace-only line.
    left = left or (0, '', None, None)
    right = right or (0, '', None, None)
    length = left[0]
    if length != right[0]:
        return False
    head = min(length, _CHUNK)
    if left[1][:head] != right[1][:head]:
        return False
    if length <= _CHUNK:
        return True
    user.seek(left[2])
    reference.seek(right[2])
    remaining = length - _CHUNK
    while remaining:
        count = min(remaining, _CHUNK)
        if user.read(count) != reference.read(count):
            return False
        remaining -= count
    user.seek(left[3])
    reference.seek(right[3])
    return True


def _remaining_whitespace(stream):
    # Once the other stream reaches EOF, legacy comparison accepts only
    # whitespace. Scan bounded blocks instead of one Python call per blank line.
    while True:
        chunk = stream.read(_CHUNK)
        if not chunk:
            return True
        if chunk.strip():
            return False


def _identical_text(user, reference):
    """Fast common case; decoding and newline normalization still apply.

    On any mismatch or decoding failure the caller rewinds both streams and
    uses the original line comparison, including its error precedence.
    """
    try:
        while True:
            left = user.read(_CHUNK)
            right = reference.read(_CHUNK)
            if left != right:
                return False
            if not left:
                return True
    except UnicodeDecodeError:
        return False


@watchdog_phase('standard answer checking', 60)
def getVerdict(testCaseDto: TestcaseData):
    try:
        with open(testCaseDto.userPath, encoding='utf-8') as f1, open(testCaseDto.solPath, encoding='utf-8') as f2:
            if _identical_text(f1, f2):
                return (VerdictStatus.accept, 1.0)
            f1.seek(0)
            f2.seek(0)
            while True:
                try:
                    f1_line = _line(f1)
                except UnicodeDecodeError:
                    # Invalid contestant text is a mismatch, not a worker fault.
                    return (VerdictStatus.reject, 0.0)
                try:
                    f2_line = _line(f2)
                except UnicodeDecodeError as exc:
                    raise JudgeInfrastructureError('Reference output is not valid UTF-8.') from exc
                if f1_line is None and f2_line is None:
                    return (VerdictStatus.accept, 1.0)
                if f2_line is None:
                    if f1_line[0] != 0:
                        return (VerdictStatus.reject, 0.0)
                    try:
                        whitespace = _remaining_whitespace(f1)
                    except UnicodeDecodeError:
                        return (VerdictStatus.reject, 0.0)
                    return (VerdictStatus.accept, 1.0) if whitespace else (VerdictStatus.reject, 0.0)
                if f1_line is None:
                    if f2_line[0] != 0:
                        return (VerdictStatus.reject, 0.0)
                    try:
                        whitespace = _remaining_whitespace(f2)
                    except UnicodeDecodeError as exc:
                        raise JudgeInfrastructureError('Reference output is not valid UTF-8.') from exc
                    return (VerdictStatus.accept, 1.0) if whitespace else (VerdictStatus.reject, 0.0)
                if not _same_line(f1_line, f2_line, f1, f2):
                    return (VerdictStatus.reject, 0.0)
    except OSError as exc:
        raise JudgeInfrastructureError('Standard checker could not read its files.') from exc
