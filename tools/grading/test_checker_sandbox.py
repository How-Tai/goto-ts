"""Bounded checker compatibility and privilege-boundary regression tests."""
from pathlib import Path
import contextlib,io,json,os,sys,time
sys.path.insert(0,'/usr/src/app/src')
from memory_limits import initialize
initialize()
wrapper=Path('/opt/otog-worker-bin');wrapper.mkdir(exist_ok=True)
(wrapper/'isolate').write_text('#!/bin/sh\nexec /usr/local/bin/isolate --cg --cg-memory-only --box-id="$OTOG_WORKER_ID" "$@"\n');(wrapper/'isolate').chmod(0o755)
os.environ['PATH']=str(wrapper)+':'+os.environ['PATH']
import judge,checker_sandbox
from DTO.submission import SubmissionDTO
from constants.Enums import VerdictStatus
from sandbox_security import release_sandbox
root=Path('/tmp/checker-fixtures');root.mkdir();records=[];compiles=[]
native_calls=[];memory_samples=[]
infrastructure=checker_sandbox.infrastructure_command
def native_tracked(args,*a,**kw):
 native_calls.append(args)
 return infrastructure(args,*a,**kw)
checker_sandbox.infrastructure_command=native_tracked
original=checker_sandbox._run
def tracked(command,*args,**kwargs):
 if command[0]=='/usr/bin/g++':compiles.append(command)
 result=original(command,*args,**kwargs)
 group=Path('/sys/fs/cgroup/otog-sandboxes')/('box-'+str(checker_sandbox._id()))
 if command[0]!='/usr/bin/g++':
  memory_samples.append(int((group/'memory.peak').read_text()))
 return result
checker_sandbox._run=tracked
ok='#include <cstdio>\nint main(){puts("OK");}'
cpp=r'''#include <fstream>
#include <unistd.h>
#include <string>
int main(int argc,char**argv){
 if(getuid()==0 || geteuid()==0 || argc!=4)return 2;
 std::ifstream in(argv[2]),sol(argv[1]),src(argv[3]),out("output.txt");
 if(!in||!sol||!src||!out)return 3;
 if(std::ifstream("marker"))return 4;
 std::ofstream("marker")<<"private testcase state";
 std::string s;out>>s;std::ofstream("grader_result.txt")<<(s=="OK"?"P":"-");}
'''
thaco=r'''#include <fstream>
#include <unistd.h>
#include <cstdio>
#include <string>
int main(int argc,char**argv){
 if(getuid()==0||argc!=4)return 2;
 std::ifstream in(argv[1]),sol(argv[2]),out(argv[3]);if(!in||!sol||!out)return 3;
 std::string s;out>>s;puts(s=="OK"?"1":"0");}
'''
python=r'''import os,sys,pathlib
from helper import check
status=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert os.getuid()!=0 and os.geteuid()!=0
assert int(status['CapEff'].strip(),16)==0
assert status['NoNewPrivs'].strip()=='1'
assert status['Seccomp'].strip()=='2'
assert not any(k.startswith(('POSTGRES_','DATABASE_URL','JWT_')) for k in os.environ)
assert not pathlib.Path('/usr/src/app').exists()
assert not pathlib.Path('/sys/fs/cgroup').exists()
assert set(line.split(':',1)[0].strip() for line in pathlib.Path('/proc/net/dev').read_text().splitlines()[2:])=={'lo'}
case=int(sys.argv[3]);problem=pathlib.Path(sys.argv[2])
assert not (problem/('2.in' if case==1 else '1.in')).exists()
assert (problem/f'{case}.in').read_text().strip()=='0'
expected=(problem/f'{case}.sol').read_text().strip()
assert not pathlib.Path('marker').exists()
pathlib.Path('marker').write_text('isolated')
for directory in ['/tmp','/var/tmp','/dev/shm']:
 marker=pathlib.Path(directory)/'case-marker'
 # /tmp and /var/tmp intentionally refer to the same fresh directory.
 if directory!='/var/tmp':assert not marker.exists()
 marker.write_text('private temporary state')
print('P' if check(pathlib.Path(sys.argv[1]).read_text().strip(),expected) else '-')
'''
def grade(label,checker,implementation,expected,code=ok,cases=1,problem=None):
 path=problem or root/label
 if not path.exists():
  path.mkdir();(path/checker).write_text(implementation)
  (path/'helper.py').write_text('def check(a,b): return a==b\n')
  for i in range(1,cases+1):
   for suffix,value in [('in','0\n'),('sol','OK\n')]:
    file=path/f'{i}.{suffix}';file.write_text(value);file.chmod(0o660)
 data=SubmissionDTO(900002,1,900002,str(path),None,code,'cpp',100,1000,64,str(cases),'classic');results=[];captured=io.StringIO();started=time.monotonic();call_start=len(native_calls)
 try:
  with contextlib.redirect_stdout(captured):judge.startJudge(data,results.append,lambda*a:None,lambda*a:None)
  statuses=[v.status for s in results[0].fullResult for v in s.verdicts]
  if expected=='JE':
   assert results[0].status.value=='judgeError',results[0].status.value
   assert 'checker-secret-token' not in (results[0].errmsg or '')
  else:assert statuses==[expected]*cases,(label,[v.value for v in statuses],results[0].errmsg)
  records.append({'test':label,'verdicts':[v.value for v in statuses],'seconds':round(time.monotonic()-started,3)})
 except BaseException:
  print(captured.getvalue()[-3500:],flush=True);raise
 finally:release_sandbox()
 assert not checker_sandbox.STATE.exists()
 calls=native_calls[call_start:]
 assert sum('--init' in call for call in calls)==1,(label,calls)
 assert sum('--cleanup' in call for call in calls)==1,(label,calls)
 return path
same=grade('cpp-accepted','check.cpp',cpp,VerdictStatus.accept,cases=2)
grade('cpp-next-submission-recompiled','check.cpp',cpp,VerdictStatus.accept,cases=2,problem=same)
assert len(compiles)==2,compiles
grade('cpp-wrong-answer','check.cpp',cpp,VerdictStatus.reject,code='int main(){}')
grade('thaco-accepted','thaco.cpp',thaco,VerdictStatus.accept)
grade('thaco-wrong-answer','thaco.cpp',thaco,VerdictStatus.reject,code='int main(){}')
grade('partial-score','partial.cpp',thaco.replace('"1":"0"','"0.5":"0"'),VerdictStatus.partial)
grade('python-checker-identity-and-isolation','interactive_script.py',python,VerdictStatus.accept,cases=2)
grade('python-checker-wrong-answer','interactive_script.py',python,VerdictStatus.reject,code='int main(){}')
hidden='#include <cstdio>\nint main(){for(auto n:{"check.cpp","thaco.cpp","partial.cpp","interactive_script.py"})if(FILE*f=fopen(n,"r"))return 2;puts("OK");}'
hidden=hidden.replace('#include <cstdio>','#include <cstdio>\n#include <initializer_list>')
for filename in ['check.cpp','thaco.cpp','partial.cpp','interactive_script.py']:
 grade('private-'+filename.replace('.','-'),filename,python if filename.endswith('.py') else cpp if filename=='check.cpp' else thaco,VerdictStatus.accept,code=hidden)
assert not list(Path('/sys/fs/cgroup/otog-sandboxes').glob('box-*'))
grade('checker-error-keeps-diagnostics-private','check.cpp','#include <cstdio>\nint main(){fputs("checker-secret-token",stderr);return 2;}','JE')
grade('after-checker-error','check.cpp',cpp,VerdictStatus.accept,cases=2)
start=len(memory_samples)
grade('fresh-checker-memory-peak','interactive_script.py','import sys\na=bytearray(32*1024*1024) if sys.argv[3]=="1" else bytearray(1024)\nprint("P")\n',VerdictStatus.accept,cases=2)
peaks=memory_samples[start:];assert len(peaks)==2 and peaks[0]>30*1024*1024 and peaks[1]<20*1024*1024,peaks
assert not list(Path('/sys/fs/cgroup/otog-sandboxes').glob('box-*'))
print(json.dumps({'passed':True,'tests':records,'customCheckerCompiles':len(compiles),'noCrossSubmissionCheckerCache':True,'separateUnprivilegedCheckerIdentity':True,'seccompAndNoNewPrivileges':True,'onlyCurrentCaseExposed':True,'freshTemporaryDirectories':True,'freshCheckerMemoryPeakBytes':peaks,'oneInitAndCleanupPerSubmission':True,'noWorkerEnvironmentOrNetwork':True,'databaseWrites':0}),flush=True)
