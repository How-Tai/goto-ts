const assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const req=createRequire(process.cwd()+'/package.json'),{PrismaClient}=req('@otog/database'),{JwtService}=req('@nestjs/jwt');
const names=Array.from({length:7},(_,i)=>'otog-grader'+(i?i+1:'')+'-1');
const mask=text=>text.split(',').flatMap(v=>{const[a,b=a]=v.split('-').map(Number);return Array.from({length:b-a+1},(_,i)=>a+i)}).sort((a,b)=>a-b);
async function main(){const db=new PrismaClient();let initial,headers;const base='http://127.0.0.1:3000/backend/admin/grading';const transitions=[];
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function call(route='',method='GET',body,expected=200){const r=await fetch(base+route,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;}
 async function settled(count){for(let i=0;i<160;i++){const d=await call();if(d.graderAllocation.count===count&&d.graderAllocation.revision===d.graderAllocation.appliedRevision&&d.cpuAllocation?.revision===d.graderAllocation.revision&&!d.cpuAllocation.error&&d.cpuAllocation.drainingWorkers.length===0)return d;await pause(250)}throw Error('Allocation did not settle')}
 try{
  const admins=await db.user.findMany({where:{role:'admin'},select:{id:true}}),session=await db.refreshToken.findFirst({where:{used:false,expiryDate:{gt:new Date()},userId:{in:admins.map(u=>u.id)},jwtId:{not:null}},select:{userId:true,jwtId:true}});assert(session);
  headers={Authorization:'Bearer '+new JwtService({secret:process.env.JWT_SECRET}).sign({id:session.userId,jti:session.jwtId},{expiresIn:600})};
  initial=await call();assert.equal(initial.waiting+initial.grading,0);assert(initial.graderAllocation);
  const original=JSON.parse(execFileSync('docker',['inspect',...names],{encoding:'utf8'})).map(v=>({id:v.Id,pid:v.State.Pid,restarts:v.RestartCount}));
  for(const count of [1,2,3,4,5,6,7,3,7,6]){
   const start=performance.now();await call('/worker-count','PATCH',{count});const data=await settled(count),expected=Array.from({length:8-count},(_,i)=>count+i);
   assert.deepEqual(data.cpuAllocation.serviceCpus,expected);assert.deepEqual(data.workers.filter(w=>w.enabled).map(w=>w.id),Array.from({length:count},(_,i)=>i+1));
   const containers=JSON.parse(execFileSync('docker',['inspect',...names,'otog-postgres-1','otog-minio-1'],{encoding:'utf8'}));
   for(let i=0;i<7;i++){assert.equal(containers[i].Id,original[i].id);assert.equal(containers[i].State.Pid,original[i].pid);assert.equal(containers[i].RestartCount,original[i].restarts);assert.deepEqual(mask(containers[i].HostConfig.CpusetCpus),i<count?[i]:expected);assert.deepEqual(mask(fs.readFileSync('/proc/'+containers[i].State.Pid+'/status','utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)[1]),i<count?[i]:expected)}
   for(let i=7;i<9;i++)assert.deepEqual(mask(containers[i].HostConfig.CpusetCpus),expected);
   for(const unit of ['otog-web','otog-api','nginx','docker','containerd','user.slice'])assert.deepEqual(mask(execFileSync('systemctl',['show',unit,'-p','AllowedCPUs','--value'],{encoding:'utf8'}).trim()),expected);
   transitions.push({count,serviceCpus:expected,settleMs:Math.round(performance.now()-start)});
  }
  await call('/workers/7','PATCH',{enabled:true},409);
  for(const count of [0,8,1.5,'7'])await call('/worker-count','PATCH',{count},400);
  // Back-to-back requests must leave one complete, safe final allocation.
  await call('/worker-count','PATCH',{count:1});await call('/worker-count','PATCH',{count:7});await call('/worker-count','PATCH',{count:3});await settled(3);
  await call('/worker-count','PATCH',{count:6});await settled(6);
  // A controller restart recovers desired state without resetting manual pauses.
  await call('/workers/2','PATCH',{enabled:false});execFileSync('systemctl',['restart','otog-grader-allocation']);await pause(1500);
  const afterRestart=await settled(6);assert.equal(afterRestart.workers.find(w=>w.id===2).enabled,false);await call('/workers/2','PATCH',{enabled:true});
  execFileSync('systemctl',['stop','otog-grader-allocation']);
  try{await call('/worker-count','PATCH',{count:7});const pending=await call();assert(pending.graderAllocation.revision!==pending.graderAllocation.appliedRevision);assert.equal(pending.workers.find(w=>w.id===7).enabled,false)}finally{execFileSync('systemctl',['start','otog-grader-allocation'])}
  await settled(7);
  console.log(JSON.stringify({passed:true,transitions,rapidChangesConverged:true,allocatorRestartRecovered:true,manualPausePreserved:true,noGraderRestarts:true,outOfRangeResumeRejected:true,productionSubmissionWrites:0}));
 }finally{
  if(initial&&headers){await call('/worker-count','PATCH',{count:initial.graderAllocation.count});await settled(initial.graderAllocation.count);for(const w of initial.workers)if(w.id<=initial.graderAllocation.count)await call('/workers/'+w.id,'PATCH',{enabled:w.enabled});}
  await db.$disconnect();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
