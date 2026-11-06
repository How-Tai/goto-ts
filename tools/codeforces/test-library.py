"""Bounded author fixtures; native C++ linking and validator diagnostics.

The sandbox adapter is substituted on Windows. This does not test Linux
Isolate, cgroups, or containment. Run test-e2e.cjs on disposable Linux before
rolling the worker out. No participant or hostile source is executed here.
"""
from pathlib import Path
from types import SimpleNamespace, ModuleType
import importlib.util,sys,tempfile,shutil,subprocess,shlex,json,os
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
GRADER=Path(os.environ.get('OTOG_TEST_GRADER_SOURCE',ROOT/'grader/src'))
if not GRADER.exists():GRADER=ROOT/'tmp/github-combined/repo/grader/src'
sys.path.insert(0,str(GRADER))
safe=ModuleType('grader_safety');safe.SandboxHealthError=type('SandboxHealthError',(RuntimeError,),{})
safe.watchdog_phase=lambda *a,**k:lambda f:f
safe.infrastructure_command=lambda *a,**k:None
sys.modules['grader_safety']=safe
sys.modules['psycopg2']=ModuleType('psycopg2')
sys.modules['psycopg2.extras']=SimpleNamespace(Json=lambda x:x)
spec=importlib.util.spec_from_file_location('cf',ROOT/'tools/grading/cf_grading.py');cf=importlib.util.module_from_spec(spec);spec.loader.exec_module(cf)
checks=[]
with tempfile.TemporaryDirectory(prefix='cf-library-') as tmp:
 old=Path.cwd();os.chdir(tmp)
 try:
  problem=Path('problem').resolve();problem.mkdir();box=Path('box').resolve();box.mkdir();Path('env').mkdir()
  (problem/'task.h').write_text('int doubled(int);\n')
  (problem/'grader.cpp').write_text('#include <iostream>\n#include "task.h"\nint main(){int n;std::cin>>n;std::cout<<doubled(n)<<"\\n";}')
  handle=SimpleNamespace(initIsolate=lambda _:str(box),fileWrite=lambda p,s:Path(p).write_text(s),
   prepareEnv=lambda p,b:[shutil.copy2(x,Path(b)/x.name) for x in Path(p).iterdir() if x.suffix in ('.h','.hpp','.cpp','.c')],
   create=lambda *a:None,errMsgHandle=lambda x:x)
  commands=[]
  def compile_source(language,source,problem_path,box_path,command,*a):
   commands.append(command)
   args=[shutil.which('g++')]+[v.replace('[sourcePath]',source).replace('[binPath]',str(box/'out')).replace('-I/box','-I'+str(box)).replace('/box/',str(box)+os.sep) for v in shlex.split(command)[1:]]
   r=subprocess.run(args,capture_output=True,text=True,timeout=20)
   (box/'error.txt').write_text(r.stderr,encoding='utf8')
   return 'Compilation Error' if r.returncode else None
  security=SimpleNamespace(release_sandbox=lambda:None,compile_submission=compile_source,
   copy_testcase_output=lambda b,n,t:shutil.copyfile(Path(b)/n,t))
  with patch.dict(sys.modules,{'handle':handle,'sandbox_security':security,'cmdManager':SimpleNamespace(get=lambda *a:'cpp')}):
   s=SimpleNamespace(id=1,userId=1,language='cpp',sourceCode='#include "task.h"\nint doubled(int n){return n*2;}')
   cfg={'taskType':'library','graderFiles':['grader.cpp']}
   built=cf._compile(s,problem,config=cfg);assert built[3] is None
   exe=box/('out.exe' if os.name=='nt' else 'out')
   assert subprocess.run([str(exe)],input='7\n',capture_output=True,text=True,timeout=2).stdout.strip()=='14'
   assert 'grader.cpp' in commands[-1]
   # Both reference and hacked target use this exact library build path.
   built=cf._compile(s,problem,'#include "task.h"\nint doubled(int n){return n*3;}','cpp',cfg)
   assert built[3] is None
   assert subprocess.run([str(exe)],input='7\n',capture_output=True,text=True,timeout=2).stdout.strip()=='21'
   assert cf._compile(s,problem,'int unrelated(){return 0;}','cpp',cfg)[3]
   assert 'undefined reference' in Path('env/error.txt').read_text(encoding='utf8').lower()
   checks.append('Native C++ library/reference/target linking; missing implementation reports compile error')
   for names in [[],['grader.cpp','grader.cpp'],['../grader.cpp'],['solution.cpp'],['missing.cpp']]:
    try:cf._compile(s,problem,config={'taskType':'library','graderFiles':names})
    except cf.AuthorToolError:pass
    else:raise AssertionError(names)
   checks.append('Library grader list validation and unsupported source rejection')
  # Exercise the actual CF Tool.run metadata/diagnostic path with bounded I/O.
  tool=cf.Tool.__new__(cf.Tool);state=Path('tool-state').resolve();state.mkdir();(state/'binCheck').write_text('fixture')
  toolbox=Path('tool-box').resolve();toolbox.mkdir();(problem/'1.in').write_text('7\n')
  def copy(src,dest,*a,**kw):shutil.copyfile(src,dest)
  tool.c=SimpleNamespace(_new_box=lambda:toolbox,_fresh_group=lambda _:None,_copy_regular=copy,STATE=state,_native=lambda:[],_read_regular=lambda p:Path(p).read_bytes())
  def isolate_metadata(*a,**kw):
   Path('env/cf-tool-meta.txt').write_text('status:RE\nexitcode:3\n')
   (toolbox/'tool-error.txt').write_text('FAIL Validator must end with readEof call.\n')
  with patch.object(cf,'infrastructure_command',isolate_metadata):
   assert tool.run({'input.txt':problem/'1.in'}) is False
   assert 'readEof' in tool.diagnostic
  checks.append('Validator exit 3 is rejected input with retained diagnostic, not a contestant WA')
  # Actual orchestration stores that diagnostic and the real testcase number.
  class Validator:
   diagnostic='FAIL input outside allowed range'
   def __init__(self,*a):pass
   def run(self,*a,**kw):return False
  job={'kind':'validator','phase':'validation','plan':{'config':{'timeLimit':1000,'memoryLimit':64,'fullTests':[13],'pretests':[13],'validatorSource':'fixture'}}}
  results=[]
  with patch.object(cf,'_bundle',lambda _:problem),patch.object(cf,'Tool',Validator),patch.object(cf,'_progress',lambda *a:None):
   cf.run(None,SimpleNamespace(id=2),job,results.append,lambda *a:None)
  result=results[0]
  assert result.cf_outcome['verdict']=='validation_failed'
  assert result.cf_outcome['failedTest']==13 and result.cf_outcome['failedTestIndex']==1
  assert 'outside allowed range' in result.errmsg
  checks.append('Validation verdict, diagnostic, sparse testcase number and scoring index persist together')
  # Practice is deliberately included in the system-test plus successful-hack path.
  class Cursor:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def execute(self,sql,args):assert args[1]=='system'
   def fetchall(self):return [(100,)]
  conn=SimpleNamespace(cursor=lambda:Cursor(),commit=lambda:None)
  cases=cf._hacks(conn,{'cfProblemId':1,'phase':'system','plan':{'config':{'fullTests':[1,13]}}},SimpleNamespace(userId=1),problem)
  assert cases==[(14,100)]
  checks.append('Archived practice includes retained successful hacks in its system test plan')
 finally:os.chdir(old)
print(json.dumps({'passed':True,'checks':checks,'linuxSandboxTested':False}))
