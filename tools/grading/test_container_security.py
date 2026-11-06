"""Benign configuration probes inside a disposable container."""
from pathlib import Path
import json,os,subprocess
from sys import path
path.insert(0,'/usr/src/app/src')
from memory_limits import initialize
initialize()
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert status['NoNewPrivs'].strip()=='1' and status['Seccomp'].strip()=='2'
profile=Path('/proc/self/attr/current').read_text().strip();assert profile=='otog-grader (enforce)',profile
assert Path('/proc/self/cgroup').read_text().strip()=='0::/otog-worker'
assert subprocess.check_output(['findmnt','-no','OPTIONS','/'],text=True).startswith('ro,')
assert subprocess.run(['mount','-o','remount,rw','/'],capture_output=True).returncode!=0
assert not Path('/dev/sda').exists() and not Path('/dev/vda').exists()
assert not Path('/var/run/docker.sock').exists()
assert '2.7' in subprocess.check_output(['/usr/local/bin/isolate','--version'],text=True)
print(json.dumps({'passed':True,'noNewPrivileges':True,'outerSeccomp':True,'apparmorEnforcing':True,'rootFilesystemReadOnly':True,'rootRemountDenied':True,'privateCgroupNamespace':True,'hostDiskDevicesAbsent':True,'dockerSocketAbsent':True,'isolateVersion':'2.7'}),flush=True)
