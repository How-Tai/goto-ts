"""Render a fresh hardened deployment. Never mutate the live VM configuration."""
from pathlib import Path
import argparse, copy, yaml
parser=argparse.ArgumentParser()
parser.add_argument('--workers',type=int,choices=range(1,8),default=1)
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'docker-compose.workers.yml')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
if args.output.resolve().parent != root:parser.error('Write beside the base Compose file so relative paths stay valid.')
config=yaml.safe_load((root/'docker-compose.prod.yml').read_text())
base=config['services']['grader'];config['services']={}
for number in range(1,args.workers+1):
 service=copy.deepcopy(base)
 service['environment']['OTOG_WORKER_ID']=str(number)
 service['cpuset']=str(number-1)
 config['services']['grader' if number==1 else 'grader'+str(number)]=service
args.output.write_text(yaml.safe_dump(config,sort_keys=False))
print('Prepared hardened workers; review/drain existing workers before any rollout.')
