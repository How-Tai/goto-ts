"""Run bounded, benign containment/checker regressions without a database."""
from pathlib import Path
import subprocess, yaml, sys
root=Path(__file__).resolve().parents[1]
image=sys.argv[1] if len(sys.argv)>1 else 'otog-grader:hardened'
service=yaml.safe_load((root/'docker-compose.prod.yml').read_text())['services']['grader']
args=['docker','run','--rm','--network','none','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--cap-drop','ALL','--read-only']
for capability in service['cap_add']:args+=['--cap-add',capability]
for option in service['security_opt']:args+=['--security-opt',option]
for mount in service['tmpfs']:args+=['--tmpfs',mount]
for key,value in service['environment'].items():args+=['-e',key+'='+value]
for script in ['test_container_security.py','test_checker_sandbox.py']:
    source=root.parent/'tools/grading'/script
    subprocess.run(args+['--mount','type=bind,src='+str(source.resolve())+',dst=/test.py,readonly','--entrypoint','python3',image,'/test.py'],check=True,timeout=300)
