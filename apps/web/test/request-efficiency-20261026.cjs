const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),api=createRequire(root+'/apps/api/package.json'),web=createRequire(root+'/apps/web/package.json'),ts=api('typescript');let cursor=0,slots=[],failure=true,requests=[];
function load(relative){const file=path.resolve(root,relative),module={exports:{}};
 function req(name){
  if(name==='react')return{useRef(value){const i=cursor++;return slots[i]??={current:value}}};
  if(name==='@otog/contract')return load('packages/contract/src/index.ts');
  if(name==='../firebase/get-avatar-url')return{getAvatarUrl:()=>''};
  if(name==='./browser')return{clientArgs:{baseUrl:'http://fixture.invalid',jsonQuery:true}};
  if(name==='../api/query')return {submissionQuery:{uploadFile:{useMutation:()=>({isPending:false,mutateAsync:async args=>{
    requests.push(args);if(failure)throw{status:503};return{status:200,body:{id:7}}
  }})}}};
  if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name)+'.ts'));
  try{return api(name)}catch(error){if(error.code==='MODULE_NOT_FOUND')return web(name);throw error}
 }
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(req,module,module.exports);return module.exports;
}
async function main(){const checks=[],{SubmissionTracker}=load('apps/web/src/api/submission-tracker.ts');const tracker=new SubmissionTracker(()=>0);let changes=0,notices=0;tracker.onWatchChange=()=>changes++;
 const cleanups=Array.from({length:3},()=>tracker.subscribe(7,'waiting',()=>notices++));assert.deepEqual(tracker.ids(),[7]);assert.equal(changes,1);
 const now=Date.now();assert.deepEqual(tracker.pending(now),[7]);assert.deepEqual(tracker.pending(now+1000),[]);assert.deepEqual(tracker.pending(now+3001),[7]);
 const pending={id:7,status:'grading',queuedAt:new Date(0),updateDate:new Date(),submissionResult:null};tracker.apply([pending]);assert.equal(notices,3);tracker.apply([pending]);assert.equal(notices,3);assert.deepEqual(tracker.pending(Date.now()+1001),[7]);
 tracker.setReady(true);assert.deepEqual(tracker.pending(Date.now()+999999),[]);tracker.setReady(false);assert.deepEqual(tracker.pending(),[7]);
 const accepted={...pending,status:'accept',submissionResult:{id:1,score:100,timeUsed:10,memUsed:10,result:'A'}};tracker.apply([accepted]);assert.equal(tracker.get(7).submissionResult.score,100);tracker.queue(7);tracker.apply([accepted]);assert.equal(tracker.get(7).submissionResult,null);tracker.apply([{...pending,status:'waiting',updateDate:new Date(Date.now()+1)}]);assert.equal(tracker.get(7).submissionResult,null);
 cleanups.forEach(fn=>fn());assert.deepEqual(tracker.ids(),[]);assert.equal(tracker.get(7),undefined);assert.equal(changes,2);
 for(let id=1;id<=250;id++)tracker.subscribe(id,'waiting',()=>{});assert.equal(new Set(tracker.pending(Date.now()+1)).size,250);checks.push('shared observers produce one watched ID; waiting/grading intervals, no polling while live, reconnect resync, rejudge clearing and unsubscribe cleanup pass');
 const saved=Object.getOwnPropertyDescriptor(global,'crypto');Object.defineProperty(global,'crypto',{configurable:true,value:{getRandomValues:bytes=>crypto.randomFillSync(bytes)}});
 try{const {submissionRequestId}=load('apps/web/src/api/submission-request.ts');assert.match(submissionRequestId(),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const {useSubmissionUpload}=load('apps/web/src/hooks/use-submission-upload.ts');const hook=useSubmissionUpload();const args={params:{problemId:'1'},query:{contestId:'2'},body:{sourceCode:new File(['int main(){}'],'1.cpp'),language:'cpp'}};
  await assert.rejects(hook.mutateAsync(args));const first=requests.at(-1).headers['idempotency-key'];await assert.rejects(hook.mutateAsync(args));assert.equal(requests.at(-1).headers['idempotency-key'],first);
  failure=false;await hook.mutateAsync(args);assert.equal(requests.at(-1).headers['idempotency-key'],first);await hook.mutateAsync(args);assert.notEqual(requests.at(-1).headers['idempotency-key'],first);
  failure=true;const changed={...args,body:{...args.body,sourceCode:new File(['int main(){return 1;}'],'1.cpp')}};await assert.rejects(hook.mutateAsync(changed));const next=requests.at(-1).headers['idempotency-key'];assert.notEqual(next,first);
  const form=new FormData();form.set('sourceCode',changed.body.sourceCode);form.set('language','cpp');await assert.rejects(hook.mutateAsync({...changed,body:form}));assert.equal(requests.at(-1).headers['idempotency-key'],next);
  checks.push('lost-response retries reuse a request ID; successful or changed-code attempts get a new ID; multipart and local HTTP without crypto.subtle/randomUUID work');
 }finally{if(saved)Object.defineProperty(global,'crypto',saved);else delete global.crypto}
 const keys=load('apps/web/src/api/query.ts');assert.equal(keys.appKey.time().staleTime,1000);assert.equal(keys.contestKey.getContest({params:{contestId:'2'}}).staleTime,10000);assert.equal(keys.contestKey.getCurrentContests().staleTime,10000);assert.equal(keys.problemKey.getProblem({params:{problemId:'1'}}).staleTime,10000);assert.deepEqual(keys.contestKey.getContest._def,['contest','getContest']);assert.deepEqual(keys.submissionKey._def,['submission']);checks.push('real query-key factory retains metadata freshness, live clock freshness and invalidation prefixes');
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));}
main().catch(error=>{console.error(error);process.exitCode=1});
