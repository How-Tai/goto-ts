"""Bounded launcher equivalence checks in the restricted test container."""
from pathlib import Path
import importlib.util,json,os,resource,signal,statistics,sys,tempfile,time
sys.path.insert(0,'/usr/src/app/src')
import grader_safety as candidate
spec=importlib.util.spec_from_file_location('baseline','/baseline-grader-safety.py');baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)
assert candidate._NATIVE_LIMIT_LAUNCHER.is_file()
records=[]
def run(module,args,memory=None,seconds=3,cwd=None):return module.infrastructure_command(args,seconds,cwd=cwd,memory_mib=memory)
def compare(label,args,memory=None,cwd=None):
 a=run(baseline,args,memory,cwd=cwd);b=run(candidate,args,memory,cwd=cwd);assert a==b,(label,a,b);records.append(label);return b
compare('stdout-stderr-exit-and-literal-arguments',['/bin/sh','-c','printf "%s\\n" "$1";printf err >&2;exit 7','sh','--pid=42 $(not-a-command)'])
compare('resource-limits',['/bin/cat','/proc/self/limits'])
limits=compare('optional-address-space-limit',['/bin/cat','/proc/self/limits'],128)
assert b'134217728' in limits[1]
def dispositions(module):
 code,out,err=run(module,['/bin/cat','/proc/self/status']);assert code==0
 fields=dict(line.split(':',1) for line in out.decode().splitlines() if ':' in line)
 return {key:fields[key].strip() for key in ['SigIgn','SigBlk']}
assert dispositions(baseline)==dispositions(candidate);records.append('inherited-signal-dispositions')
with tempfile.TemporaryDirectory(dir='/tmp') as folder:
 compare('working-directory',['/bin/pwd'],cwd=folder)
 # Inspect Python's resource view as well as the native process's /proc view.
 code,out,err=run(candidate,[sys.executable,'-c','import resource,json;print(json.dumps([resource.getrlimit(x) for x in [resource.RLIMIT_FSIZE,resource.RLIMIT_CORE,resource.RLIMIT_AS]]))'],128)
 assert code==0;assert json.loads(out)==[[67108864,67108864],[0,0],[134217728,134217728]];records.append('soft-and-hard-limits')
 for module,label in [(baseline,'old'),(candidate,'new')]:
  child=Path(folder)/(label+'-child.pid');leader=Path(folder)/(label+'-leader.pid');marker=Path(folder)/(label+'-marker')
  script='import os,pathlib,time\npathlib.Path('+repr(str(leader))+').write_text(str(os.getpid()))\npid=os.fork()\nif pid==0:\n pathlib.Path('+repr(str(child))+').write_text(str(os.getpid()))\n time.sleep(1)\n pathlib.Path('+repr(str(marker))+').write_text("late")\nelse:\n time.sleep(3)\n'
  try:run(module,[sys.executable,'-c',script],seconds=.6)
  except module.SandboxHealthError:pass
  else:raise AssertionError('Timeout did not fire: '+label)
  assert child.exists() and leader.exists();assert int(leader.read_text())!=os.getpid()
  time.sleep(1.1);assert not marker.exists(),'Timed-out descendant survived: '+label
 records.append('timeout-kills-process-group')
 # A successful helper also cannot leave a delayed child behind.
 for module,label in [(baseline,'old-success'),(candidate,'new-success')]:
  marker=Path(folder)/(label+'-marker')
  script='import os,pathlib,time\nif os.fork()==0:\n time.sleep(.4)\n pathlib.Path('+repr(str(marker))+').write_text("late")\nelse:\n os._exit(0)\n'
  assert run(module,[sys.executable,'-c',script])[0]==0
  time.sleep(.5);assert not marker.exists(),label
 records.append('success-cleans-background-descendants')
 for memory in [True,31,1025,'128',128.0]:
  for module in [baseline,candidate]:
   try:run(module,['/bin/true'],memory)
   except ValueError:pass
   else:raise AssertionError(memory)
 records.append('invalid-memory-limits-rejected')
 for module in [baseline,candidate]:assert run(module,['/does-not-exist'])[0]!=0
 records.append('missing-command-fails-closed')
 native=candidate._NATIVE_LIMIT_LAUNCHER;candidate._NATIVE_LIMIT_LAUNCHER=Path('/missing-native-launcher')
 try:compare('legacy-fallback-retains-limits',['/bin/cat','/proc/self/limits'],128)
 finally:candidate._NATIVE_LIMIT_LAUNCHER=native
 # No-op commands isolate launcher overhead from Isolate/checker work.
 measurements={'baseline':[],'candidate':[]}
 for repeat in range(20):
  sequence=[('baseline',baseline),('candidate',candidate)] if repeat%2==0 else [('candidate',candidate),('baseline',baseline)]
  for label,module in sequence:
   start=time.perf_counter();assert run(module,['/bin/true'])[0]==0;measurements[label].append((time.perf_counter()-start)*1000)
 print(json.dumps({'passed':True,'checks':records,'launcherBenchmark':{label:{'medianMs':statistics.median(values),'minMs':min(values),'maxMs':max(values)} for label,values in measurements.items()},'nativeLauncher':str(native),'productionWrites':0}),flush=True)
