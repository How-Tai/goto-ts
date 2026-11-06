"""Apply a narrow memory-only cgroup option to the already hardened Isolate source."""
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
changes = [
    ('int cg_enable;\n', 'int cg_enable;\nstatic int cg_memory_only;\n'),
    ('if (cg_enable)\n\t{\n\t  /*', 'if (cg_enable && !cg_memory_only)\n\t{\n\t  /*'),
    ('if (cg_enable)\n    return cg_get_run_time_ms();', 'if (cg_enable && !cg_memory_only)\n    return cg_get_run_time_ms();'),
    ('  OPT_CG_MEM,\n', '  OPT_CG_MEM,\n  OPT_CG_MEMORY_ONLY,\n'),
    ('  { "cg-mem",\t\t1, NULL, OPT_CG_MEM },', '  { "cg-mem",\t\t1, NULL, OPT_CG_MEM },\n  { "cg-memory-only", 0, NULL, OPT_CG_MEMORY_ONLY },'),
    ("      case 'd':", "      case OPT_CG_MEMORY_ONLY:\n        cg_memory_only = 1;\n        require_cg = 1;\n        break;\n      case 'd':"),
]
for before, after in changes:
    assert source.count(before) == 1, before
    source = source.replace(before, after)
file.write_text(source)
