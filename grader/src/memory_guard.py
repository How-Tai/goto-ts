"""Fresh VM RAM admission checks; never terminate or change a running job."""
MIN_AVAILABLE_KIB = 1536 * 1024


def parse_available_kib(content):
    values = {}
    for line in content.splitlines():
        fields = line.split()
        if fields and fields[0] in ('MemTotal:', 'MemAvailable:'):
            if len(fields) != 3 or fields[2] != 'kB' or not fields[1].isdigit():
                return None
            key = fields[0]
            if key in values:
                return None
            values[key] = int(fields[1])
    total = values.get('MemTotal:', 0)
    available = values.get('MemAvailable:')
    if total <= 0 or available is None or not 0 <= available <= total:
        return None
    return available


def read_available_kib():
    try:
        # Docker on this VM exposes the guest kernel's meminfo, verified during
        # deployment. MemAvailable accounts for reclaimable cache, unlike free.
        with open('/proc/meminfo', encoding='ascii') as stream:
            return parse_available_kib(stream.read(65536))
    except (OSError, UnicodeError, ValueError):
        return None


class MemoryGuard:
    def __init__(self, reader=read_available_kib, logger=None):
        self.reader = reader
        self.logger = logger if logger is not None else lambda msg: print(msg, flush=True)
        self.blocked = None

    def allows(self):
        try:
            available = self.reader()
        except (OSError, ValueError):
            available = None
        valid = isinstance(available, int) and not isinstance(available, bool) and available >= 0
        allowed = valid and available >= MIN_AVAILABLE_KIB
        blocked = not allowed
        if blocked != self.blocked:
            if not valid:
                message = 'MEMORY GUARD waiting: VM available RAM could not be read; new claims withheld.'
            elif blocked:
                message = (f'MEMORY GUARD waiting: {available / 1024:.1f} MiB available, '
                           'below 1536 MiB; running jobs continue.')
            else:
                message = (f'MEMORY GUARD allowing new claims: {available / 1024:.1f} MiB available '
                           '(minimum 1536 MiB).')
            self.logger(message)
            self.blocked = blocked
        return allowed
