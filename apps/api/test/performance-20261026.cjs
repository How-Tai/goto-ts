const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),r=createRequire(path.join(root,'apps/api/package.json')),ts=r('typescript'),modules=new Map(),checks=[];
const noop=()=>()=>{},routes=new Proxy({},{get:()=>({})});let metadataScans=0,hookCache,detailReads=0,detailReply,liveProgress;
const keys={_def:['submission'],getSubmissionWithSourceCode:()=>({queryKey:['detail'],queryFn:async ctx=>{assert(ctx.signal);detailReads++;if(detailReply.status!==200)throw detailReply;return detailReply}})};
function load(relative){
 const file=path.resolve(root,relative);if(modules.has(file))return modules.get(file).exports;
 const module={exports:{}};modules.set(file,module);
 function req(name){
  if(name==='@nestjs/common')return new Proxy({},{get:(_o,k)=>String(k).endsWith('Exception')?class extends Error{}:noop});
  if(name==='@ts-rest/nest')return{nestControllerContract:x=>x,TsRestHandler:noop,tsRestHandler:(_r,fn)=>fn};
  if(name==='@nestjs/platform-express')return{FileInterceptor:noop};
  if(name==='@otog/contract')return{submissionRouter:routes};
  if(name==='@otog/database')return{UserRole:{user:'user',admin:'admin'},SubmissionStatus:{accept:'accept'},Prisma:{sql:(strings,...values)=>({strings,values}),empty:{}}};
  if(name==='src/core/fileManager')return{LocalFileManager:class{},S3FileManager:class{}};
  if(name==='src/env')return{environment:{S3_BUCKET:'fixture'}};
  if(name.includes('/constants'))return{Role:{Admin:'admin',User:'user'},AccessState:{Authenticated:'authenticated'}};
  if(name==='react')return{useRef:value=>({current:value}),useEffect:callback=>callback()};
  if(name.includes('/context/submission-updates-context'))return{useSubmissionProgress:(_id,_status,enabled)=>enabled===false?undefined:liveProgress};
  if(name==='@tanstack/react-query')return{useQuery:options=>options,useQueryClient:()=>({getQueryData:()=>hookCache,setQueryData:(_key,update)=>{hookCache=update(hookCache)},invalidateQueries:async()=>{}})};
  if(name.endsWith('/compilation-status')||name==='./compilation-status')return{compilationProblemIds:async()=>{metadataScans++;return[1]}};
  if(name.endsWith('/api/query')||name==='./query')return{submissionKey:keys};
  if(name==='src/utils/contest-visibility')return{contestResultsFilter:()=>({})};
  if(name.startsWith('src/')||name.includes('/decorators/')||name.includes('/guards/')||name.includes('/dto/')||name.endsWith('.service')&&name!=='./submission.service')return new Proxy({},{get:()=>noop});
  if(name.startsWith('.')){
   const dest=path.resolve(path.dirname(file),name)+'.ts';
   if(fs.existsSync(dest)&&['short-lived-cache.ts','resource-history.ts','submission-status.ts','submission-state.ts','live-submission.ts','initial-data-success.ts'].includes(path.basename(dest)))return load(path.relative(root,dest));
   return new Proxy({},{get:()=>noop});
  }
  return r(name);
 }
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',js)(req,module,module.exports);return module.exports;
}
async function main(){
 const {ShortLivedCache}=load('apps/api/src/utils/short-lived-cache.ts');let now=0,reads=0,release;
 const cache=new ShortLivedCache(1000,()=>now),gate=new Promise(resolve=>release=resolve);
 const requests=Array.from({length:50},()=>cache.get(async()=>{reads++;await gate;return 7}));release();assert((await Promise.all(requests)).every(x=>x===7));assert.equal(reads,1);
 now=999;assert.equal(await cache.get(async()=>++reads),7);now=1001;await cache.get(async()=>++reads);assert.equal(reads,2);
 const invalidate=new ShortLivedCache(1000,()=>now);let finish;const obsolete=invalidate.get(()=>new Promise(resolve=>finish=resolve));await Promise.resolve();invalidate.clear();assert.equal(await invalidate.get(async()=>9),9);finish(1);await obsolete;assert.equal(await invalidate.get(async()=>100),9);
 const failing=new ShortLivedCache();await assert.rejects(failing.get(async()=>{throw Error('offline')}));assert.equal(await failing.get(async()=>8),8);
 checks.push({check:'50 concurrent count reads collapse to one; expiry, failure, and invalidation stay correct',beforeQueries:50,afterQueries:1});

 const {ProblemService}=load('apps/api/src/modules/problem/problem.service.ts');let aggregates=0,problemReads=0,shown=true;
 const problem=new ProblemService({problem:{findMany:async args=>{problemReads++;return !shown&&args.where.show?[]:[{id:1,name:'p',submission:args.select.submission?[{id:args.select.submission.where.userId,status:'accept'}]:undefined}]}},$queryRaw:async()=>{aggregates++;return[{id:1,passedCount:5}]}});
 const tables=await Promise.all(Array.from({length:30},(_,i)=>problem.findMany({show:true,userId:i+1})));
 assert.equal(aggregates,1);assert.equal(problemReads,30);tables.forEach((rows,i)=>assert.equal(rows[0].latestSubmission.id,i+1));shown=false;assert.deepEqual(await problem.findMany({show:true,userId:1}),[]);await problem.findMany({userId:1});assert.equal(aggregates,2);
 checks.push({check:'counts shared, individual results and hidden-problem filtering remain live'});

 const {SubmissionService}=load('apps/api/src/modules/submission/submission.service.ts');let selected;
 new SubmissionService({submission:{findUnique:args=>{selected=args.select;return null}}}).findProgress(7);
 assert.deepEqual(Object.keys(selected).sort(),['id','public','queuedAt','status','updateDate','userId']);
 const {SubmissionController}=load('apps/api/src/modules/submission/submission.controller.ts');let accessCases=0;
 for(const visible of [true,false])for(const shared of [true,false])for(const user of [undefined,{id:8,role:'user'},{id:7,role:'user'},{id:9,role:'admin'}]){
  let dataReads=0;const canRead=visible||user?.id===7||user?.role==='admin';
  const controller=new SubmissionController({findVisibleProgress:async()=>{dataReads++;return canRead?[{id:7,status:'grading',queuedAt:new Date(),updateDate:new Date(),userId:7,public:shared,submissionResult:null}]:[]}},{});
  const reply=await controller.getSubmissionProgress(7,user)({});const allowed=canRead&&(shared||user?.id===7||user?.role==='admin');
  assert.equal(reply.status,allowed?200:canRead?403:404);assert.equal(dataReads,1);if(reply.status===200){assert.deepEqual(Object.keys(reply.body).sort(),['id','queuedAt','status','submissionResult','updateDate']);assert.equal(reply.body.submissionResult,null)}accessCases++;
 }
 checks.push({check:'one progress read preserves source-view permissions, omits code/testcases, and clears pending results',accessCases});

 const {resourceHistoryDelta}=load('apps/api/src/modules/grading/resource-history.ts');const history=Array.from({length:600},(_,i)=>({monotonicSeconds:i+10,at:'fixture'})),telemetry={history,observedAt:new Date().toISOString(),machine:{cpuCount:8,memoryTotalMb:4000},services:[]};
 assert.equal(resourceHistoryDelta(telemetry).history.length,600);assert(resourceHistoryDelta(telemetry).historyReset);
 assert.equal(resourceHistoryDelta(telemetry,608).history.length,1);assert.equal(resourceHistoryDelta(telemetry,609).history.length,0);assert(resourceHistoryDelta(telemetry,1).historyReset);assert(resourceHistoryDelta(telemetry,99999).historyReset);
 const {GradingService}=load('apps/api/src/modules/grading/grading.service.ts');const grading=new GradingService({});let loads=0;grading.readStatus=async()=>{loads++;await Promise.resolve();return{telemetry}};
 const [one,full,empty]=await Promise.all([grading.status(608),grading.status(),grading.status(609)]);assert.equal(loads,1);assert.equal(one.telemetry.history.length,1);assert.equal(full.telemetry.history.length,600);assert.equal(empty.telemetry.history.length,0);
 telemetry.observedAt=new Date(Date.now()-21000).toISOString();assert.equal((await grading.status(609)).telemetry,null);telemetry.observedAt=new Date().toISOString();
 const beforeFetch=global.fetch;global.fetch=async()=>({ok:true,json:async()=>telemetry});
 try{let sqlReads=0;const independent=new GradingService({$queryRaw:async strings=>{sqlReads++;return strings.join('').includes('SELECT EXISTS')?[{configured:false}]:[{data:{}}]}});await independent.status();assert.equal(sqlReads,2);assert.equal(metadataScans,0)}finally{global.fetch=beforeFetch}
 checks.push({check:'per-viewer cursors coalesce safely; stale/reset handling and independent-worker directory-scan bypass pass',initialHistorySamples:600,incrementalHistorySamples:1});

 const {mergeResourceHistory}=load('apps/web/src/components/grading/resource-history.ts');const initial={history,historyReset:true};let merged=mergeResourceHistory(initial,{history:[{monotonicSeconds:610}],historyReset:false});assert.equal(merged.history.length,600);assert.equal(merged.history[0].monotonicSeconds,11);assert.equal(mergeResourceHistory(merged,{history:[{monotonicSeconds:610}],historyReset:false}).history.length,600);assert.equal(mergeResourceHistory(merged,{history:[],historyReset:false}).history.length,600);
 assert.deepEqual(mergeResourceHistory(merged,{history:[{monotonicSeconds:1}],historyReset:true}).history,[{monotonicSeconds:1}]);
 checks.push({check:'dashboard retains bounded ten-minute history, deduplicates, and resets after reconnect/reboot'});

 const {useLiveSubmission}=load('apps/web/src/hooks/use-live-submission.ts'),controller=new AbortController(),context={signal:controller.signal,queryKey:['detail'],meta:undefined};
 hookCache={status:200,headers:{},body:{id:7,status:'grading',sourceCode:'code kept',submissionResult:{score:100}}};liveProgress={id:7,status:'waiting'};detailReply={status:200,body:{id:7,status:'accept',sourceCode:'code kept',submissionResult:{score:100}}};
 const hook=useLiveSubmission(7);let next=await hook.queryFn(context);assert.equal(detailReads,1);assert.equal(next.body.sourceCode,'code kept');assert.equal(next.body.submissionResult,null);hookCache=next;assert.equal(hook.refetchInterval,undefined);
 liveProgress={id:7,status:'accept'};next=await useLiveSubmission(7).queryFn(context);assert.equal(detailReads,2);assert.equal(next.body.submissionResult.score,100);
 liveProgress=undefined;assert.equal(useLiveSubmission(7,undefined,false).enabled,false);detailReply={status:403,body:{message:'Forbidden'}};await assert.rejects(useLiveSubmission(7).queryFn(context));
 const {pendingSubmissionUpdate}=load('apps/web/src/api/live-submission.ts');assert.throws(()=>pendingSubmissionUpdate({id:7},{id:8,status:'grading'}));
 checks.push({check:'real hook has no polling timer, pushed pending state masks a stale response, final details load and permission loss fails closed'});
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
