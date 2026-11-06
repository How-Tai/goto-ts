"""Fail CI when fresh-install containment or native compatibility drifts."""
from pathlib import Path
import json, subprocess, sys, yaml

root = Path(__file__).resolve().parents[1]
for retired in ['docker-compose.local.yml', 'docker-compose.test.yml', 'docker-compose.httpSync.yml', 'docker-compose.prod.balance.yml', 'installIsolate.sh', 'deployment/tests/test-six-workers.sh', 'deployment/tests/test-worker-kill-runtime.sh']:
    assert not (root/retired).exists(), 'Retired unsafe entry point returned: '+retired
caps = {'SYS_ADMIN', 'NET_ADMIN', 'SYS_CHROOT', 'SETUID', 'SETGID', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'KILL'}
def verify(config):
    for name, service in config['services'].items():
        assert service.get('privileged') is False, name
        assert service['read_only'] is True
        assert service['cap_drop'] == ['ALL'] and set(service['cap_add']) == caps
        assert set(service['security_opt']) == {'no-new-privileges:true', 'apparmor=otog-grader'}
        assert service['mem_limit'] == service['memswap_limit'] == '1536m'
        assert service['pids_limit'] == 128
        assert service.get('pid') != 'host' and service.get('cgroup') != 'host'
        assert service['volumes'] == ['../apps/api/source:/usr/src/app/shared-source:ro']
        assert len(service['tmpfs']) == 7 and all('size=' in value for value in service['tmpfs'])
        assert service['environment']['OTOG_RESTRICTED_CONTAINER'] == service['environment']['OTOG_MLE_CGROUP'] == '1'
verify(yaml.safe_load((root/'docker-compose.prod.yml').read_text()))
output=root/'docker-compose.workers.verify.yml'
try:
    subprocess.run([sys.executable,str(root/'deployment/render-workers.py'),'--workers','7','--output',str(output)],check=True)
    rendered=yaml.safe_load(output.read_text());verify(rendered)
    assert len(rendered['services'])==7
    assert [v['cpuset'] for v in rendered['services'].values()]==[str(i) for i in range(7)]
finally:
    output.unlink(missing_ok=True)
pin='8f185bb37f3f23e29b33b0c7727c91c13429abe3'
for name in ['Dockerfile','Dockerfile.glibc']:
    docker=(root/name).read_text()
    assert pin in docker and 'apply --check' in docker and 'isolate-2.7-hardened.patch' in docker
    assert 'b5e87ec' not in docker
patch=(root/'deployment/isolate-2.7-hardened.patch').read_text()
assert 'cg-memory-only' in patch and 'Directory ancestry changed' in patch
assert 'mle_bootstrap.py' in (root/'worker-entrypoint.sh').read_text()
print(json.dumps({'passed':True,'hardenedComposeAndRenderer':True,'nativePinAndPatches':True}))
