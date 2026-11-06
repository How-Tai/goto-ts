"""Keep movable VM interrupts and unbound work off reserved grader CPUs."""
from pathlib import Path
import errno
import json
import sys


def validate_cpus(cpus, online):
    if (not isinstance(cpus, list) or not cpus or
            any(type(cpu) is not int or cpu not in online for cpu in cpus) or
            cpus != sorted(set(cpus))):
        raise ValueError('Expected sorted, distinct online service CPUs.')
    return cpus


def parse_list(value):
    result = set()
    for item in value.strip().split(','):
        if not item:
            continue
        bounds = item.split('-')
        first = int(bounds[0])
        last = int(bounds[-1])
        if len(bounds) > 2 or first > last or first < 0 or last > 4095:
            raise ValueError('Invalid CPU list.')
        result.update(range(first, last + 1))
    return result


def irq_descriptions(interrupts):
    cpu_columns = sum(word.startswith('CPU') and word[3:].isdigit()
                      for word in interrupts.splitlines()[0].split()) if interrupts else 0
    result = {}
    for line in interrupts.splitlines():
        key, sep, value = line.partition(':')
        if not sep or not key.strip().isdigit():
            continue
        parts = value.split()
        if cpu_columns and len(parts) >= cpu_columns and all(v.isdigit() for v in parts[:cpu_columns]):
            result[key.strip()] = ' '.join(parts[cpu_columns:])
    return result


def apply(cpus, irq_root=Path('/proc/irq'),
          workqueue=Path('/sys/devices/virtual/workqueue/cpumask'),
          interrupts=Path('/proc/interrupts'), online=None):
    if online is None:
        online = parse_list(Path('/sys/devices/system/cpu/online').read_text())
    validate_cpus(cpus, online)
    desired = set(cpus)
    bits = format(sum(1 << cpu for cpu in cpus), 'x')
    mask = ','.join(bits[max(0, end-8):end] for end in reversed(range(len(bits),0,-8)))
    cpu_list = ','.join(map(str, cpus))
    for target in [irq_root / 'default_smp_affinity', workqueue]:
        if int(target.read_text().strip().replace(',', ''), 16) != int(mask, 16):
            target.write_text(mask + '\n')
        if int(target.read_text().strip().replace(',', ''), 16) != int(mask, 16):
            raise RuntimeError('Kernel CPU mask did not apply: ' + str(target))
    rows = []
    for number, description in irq_descriptions(interrupts.read_text()).items():
        root = irq_root / number
        affinity = root / 'smp_affinity_list'
        if not affinity.exists():
            continue
        row = {'irq': int(number), 'description': description}
        try:
            if parse_list(affinity.read_text()) != desired:
                affinity.write_text(cpu_list + '\n')
            if parse_list(affinity.read_text()) != desired:
                raise RuntimeError('IRQ request did not apply: ' + number)
            effective = root / 'effective_affinity_list'
            actual = parse_list(effective.read_text()) if effective.exists() else desired
            row.update(requested=cpu_list, effective=sorted(actual),
                       pending=not actual.issubset(desired), movable=True)
        except OSError as error:
            if error.errno not in (errno.EINVAL, errno.EIO, errno.ENOENT):
                raise
            # Fixed/per-CPU or managed interrupts can reject affinity changes.
            # Expose that limitation instead of claiming complete isolation.
            row.update(movable=False, reason=errno.errorcode[error.errno])
        rows.append(row)
    return {'serviceCpus': cpus, 'defaultIrqMask': mask,
            'unboundWorkqueueMask': mask, 'irqs': rows,
            'unmovableIrqs': [r['irq'] for r in rows if not r['movable']],
            'pendingIrqs': [r['irq'] for r in rows if r.get('pending')]}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Expected one JSON CPU list.')
    online = parse_list(Path('/sys/devices/system/cpu/online').read_text())
    cpus = [max(online)] if sys.argv[1] == '--boot' else json.loads(sys.argv[1])
    print(json.dumps(apply(cpus, online=online)), flush=True)
