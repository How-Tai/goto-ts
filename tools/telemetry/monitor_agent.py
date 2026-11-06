"""Loopback-only, read-only VM telemetry; bounded history, no third-party packages."""
import collections
import datetime
import http.client
import json
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MIB = 1024 * 1024
CONTAINERS = ('otog-postgres-1', 'otog-minio-1', 'otog-grader-1',
              'otog-grader2-1', 'otog-grader3-1', 'otog-grader4-1',
              'otog-grader5-1', 'otog-grader6-1', 'otog-grader7-1')
UNITS = ('otog-api.service', 'otog-web.service', 'nginx.service', 'otog-ngrok.service')


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_meminfo():
    values = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        name, rest = line.split(':', 1)
        values[name] = int(rest.split()[0]) / 1024
    return values


def memory_point(values):
    cache = max(0, values['Cached'] + values.get('SReclaimable', 0) - values.get('Shmem', 0))
    buffers = values['Buffers']
    used = max(0, values['MemTotal'] - values['MemFree'] - cache - buffers)
    return {'memoryUsedMb': round(used, 2), 'memoryCacheMb': round(cache, 2),
            'memoryBuffersMb': round(buffers, 2),
            'memoryFreeMb': round(values['MemFree'], 2),
            'swapUsedMb': round(values['SwapTotal'] - values['SwapFree'], 2)}


def cpu_point(before, after):
    empty = dict.fromkeys(('cpuUser', 'cpuSystem', 'cpuWait', 'cpuIdle', 'cpuSteal'))
    if before is None or len(before) < 8 or len(after) < 8: return empty
    delta = [a - b for a, b in zip(after[:8], before[:8])]
    # iowait can decrease on Linux. Do not turn a counter discontinuity into a spike.
    if any(value < 0 for value in delta): return empty
    total = sum(delta)
    if not total: return empty
    return {'cpuUser': round(100 * (delta[0] + delta[1]) / total, 2),
            'cpuSystem': round(100 * (delta[2] + delta[5] + delta[6]) / total, 2),
            'cpuWait': round(100 * delta[4] / total, 2),
            'cpuIdle': round(100 * delta[3] / total, 2),
            'cpuSteal': round(100 * delta[7] / total, 2)}


class DockerConnection(http.client.HTTPConnection):
    def __init__(self): super().__init__('localhost', timeout=0.75)
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker_get(path):
    connection = DockerConnection()
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        if response.status != 200: raise RuntimeError('Docker metadata unavailable')
        body = response.read(2 * MIB + 1)
        if len(body) > 2 * MIB: raise RuntimeError('Docker response exceeds diagnostic bound')
        return json.loads(body)
    finally: connection.close()


def process_info(pid):
    result = {'threads': None, 'memoryMb': None, 'virtualMb': None, 'cpuSeconds': None, 'startedTicks': None, 'sampledAt': None}
    if not pid: return result
    try:
        before = time.monotonic()
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        # Pair the CPU counter with its own read time, before slower status reads.
        result['sampledAt'] = (before + time.monotonic()) / 2
        result.update(cpuSeconds=(int(fields[11]) + int(fields[12])) / os.sysconf('SC_CLK_TCK'),
                      startedTicks=int(fields[19]), threads=int(fields[17]))
        status = Path(f'/proc/{pid}/status').read_text()
        for line in status.splitlines():
            if line.startswith('VmRSS:'): result['memoryMb'] = int(line.split()[1]) / 1024
            if line.startswith('VmSize:'): result['virtualMb'] = int(line.split()[1]) / 1024
        latest = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        if int(latest[19]) != result['startedTicks']:
            return dict.fromkeys(result)
    except (OSError, ValueError, IndexError): pass
    return result


def cgroup_path(pid, control_group=None):
    try:
        root = Path('/sys/fs/cgroup').resolve()
        if control_group is None:
            record = next(line for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines() if line.startswith('0::'))
            control_group = record[3:]
        group = (root / str(control_group).lstrip('/')).resolve()
        if group.name == 'otog-worker' and re.fullmatch(r'docker-[0-9a-f]{64}\.scope', group.parent.name):
            # Account for both the grader runtime and its sibling testcase cgroups.
            group = group.parent
        return group if group != root and group.is_relative_to(root) else None
    except (OSError, ValueError, StopIteration): return None


def cgroup_cpu_sample(pid, control_group=None):
    """Container CPU time paired with elapsed time; independent of /proc/stat.

    Guest aggregate ticks may advance slower than N * elapsed time under
    virtualization. Docker's aggregate-tick normalization then inflates usage.
    Read the cgroup-v2 counter directly, including all descendant processes.
    """
    if not pid: return None, None
    try:
        group = cgroup_path(pid, control_group)
        if group is None: return None, None
        before = time.monotonic()
        values = dict(line.split() for line in (group / 'cpu.stat').read_text().splitlines())
        after = time.monotonic()
        seconds = int(values['usage_usec']) / 1e6
        if seconds < 0: return None, None
        return seconds, (before + after) / 2
    except (OSError, ValueError, KeyError, StopIteration): return None, None


def cgroup_memory_sample(pid, control_group=None):
    """Hierarchical charged memory minus inactive file cache, matching Docker's working-set convention."""
    try:
        group = cgroup_path(pid, control_group)
        if group is None: return None
        usage = int((group / 'memory.current').read_text())
        values = dict(line.split() for line in (group / 'memory.stat').read_text().splitlines())
        return round(max(0, usage - int(values.get('inactive_file', 0))) / MIB, 2)
    except (OSError, ValueError, KeyError): return None


def parse_units(text):
    result = {}
    for block in text.strip().split('\n\n'):
        fields = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
        if fields.get('Id') in UNITS: result[fields['Id']] = fields
    return result


def unavailable(name):
    return {'name': name.removesuffix('.service'), 'state': 'metrics unavailable',
            'uptimeSeconds': None, 'threads': None, 'memoryMb': None, 'virtualMb': None,
            'cpuPercent': None, 'autoRestart': 'unknown', 'restarts': None}


class Collector:
    def __init__(self):
        self.history = collections.deque(maxlen=600)
        self.previous_cpu = None
        self.previous_cpu_at = None
        self.service_cpu = {}
        self.container_cpu = {}
        self.cpu_intervals = {}
        self.docker_version = None
        self.lock = threading.Lock()
        self.body = json.dumps({'observedAt': utc_now(), 'machine': {}, 'history': [], 'services': [], 'warnings': ['Initializing resource samples']}).encode()

    def cpu_usage(self, key, seconds, now):
        return self._cpu_rate(self.service_cpu, key, seconds, now)

    def container_cpu_usage(self, key, seconds, now):
        return self._cpu_rate(self.container_cpu, key, seconds, now)

    def _cpu_rate(self, samples, key, seconds, now):
        previous = samples.get(key)
        samples[key] = (seconds, now)
        interval_key = (id(samples), key)
        self.cpu_intervals[interval_key] = None
        if previous is None or seconds is None or previous[0] is None or now is None or previous[1] is None or now <= previous[1] or seconds < previous[0]: return None
        interval = now - previous[1]
        self.cpu_intervals[interval_key] = round(interval, 3)
        if interval > 20: return None
        return round((seconds - previous[0]) * 100 / interval, 2)

    def container(self, name):
        if not self.docker_version:
            self.docker_version = docker_get('/version')['ApiVersion']
        base = f'/v{self.docker_version}/containers/{name}'
        inspect = docker_get(base + '/json')
        state = inspect['State']
        pid = state['Pid']
        process = process_info(pid)
        started = state['StartedAt']
        running = state['Running']
        memory = None
        cpu_percent = None
        if running:
            seconds, sampled_at = cgroup_cpu_sample(pid)
            cpu_percent = self.container_cpu_usage((name, started, process.get('startedTicks')), seconds, sampled_at)
            memory = cgroup_memory_sample(pid)
        elapsed = None
        if running:
            ticks = process.get('startedTicks')
            if ticks is not None:
                elapsed = max(0, float(Path('/proc/uptime').read_text().split()[0]) - ticks / os.sysconf('SC_CLK_TCK'))
        return {'name': name, 'state': 'running' if running else state.get('Status', 'stopped'),
                'uptimeSeconds': elapsed, 'threads': process['threads'], 'memoryMb': memory,
                'virtualMb': process['virtualMb'],
                'cpuPercent': cpu_percent,
                'autoRestart': inspect['HostConfig'].get('RestartPolicy', {}).get('Name') or 'no',
                'restarts': inspect.get('RestartCount'), 'sampledAt': utc_now(),
                'cpuIntervalSeconds': self.last_cpu_interval(self.container_cpu, (name, started, process.get('startedTicks'))),
                'metricScope': 'cgroup', 'processScope': 'main process'}

    def unit(self, name, uptime, fields):
        pid = int(fields.get('MainPID') or 0)
        process = process_info(pid)
        running = fields.get('ActiveState') == 'active'
        started = int(fields.get('ExecMainStartTimestampMonotonic') or 0) / 1e6
        group = fields.get('ControlGroup')
        seconds, sampled_at = cgroup_cpu_sample(pid, group) if running and group else (None, None)
        key = (name, pid, process['startedTicks'])
        return {'name': name.removesuffix('.service'), 'state': 'running' if running else fields.get('ActiveState', 'unknown'),
                'uptimeSeconds': max(0, time.monotonic() - started) if running and started else None,
                'threads': process['threads'], 'memoryMb': cgroup_memory_sample(pid, group) if running and group else None, 'virtualMb': process['virtualMb'],
                'cpuPercent': self.cpu_usage(key, seconds, sampled_at),
                'autoRestart': fields.get('Restart', 'unknown'), 'restarts': int(fields.get('NRestarts') or 0),
                'sampledAt': utc_now(), 'cpuIntervalSeconds': self.last_cpu_interval(self.service_cpu, key),
                'metricScope': 'cgroup', 'processScope': 'main process'}

    def last_cpu_interval(self, samples, key):
        return self.cpu_intervals.get((id(samples), key))

    def sample(self):
        observed = utc_now()
        mem = read_meminfo()
        cpu_at = time.monotonic()
        cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
        interval = cpu_at - self.previous_cpu_at if self.previous_cpu_at is not None else None
        valid_before = self.previous_cpu if interval is not None and 0 < interval <= 20 else None
        point = {'at': observed, 'monotonicSeconds': cpu_at,
                 'cpuSampleIntervalSeconds': round(interval, 3) if interval is not None else None,
                 **cpu_point(valid_before, cpu), **memory_point(mem)}
        self.previous_cpu = cpu
        self.previous_cpu_at = cpu_at
        self.history.append(point)
        while self.history and cpu_at - self.history[0]['monotonicSeconds'] > 600:
            self.history.popleft()
        uptime = float(Path('/proc/uptime').read_text().split()[0])
        disk = shutil.disk_usage('/')
        services, warnings = [], []
        # One fixed command replaces four subprocesses per sample, avoiding
        # needless CPU overhead and timeouts under the monitor's CPU quota.
        try:
            text = subprocess.run(['systemctl', 'show', *UNITS,
                '--property=Id,MainPID,ActiveState,SubState,Restart,NRestarts,ExecMainStartTimestampMonotonic,ControlGroup'],
                check=True, capture_output=True, text=True, timeout=5).stdout
            units = parse_units(text)
        except (OSError, subprocess.SubprocessError): units = {}
        for name in UNITS:
            try:
                row = self.unit(name, uptime, units[name])
                services.append(row)
                if row['state'] == 'running' and row['memoryMb'] is None:
                    warnings.append(f'Could not read {name} cgroup memory')
            except (OSError, ValueError, KeyError):
                services.append(unavailable(name))
                warnings.append(f'Could not read {name} metrics')
        for name in CONTAINERS:
            try: services.append(self.container(name))
            except (OSError, ValueError, KeyError, RuntimeError, http.client.HTTPException):
                services.append(unavailable(name))
                warnings.append(f'Could not read {name} metrics')
        # Only a handful of fixed service identities are retained across restarts.
        if len(self.service_cpu) > 32: self.service_cpu.clear()
        if len(self.container_cpu) > 32: self.container_cpu.clear()
        if len(self.cpu_intervals) > 64: self.cpu_intervals.clear()
        snapshot = {'observedAt': observed, 'machine': {'name': os.uname().nodename,
            'cpuCount': os.cpu_count(), 'uptimeSeconds': uptime, 'memoryTotalMb': round(mem['MemTotal'], 2),
            'memoryAvailableMb': round(mem['MemAvailable'], 2), 'swapTotalMb': round(mem['SwapTotal'], 2),
            'diskTotalGb': round(disk.total / 1024**3, 2), 'diskFreeGb': round(disk.free / 1024**3, 2)},
            'history': list(self.history), 'services': services, 'warnings': warnings,
            'collectedAt': utc_now(), 'schemaVersion': 2,
            'collectionDurationSeconds': round(time.monotonic() - cpu_at, 3)}
        body = json.dumps(snapshot, allow_nan=False, separators=(',', ':')).encode()
        with self.lock: self.body = body

    def run(self):
        deadline = time.monotonic() + 1
        while True:
            time.sleep(max(0, deadline - time.monotonic()))
            start = time.monotonic()
            try: self.sample()
            except (OSError, ValueError, KeyError): pass
            deadline = max(start + 1, time.monotonic() + 0.05)


def serve():
    collector = Collector()
    collector.sample()
    threading.Thread(target=collector.run, name='resource-sampler', daemon=True).start()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/status': self.send_error(404); return
            with collector.lock: body = collector.body
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *_args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == '__main__': serve()
