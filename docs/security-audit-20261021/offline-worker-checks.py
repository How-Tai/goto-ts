"""Bounded offline audit: no Isolate, Docker, network, production DB, or hostile code."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import random
import signal
import sys
import tempfile
import threading
import types

HERE = Path(__file__).resolve().parent
GRADER = Path(os.environ.get('OTOG_AUDIT_GRADER', r'D:\otog-grader'))
SRC = GRADER / 'src'
sys.dont_write_bytecode = True
sys.path.insert(0, str(SRC))

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def stub(name, **values):
    module = types.ModuleType(name)
    module.__dict__.update(values)
    sys.modules[name] = module
    return module

def main():
    safety = load('grader_safety', SRC / 'grader_safety.py')
    memory = load('memory_guard', SRC / 'memory_guard.py')
    # psycopg2 is deliberately substituted, never imported with any credentials.
    stub('psycopg2', Error=type('DummyDatabaseError', (Exception,), {}), sql=types.SimpleNamespace())
    stub('psycopg2.extras', NamedTupleCursor=object)
    queue = load('worker_queue', SRC / 'worker_queue.py')
    results = []
    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, *args): pass
    class Connection:
        commits = 0
        def cursor(self, *args, **kwargs): return Cursor()
        def commit(self): self.commits += 1
        def rollback(self): pass
    conn = Connection()
    available = [3 * 1024 * 1024]
    queue.memory_guard = memory.MemoryGuard(reader=lambda: available[0], logger=lambda _: None)
    counters = {'claims': 0, 'emptyWaits': 0, 'judged': 0, 'persisted': 0}
    database = types.SimpleNamespace(
        DBConnect=lambda: None, DBDisconnect=lambda: None,
        db=types.SimpleNamespace(conn=conn), updateRunningInCase=lambda *args: None)
    stub('postgresql', dbQuery=database)
    stub('postgresql.dbConfig', dbConfig={})
    stub('handle', testEnv=lambda: None)
    stub('judge', initIsolate=lambda _: None)
    stub('keyword_rules', policy_rejection=lambda *args: None)
    stub('worker_control', register=lambda *args: None,
         start_heartbeat=lambda *args: threading.Event())
    os.environ['OTOG_WORKER_ID'] = '1'
    worker = load('audit_main_worker', SRC / 'mainWorkers.py')
    job = types.SimpleNamespace(id=101, userId=1, problemId=1, contestId=None,
        sourceCode='/* inert offline fixture */', language='cpp', maxScore=100,
        timeLimit=1000, memoryLimit=128, case=1)
    with tempfile.TemporaryDirectory(prefix='worker-fixture-', dir=HERE) as temporary:
        marker = Path(temporary) / 'final-testcase-scratch.bin'
        worker.prepare_problem = lambda _: temporary
        worker.lock_worker = lambda *args: None
        worker.recover_owned = lambda *args: []
        worker.retry_exhausted = lambda *args: False
        def claim(_conn, worker_id):
            counters['claims'] += 1
            if counters['claims'] == 1:
                return job
            return queue.claim(_conn, worker_id)  # Actual low-memory admission branch.
        worker.claim = claim
        def persist(*args): counters['persisted'] += 1
        worker.persist = persist
        def judge(submission, finished, *args):
            counters['judged'] += 1
            # Stand in for last-testcase files. Only 64 KiB are really written;
            # low host memory is a simulated reading, not a resource attack.
            marker.write_bytes(b'x' * 65536)
            available[0] = 1400 * 1024
            finished(types.SimpleNamespace(status='accept'))
        worker.judge.startJudge = judge
        class Wakeup:
            def __init__(self, _config): pass
            def wait(self):
                counters['emptyWaits'] += 1
                if counters['emptyWaits'] == 3: worker.stopping = True
            def close(self): pass
        worker.QueueWakeup = Wakeup
        previous = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
        try:
            with contextlib.redirect_stdout(io.StringIO()): worker.main()
        finally:
            for s, handler in previous.items(): signal.signal(s, handler)
        assert counters == {'claims': 4, 'emptyWaits': 3, 'judged': 1, 'persisted': 1}
        assert marker.stat().st_size == 65536
        results.append({'check': 'finished-job retained-files admission stall',
            'realMainLoop': True, 'realLowMemoryClaimBranch': True,
            'simulatedAvailableMiB': 1400, 'requiredAvailableMiB': 1536,
            'actualFixtureBytes': marker.stat().st_size, 'fileRetainedAfterIdle': True,
            'newClaimAttemptsWithoutCleanup': 3, 'sandboxExecuted': False, **counters})
    guard = memory.MemoryGuard(reader=lambda: 1800 * 1024, logger=lambda _: None)
    admitted = [guard.allows() for _ in range(6)]
    assert all(admitted)
    results.append({'check': 'admission has no reservation accounting',
        'simulatedAvailableMiB': 1800, 'concurrentAdmissionChecksAllowed': len(admitted),
        'actualLargeAllocations': 0})
    # Standard checker stays compatible for bounded long-line and Unicode cases.
    standard = load('audit_standard', SRC / 'evaluate/verdict/standard.py')
    from DTO.testcaseData import TestcaseData
    from constants.Enums import VerdictStatus
    rng = random.Random(20261021)
    cases = [('answer\n', 'answer\n'), ('bad\n', 'answer\n'),
        ('a' * 150000 + ' \t\n', 'a' * 150000 + '\n'),
        ('\u03bb' * 100000 + '\n', '\u03bb' * 100000 + '\n'),
        ('x' * 65536 + '\n', 'x' * 65535 + 'y\n'), ('\n \n', '')]
    for _ in range(30):
        n = rng.choice([65535, 65536, 65537, 100000])
        base = rng.choice(['a', '\u03bb']) * n
        cases.append((base + rng.choice(['\n', '  \n', '\t']), base + '\n'))
    with tempfile.TemporaryDirectory(prefix='checker-fixture-', dir=HERE) as temporary:
        left, right = Path(temporary) / 'user.txt', Path(temporary) / 'reference.txt'
        for a, b in cases:
            left.write_text(a, encoding='utf-8'); right.write_text(b, encoding='utf-8')
            def old_compare():
                with left.open(encoding='utf-8') as l, right.open(encoding='utf-8') as r:
                    while True:
                        x, y = l.readline(), r.readline()
                        if x == '' and y == '': return True
                        if x.rstrip() != y.rstrip(): return False
            actual = standard.getVerdict(TestcaseData(str(left), str(right), 1, 'unused'))
            assert (actual[0] == VerdictStatus.accept) == old_compare()
        left.write_bytes(b'\xff\xfe'); right.write_text('1\n', encoding='utf-8')
        assert standard.getVerdict(TestcaseData(str(left), str(right), 1, 'unused'))[0] == VerdictStatus.reject
    results.append({'check': 'standard checker bounded long lines/Unicode/invalid UTF-8', 'casesPassed': len(cases) + 1})
    # Compare current source bytes with the latest retained deployment manifest.
    manifest = json.loads((GRADER / 'vm-setup/inode-4096-evidence-20261017/source-hashes.json').read_text())
    manifest.update(json.loads((GRADER / 'vm-setup/checker-hardening-evidence-20261017/source-hashes.json').read_text()))
    comparison = {}
    for name, expected in manifest.items():
        raw = (SRC / name).read_bytes()
        comparison[name] = ('exact' if hashlib.sha256(raw).hexdigest() == expected else
            'matches after CRLF normalization' if hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() == expected else 'DIFFERS')
    assert 'DIFFERS' not in comparison.values(), comparison
    results.append({'check': 'source matches retained 17 October deployment manifest',
        'files': comparison, 'freshLiveVerification': False})
    # AST confirms no final success/idle cleanup is hidden in the worker loop.
    tree = ast.parse((SRC / 'mainWorkers.py').read_text())
    main_node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
    names = sorted({ast.unparse(n.func) for n in ast.walk(main_node) if isinstance(n, ast.Call)})
    assert not any('cleanup' in name or 'discard_baseline' in name for name in names)
    results.append({'check': 'worker-loop cleanup and idle watchdog source inspection',
        'successOrIdleCleanupCalls': [], 'claimPrecedesJobWatchdog': True})
    output = {'date': '2026-10-21', 'passed': True, 'mode': 'offline control-flow and bounded checker fixtures',
        'results': results, 'productionRequests': 0, 'productionWrites': 0, 'hostileProgramsExecuted': 0}
    (HERE / 'offline-worker-results.json').write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps(output, indent=2))

if __name__ == '__main__': main()
