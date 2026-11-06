"""Compare the fast path with the deployed checker, including fallback errors."""
from pathlib import Path
import importlib.util,json,os,random,statistics,sys,tempfile,time
sys.path.insert(0,'D:/otog-grader/src' if os.name=='nt' else '/usr/src/app/src')
from DTO.testcaseData import TestcaseData
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
baseline=load('baseline',sys.argv[1] if len(sys.argv)>1 else '/baseline-standard.py')
candidate=load('candidate',sys.argv[2] if len(sys.argv)>2 else '/usr/src/app/src/evaluate/verdict/standard.py')
rng=random.Random(3101026);count=0;fast_hits=0
original=candidate._identical_text
def counted(*args):
 global fast_hits
 result=original(*args);fast_hits+=bool(result);return result
candidate._identical_text=counted
with tempfile.TemporaryDirectory(dir='tmp' if os.name=='nt' else '/tmp') as directory:
 root=Path(directory);user=root/'user';reference=root/'reference';dto=TestcaseData(str(user),str(reference),1,str(user))
 def verdict(module):
  try:
   status,score=module.getVerdict(dto);return ('verdict',status.value,score)
  except Exception as error:return ('error',type(error).__name__,str(error))
 def compare(left,right):
  global count
  user.write_bytes(left);reference.write_bytes(right);a=verdict(baseline);b=verdict(candidate)
  assert a==b,(count,left[:80],right[:80],a,b);count+=1
 values=['','a','12345','hello world','\u0e01\u0e02\u0e04','\U0001f642','\u00a0','\t',' ', '\v','\f','\u2028']
 for i in range(4000):
  text=''.join(rng.choice(values)+rng.choice(['','\n','\r\n','\r']) for _ in range(rng.randrange(20)))
  mode=i%5
  other=text if mode==0 else text+' \t\n\n' if mode==1 else text.replace('\r\n','\n') if mode==2 else text+'x' if mode==3 else ''.join(rng.choice(values) for _ in range(rng.randrange(20)))
  compare(text.encode(),other.encode())
 for n in [65534,65535,65536,65537,65538,131071,131072,131073]:
  for char in ['a','\u0e01','\U0001f642']:
   value=(char*n).encode()
   for left,right in [(value,value),(value+b' \n',value+b'\n'),(value+b'X',value+b'Y'),(value+b'\r\n\n',value+b'\n')]:compare(left,right)
 for bad in [b'\xff',b'\xc3',b'\xe0\x80\x80',b'\xed\xa0\x80',b'\xf4\x90\x80\x80']:
  for prefix in [b'',b'ok\n',b'a'*8191,b'a'*65536]:
   for a,b in [(bad,bad),(bad,b'valid'),(b'valid',bad),(bad,b'other\n'+bad),(b'other\n'+bad,bad)]:compare(prefix+a,prefix+b)
 for a,b in [(b'',b' \t\r\n'*100000),(b'\n'*100000,b''),(b'0\n',b'0\n'+b' '*1000000)]:compare(a,b)
 user.write_bytes(b'1234567\n'*250000);reference.write_bytes(user.read_bytes());bench={}
 for name,module in [('baseline',baseline),('candidate',candidate)]:
  times=[]
  for _ in range(3):
   start=time.perf_counter();assert verdict(module)[1]=='ACCEPTED';times.append(time.perf_counter()-start)
  bench[name]={'seconds':times,'medianSeconds':statistics.median(times)}
 print(json.dumps({'passed':True,'equivalenceCases':count,'fastPathAcceptedCases':fast_hits,'identicalMultilineBytes':user.stat().st_size,'comparisonBenchmark':bench,'boundedChunkCharacters':candidate._CHUNK,'fallbackPreservesWhitespaceAndEncodingErrors':True,'productionWrites':0}),flush=True)
