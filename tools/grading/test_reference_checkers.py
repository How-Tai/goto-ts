"""Grade existing accepted reference sources offline; never persist results."""
from pathlib import Path
import contextlib,io,json,os,sys,time,shutil
sys.path.insert(0,'/usr/src/app/src')
from memory_limits import initialize
initialize()
wrapper=Path('/opt/otog-worker-bin');wrapper.mkdir(exist_ok=True)
(wrapper/'isolate').write_text('#!/bin/sh\nexec /usr/local/bin/isolate --cg --cg-memory-only --box-id="$OTOG_WORKER_ID" "$@"\n');(wrapper/'isolate').chmod(0o755)
os.environ['PATH']=str(wrapper)+':'+os.environ['PATH']
import judge
from DTO.submission import SubmissionDTO
from constants.Enums import SubmissionStatus
from sandbox_security import release_sandbox
records=[]
for fixture in json.loads(Path('/fixtures.json').read_text()):
 problem=Path('/tmp/reference-source')/str(fixture['problemId'])
 shared=Path('/reference-source')/str(fixture['problemId']);problem.mkdir(parents=True)
 for directory,dirs,files in os.walk(shared):
  destination=problem/Path(directory).relative_to(shared);destination.mkdir(parents=True,exist_ok=True)
  for filename in files:
   original=Path(directory)/filename;target=destination/filename
   if original.suffix in ('.in','.sol'):target.symlink_to(original)
   elif filename!='binCheck':shutil.copy2(original,target)
 p=fixture['problem'];data=SubmissionDTO(fixture['submissionId'],1,fixture['problemId'],str(problem),None,fixture['sourceCode'],fixture['language'],100,p['timeLimit'],p['memoryLimit'],p['case'],'classic');results=[];capture=io.StringIO();started=time.monotonic()
 try:
  with contextlib.redirect_stdout(capture):judge.startJudge(data,results.append,lambda*a:None,lambda*a:None)
  result=results[0];assert result.status==SubmissionStatus.accept,(fixture['problemId'],result.status.value,result.result,result.errmsg)
  records.append({'problemId':fixture['problemId'],'submissionId':fixture['submissionId'],'status':result.status.value,'score':result.score,'cases':sum(len(s.verdicts) for s in result.fullResult),'seconds':round(time.monotonic()-started,3)})
 except BaseException:
  print(capture.getvalue()[-3500:],flush=True);raise
 finally:release_sandbox()
print(json.dumps({'passed':True,'references':records,'productionVerdictWrites':0}),flush=True)
