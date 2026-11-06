"""Worker entrypoint with memory-only cgroup delegation before starting Python."""
from pathlib import Path
import os
import sys
from memory_limits import enabled, initialize

worker = os.environ.get('OTOG_WORKER_ID', '')
if worker not in tuple(str(i) for i in range(1, 8)):
    raise RuntimeError('Invalid worker ID')
directory = Path('/opt/otog-worker-bin')
directory.mkdir(exist_ok=True)
Path('/usr/src/app/source').mkdir(exist_ok=True)
flags = '--cg --cg-memory-only ' if enabled() else ''
wrapper = directory / 'isolate'
wrapper.write_text('#!/bin/sh\nexec /usr/local/bin/isolate ' + flags + '--box-id="$OTOG_WORKER_ID" "$@"\n')
wrapper.chmod(0o755)
os.environ['PATH'] = str(directory) + ':' + os.environ['PATH']
initialize()
os.execv(sys.executable, [sys.executable, '-u', 'src/mainWorkers.py'])
