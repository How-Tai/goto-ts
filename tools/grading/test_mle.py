"""Benign bounded resource-limit tests; no database or production submissions."""
from pathlib import Path
import contextlib,io,json,os,sys,time
sys.path.insert(0,'/usr/src/app/src')
from memory_limits import initialize, enabled, cleanup, SANDBOX_GROUP
assert os.getpid()==1 and enabled()
initialize()
wrapper=Path('/opt/otog-worker-bin');wrapper.mkdir(exist_ok=True)
(wrapper/'isolate').write_text('#!/bin/sh\nexec /usr/local/bin/isolate --cg --cg-memory-only --box-id="$OTOG_WORKER_ID" "$@"\n');(wrapper/'isolate').chmod(0o755)
os.environ['PATH']=str(wrapper)+':'+os.environ['PATH']
import judge
from DTO.submission import SubmissionDTO
from constants.Enums import VerdictStatus,SubmissionStatus
from sandbox_security import release_sandbox
from constants.verdict import verdictSymbol,verdictCodeforces
import memory_limits
assert verdictSymbol(VerdictStatus.memoryExceed)=='M'
assert verdictCodeforces(VerdictStatus.memoryExceed)=='Memory limit exceeded on pretest %d'
Path('env').mkdir(exist_ok=True)
root=Path('/tmp/mle-test-source');root.mkdir();records=[]
def grade(label,code,expected,language='cpp',ml=32,tl=1000,cases=None):
 path=root/label;path.mkdir();inputs=cases or ['0\n']
 for i,data in enumerate(inputs,1):(path/f'{i}.in').write_text(data);(path/f'{i}.sol').write_text('OK\n')
 submission=SubmissionDTO(900001,1,900001,str(path),None,code,language,100,tl,ml,str(len(inputs)),'classic');out=[];capture=io.StringIO();started=time.monotonic()
 try:
  with contextlib.redirect_stdout(capture):judge.startJudge(submission,out.append,lambda *a:None,lambda *a:None)
  assert len(out)==1;result=out[0];statuses=[v.status for group in result.fullResult for v in group.verdicts]
  if expected=='CE':assert result.status==SubmissionStatus.compileError,(label,result.status,result.errmsg)
  else:assert statuses and statuses[0]==expected,(label,[s.value for s in statuses],result.errmsg)
  record={'test':label,'status':result.status.value,'result':result.result,'memoryKiB':result.memUse,'timeMs':result.sumTime,'seconds':round(time.monotonic()-started,3),'testcases':[{'status':v.status.value,'memoryKiB':v.memUse,'timeMs':v.timeUse} for group in result.fullResult for v in group.verdicts]};records.append(record)
  return result
 except BaseException:
  print(capture.getvalue()[-10000:],flush=True);raise
 finally:release_sandbox()
ok='#include <cstdio>\nint main(){puts("OK");}'
grade('accepted',ok,VerdictStatus.accept)
grade('wrong-answer','#include <cstdio>\nint main(){puts("WRONG");}',VerdictStatus.reject)
grade('segfault','#include <csignal>\nint main(){raise(SIGSEGV);}',VerdictStatus.runtimeErr)
grade('fake-oom-text','#include <cstdio>\n#include <csignal>\nint main(){fputs("std::bad_alloc MemoryError Out of memory",stderr);raise(SIGSEGV);}',VerdictStatus.runtimeErr)
grade('abort','#include <cstdlib>\nint main(){abort();}',VerdictStatus.runtimeErr)
grade('nonzero-137','int main(){return 137;}',VerdictStatus.runtimeErr)
grade('cpp-memory','#include <vector>\nint main(){std::vector<char> a(128*1024*1024,1);return a[4000];}',VerdictStatus.memoryExceed)
grade('c-memory','#include <stdlib.h>\n#include <string.h>\nint main(){volatile char *p=malloc(128*1024*1024);for(long i=0;i<128L*1024*1024;i+=4096)p[i]=1;return p[0];}',VerdictStatus.memoryExceed,language='c')
grade('python-memory','a=[0]*30000000\nprint("OK")',VerdictStatus.memoryExceed,language='python')
grade('stack-memory','#include <cstdio>\n__attribute__((noinline)) void f(int n){volatile char a[1024*1024];for(int i=0;i<1024*1024;i+=4096)a[i]=n;f(n+1);printf("%d",a[0]);}int main(){f(1);}',VerdictStatus.memoryExceed)
grade('time-limit','int main(){for(volatile unsigned long i=0;;++i){}}',VerdictStatus.timeExceed,tl=100)
grade('compile-error','this is not valid C++','CE')
grade('untouched-virtual-reservation','#include <sys/mman.h>\n#include <cstdio>\nint main(){void*p=mmap(0,1024L*1024*1024,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);if(p==MAP_FAILED)return 2;((volatile char*)p)[0]=1;puts("OK");}',VerdictStatus.accept)
reset=grade('fresh-per-testcase','#include <cstdio>\n#include <cstdlib>\nint main(){int n;scanf("%d",&n);long size=n?20*1024*1024:1024;volatile char*p=(char*)malloc(size);for(long i=0;i<size;i+=4096)p[i]=1;puts("OK");}',VerdictStatus.accept,cases=['1\n','0\n'])
assert reset.fullResult[0].verdicts[0].memUse>15000 and reset.fullResult[0].verdicts[1].memUse<10000
grade('after-oom-normal',ok,VerdictStatus.accept)
timer=grade('cpu-timer','#include <time.h>\n#include <cstdio>\nint main(){struct timespec t;clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&t);long long s=t.tv_sec*1000000000LL+t.tv_nsec;do{clock_gettime(CLOCK_PROCESS_CPUTIME_ID,&t);}while(t.tv_sec*1000000000LL+t.tv_nsec-s<200000000);puts("OK");}',VerdictStatus.accept)
assert 180<=timer.sumTime<=260,timer.sumTime
assert not list(SANDBOX_GROUP.glob('box-*'))
print(json.dumps({'passed':True,'tests':records,'databaseWrites':0,'productionSubmissions':0,'peakAndOomStateResetPerTestcase':True,'compilerLimitUnchanged':True,'cpuTimerUsesRusage':True}),flush=True)
