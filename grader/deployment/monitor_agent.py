"""Loopback-only, read-only VM telemetry; bounded history, no third-party packages."""
import collections
import datetime
import http.client
import json
import os
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
              'otog-grader5-1', 'otog-grader6-1')
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
            'swapUsedMb': round(values['SwapTotal'] - values['SwapFree'], 2)}


def cpu_point(before, after):
    if before is None: return {'cpuUser': None, 'cpuSystem': None, 'cpuWait': None}
    delta = [max(0, a - b) for a, b in zip(after[:8], before[:8])]
    total = sum(delta)
    if not total: return {'cpuUser': None, 'cpuSystem': None, 'cpuWait': None}
    return {'cpuUser': round(100 * (delta[0] + delta[1]) / total, 2),
            'cpuSystem': round(100 * (delta[2] + delta[5] + delta[6]) / total, 2),
            'cpuWait': round(100 * delta[4] / total, 2)}


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
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        # Pair the CPU counter with its own read time, before slower status reads.
        result['sampledAt'] = time.monotonic()
        result.update(cpuSeconds=(int(fields[11]) + int(fields[12])) / os.sysconf('SC_CLK_TCK'),
                      startedTicks=int(fields[19]), threads=int(fields[17]))
        status = Path(f'/proc/{pid}/status').read_text()
        for line in status.splitlines():
            if line.startswith('VmRSS:'): result['memoryMb'] = int(line.split()[1]) / 1024
            if line.startswith('VmSize:'): result['virtualMb'] = int(line.split()[1]) / 1024
    except (OSError, ValueError, IndexError): pass
    return result


def cgroup_cpu_sample(pid):
    """Container CPU time paired with elapsed time; independent of /proc/stat.

    Guest aggregate ticks may advance slower than N * elapsed time under
    virtualization. Docker's aggregate-tick normalization then inflates usage.
    Read the cgroup-v2 counter directly, including all descendant processes.
    """
    if not pid: return None, None
    try:
        record = next(line for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines()
                      if line.startswith('0::'))
        root = Path('/sys/fs/cgroup').resolve()
        group = (root / record[3:].lstrip('/')).resolve()
        if not group.is_relative_to(root): return None, None
        before = time.monotonic()
        values = dict(line.split() for line in (group / 'cpu.stat').read_text().splitlines())
        after = time.monotonic()
        seconds = int(values['usage_usec']) / 1e6
        if seconds < 0: return None, None
        return seconds, (before + after) / 2
    except (OSError, ValueError, KeyError, StopIteration): return None, None


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
        self.history = collections.deque(maxlen=120)
        self.previous_cpu = None
        self.service_cpu = {}
        self.container_cpu = {}
        self.docker_version = None
        self.lock = threading.Lock()
        self.body = json.dumps({'observedAt': utc_now(), 'machine': {}, 'history': [], 'services': [], 'warnings': ['Initializing resource samples']}).encode()

    def cpu_usage(self, key, seconds, now):
        previous = self.service_cpu.get(key)
        self.service_cpu[key] = (seconds, now)
        if previous is None or seconds is None or previous[0] is None or now is None or previous[1] is None or now <= previous[1] or seconds < previous[0]: return None
        return round((seconds - previous[0]) * 100 / (now - previous[1]), 2)

    def container_cpu_usage(self, key, seconds, now):
        previous = self.container_cpu.get(key)
        self.container_cpu[key] = (seconds, now)
        if previous is None or seconds is None or previous[0] is None or now is None or previous[1] is None or seconds < previous[0] or now <= previous[1]: return None
        return round((seconds - previous[0]) * 100 / (now - previous[1]), 2)

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
            cpu_percent = self.container_cpu_usage((name, started), seconds, sampled_at)
            stats = docker_get(base + '/stats?stream=false&one-shot=true')
            mem = stats.get('memory_stats', {})
            if 'usage' in mem:
                inactive = mem.get('stats', {}).get('inactive_file', mem.get('stats', {}).get('total_inactive_file', 0))
                memory = round(max(0, mem['usage'] - inactive) / MIB, 2)
        elapsed = None
        if running:
            elapsed = max(0, (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(started.replace('Z', '+00:00'))).total_seconds())
        return {'name': name, 'state': 'running' if running else state.get('Status', 'stopped'),
                'uptimeSeconds': elapsed, 'threads': process['threads'], 'memoryMb': memory,
                'virtualMb': process['virtualMb'],
                'cpuPercent': cpu_percent,
                'autoRestart': inspect['HostConfig'].get('RestartPolicy', {}).get('Name') or 'no',
                'restarts': inspect.get('RestartCount')}

    def unit(self, name, uptime, fields):
        pid = int(fields.get('MainPID') or 0)
        process = process_info(pid)
        running = fields.get('ActiveState') == 'active'
        started = int(fields.get('ExecMainStartTimestampMonotonic') or 0) / 1e6
        return {'name': name.removesuffix('.service'), 'state': 'running' if running else fields.get('ActiveState', 'unknown'),
                'uptimeSeconds': max(0, uptime - started) if running and started else None,
                'threads': process['threads'], 'memoryMb': process['memoryMb'], 'virtualMb': process['virtualMb'],
                'cpuPercent': self.cpu_usage((name, pid, process['startedTicks']), process['cpuSeconds'], process['sampledAt']),
                'autoRestart': fields.get('Restart', 'unknown'), 'restarts': int(fields.get('NRestarts') or 0)}

    def sample(self):
        observed = utc_now()
        mem = read_meminfo()
        cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
        point = {'at': observed, **cpu_point(self.previous_cpu, cpu), **memory_point(mem)}
        self.previous_cpu = cpu
        self.history.append(point)
        uptime = float(Path('/proc/uptime').read_text().split()[0])
        disk = shutil.disk_usage('/')
        services, warnings = [], []
        # One fixed command replaces four subprocesses per sample, avoiding
        # needless CPU overhead and timeouts under the monitor's CPU quota.
        try:
            text = subprocess.run(['systemctl', 'show', *UNITS,
                '--property=Id,MainPID,ActiveState,SubState,Restart,NRestarts,ExecMainStartTimestampMonotonic'],
                check=True, capture_output=True, text=True, timeout=5).stdout
            units = parse_units(text)
        except (OSError, subprocess.SubprocessError): units = {}
        for name in UNITS:
            try: services.append(self.unit(name, uptime, units[name]))
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
        snapshot = {'observedAt': observed, 'machine': {'name': os.uname().nodename,
            'cpuCount': os.cpu_count(), 'uptimeSeconds': uptime, 'memoryTotalMb': round(mem['MemTotal'], 2),
            'memoryAvailableMb': round(mem['MemAvailable'], 2), 'swapTotalMb': round(mem['SwapTotal'], 2),
            'diskTotalGb': round(disk.total / 1024**3, 2), 'diskFreeGb': round(disk.free / 1024**3, 2)},
            'history': list(self.history), 'services': services, 'warnings': warnings}
        body = json.dumps(snapshot, allow_nan=False, separators=(',', ':')).encode()
        with self.lock: self.body = body

    def run(self):
        while True:
            start = time.monotonic()
            try: self.sample()
            except (OSError, ValueError, KeyError): pass
            time.sleep(max(1, 5 - (time.monotonic() - start)))


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
