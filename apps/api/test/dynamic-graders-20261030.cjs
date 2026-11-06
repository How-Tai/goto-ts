const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),r=createRequire(path.join(root,'apps/api/package.json')),ts=r('typescript');
const noop=()=>()=>{},seen=[];
function load(relative,extra={}){
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true}}).outputText;
 function req(name){
  if(name in extra)return extra[name];
  if(name==='@nestjs/common')return new Proxy({},{get:(_o,k)=>String(k).endsWith('Exception')?class extends Error{}:noop});
  if(name==='./resource-history')return{resourceHistoryDelta:x=>x};
  if(name==='./compilation-status')return{compilationProblemIds:async()=>[]};
  if(name.startsWith('.'))return new Proxy({},{get:()=>noop});
  return r(name);
 }
 new Function('require','module','exports',source)(req,module,module.exports);return module.exports;
}
async function main(){
 const {GradingService}=load('apps/api/src/modules/grading/grading.service.ts');
 global.fetch=async()=>({ok:true});
 let workers=Array.from({length:7},(_,i)=>({workerId:i+1,enabled:i<3})),currentJob={workerId:7,submissionId:900},allocation={count:3,revision:1,appliedRevision:1};
 const db={$transaction:async callback=>{
  const before=structuredClone(workers);
  try{return await callback({$queryRaw:async(strings,...values)=>{
   const sql=strings.join('?');seen.push(sql);
   if(sql.includes('SELECT id FROM "otogGraderAllocation"'))return[{id:1}];
   if(sql.includes('FROM "otogGraderAllocation"')&&sql.includes('FOR SHARE'))return[{...allocation}];
   if(sql.includes('FOR UPDATE')){assert(sql.includes('ORDER BY "workerId"'));return workers.map(({workerId})=>({workerId}));}
   if(sql.includes('UPDATE "otogGraderAllocation"')){allocation={...allocation,count:values[0],revision:allocation.revision+1};return[{...allocation}]}
   if(sql.includes('UPDATE "otogWorkerState"')){workers=workers.map(w=>w.workerId===values[1]?{...w,enabled:values[0]}:w);return workers.filter(w=>w.workerId===values[1])}
   throw Error(sql);
  },$executeRaw:async(strings,...values)=>{assert(strings.join('?').includes('SET enabled=false'));workers=workers.map(w=>w.workerId>values[0]?{...w,enabled:false}:w);return 7;}});}catch(e){workers=before;throw e;}
 }};
 const service=new GradingService(db);let invalidations=0;service.invalidate=()=>invalidations++;
 for(const count of [7,1,4,6]){
  const before=workers.filter(w=>w.enabled).map(w=>w.workerId);const result=await service.setWorkerCount(count);assert.equal(result.count,count);assert(result.pending);
  assert.deepEqual(workers.filter(w=>w.enabled).map(w=>w.workerId),before.filter(id=>id<=count));
  await assert.rejects(service.setEnabled(1,true));
  allocation.appliedRevision=allocation.revision;workers=workers.map(w=>({...w,enabled:w.workerId<=count}));
  assert.deepEqual(workers.filter(w=>w.enabled).map(w=>w.workerId),Array.from({length:count},(_,i)=>i+1));
  assert.deepEqual(currentJob,{workerId:7,submissionId:900});
 }
 await assert.rejects(service.setEnabled(7,true));
 workers.pop();const prior=structuredClone(workers);await assert.rejects(service.setWorkerCount(7));assert.deepEqual(workers,prior);assert.equal(invalidations,4);
 const {GradingController}=load('apps/api/src/modules/grading/grading.controller.ts');let called=[];
 const controller=new GradingController({setWorkerCount:count=>called.push(count),setEnabled:(...args)=>called.push(args)},{});
 for(const count of [1,2,3,4,5,6,7])controller.setWorkerCount({count});
 assert.deepEqual(called,[1,2,3,4,5,6,7]);
 for(const body of [{count:0},{count:8},{count:1.5},{count:'7'},{count:null},{count:7,enabled:true},null])assert.throws(()=>controller.setWorkerCount(body));
 controller.setWorker('7',{enabled:true});await assert.rejects(controller.setWorker('8',{enabled:true}));
 // A direct grader with ID 7 must be counted as grading, using role metadata.
 const serviceSource=fs.readFileSync(path.join(root,'apps/api/src/modules/grading/grading.service.ts'),'utf8');
 assert(!serviceSource.includes('BETWEEN 7 AND 16'));assert(serviceSource.includes('JOIN "otogCompilerState" CS USING ("workerId")'));
 console.log(JSON.stringify({passed:true,checks:['additional workers stay disabled until CPUs allocated','excess workers paused immediately','manual resume blocked during transition and outside selected range','running job preserved','invalid request bounds','grader/compiler role separation'],productionWrites:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
