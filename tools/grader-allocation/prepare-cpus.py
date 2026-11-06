"""Repair saved Docker CPU masks after the VM's CPU count changes."""
from pathlib import Path
import json
import subprocess

ONLINE = Path('/sys/devices/system/cpu/online')
SERVICES = ('otog-postgres-1', 'otog-minio-1')
WORKERS = tuple('otog-grader' + (str(i) if i > 1 else '') + '-1' for i in range(1, 8))


def parse_cpu_list(value):
    cpus = set()
    for item in value.strip().split(','):
        bounds = item.split('-')
        if len(bounds) > 2 or not all(x.isascii() and x.isdigit() for x in bounds):
            raise ValueError('Invalid online CPU list')
        first, last = int(bounds[0]), int(bounds[-1])
        if first > last or last > 4095:
            raise ValueError('Invalid online CPU range')
        cpus.update(range(first, last + 1))
    return sorted(cpus)


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=30)


def prepare():
    online = parse_cpu_list(ONLINE.read_text())
    service_mask = str(online[-1])
    grader_cpus = online[:-1][:len(WORKERS)]
    masks = dict.fromkeys(SERVICES, service_mask)
    masks.update({name: str(grader_cpus[i]) if i < len(grader_cpus) else service_mask
                  for i, name in enumerate(WORKERS)})
    containers = json.loads(docker('inspect', *masks))
    for container in containers:
        name = container['Name'].lstrip('/')
        current = container['HostConfig']['CpusetCpus']
        # Keep valid running assignments until the allocator can see active leases.
        if not container['State']['Running'] or (current and not set(parse_cpu_list(current)).issubset(online)):
            if current != masks[name]:
                docker('update', '--cpuset-cpus', masks[name], name)
        if not container['State']['Running']:
            docker('start', name)
    print(json.dumps({'onlineCpus': online, 'maxGraders': len(grader_cpus)}), flush=True)


if __name__ == '__main__':
    prepare()
