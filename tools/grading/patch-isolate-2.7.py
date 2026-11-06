"""Keep local bounded cleanup and CPU timing when upgrading official Isolate 2.7."""
from pathlib import Path
import re,sys
root,previous=map(Path,sys.argv[1:3]);source=root/'isolate.c';text=source.read_text()
changes=[
 ('int cg_enable;\n','int cg_enable;\nstatic int cg_memory_only;\n'),
 ('if (cg_enable)\n\t{\n\t  /*','if (cg_enable && !cg_memory_only)\n\t{\n\t  /*'),
 ('if (cg_enable)\n    return cg_get_run_time_ms();','if (cg_enable && !cg_memory_only)\n    return cg_get_run_time_ms();'),
 ('  OPT_CG_MEM,\n','  OPT_CG_MEM,\n  OPT_CG_MEMORY_ONLY,\n'),
 ('  { "cg-mem",\t\t1, NULL, OPT_CG_MEM },','  { "cg-mem",\t\t1, NULL, OPT_CG_MEM },\n  { "cg-memory-only", 0, NULL, OPT_CG_MEMORY_ONLY },'),
 ("      case 'd':","      case OPT_CG_MEMORY_ONLY:\n        cg_memory_only = 1;\n        require_cg = 1;\n        break;\n      case 'd':")]
for old,new in changes:
 assert text.count(old)==1,old
 text=text.replace(old,new)
source.write_text(text)
# The descriptor-bounded walk validates inode/device identities while avoiding
# recursive call-stack and one-descriptor-per-level growth. Keep upstream's
# other utility and ownership checks unchanged.
pattern=r'static void\nwalktree_ctx\(struct walk_context \*ctx\)\n\{.*?\n\}\n(?=\nstatic void\nwalktree\()'
old=(previous/'util.c').read_text();new=(root/'util.c').read_text();match=re.search(pattern,old,re.S)
assert match and 'Directory ancestry changed' in match.group()
new,count=re.subn(pattern,lambda _:match.group(),new,flags=re.S);assert count==1
(root/'util.c').write_text(new)
