const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const req=createRequire(process.cwd()+'/package.json'),{PrismaClient}=req('@otog/database'),{JwtService}=req('@nestjs/jwt');
async function main(){const db=new PrismaClient();let initial,headers;const url='http://127.0.0.1:3000/backend/admin/grading';
 async function call(path='',method='GET',body,status=200){const response=await fetch(url+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
 try{
  const admins=await db.user.findMany({where:{role:'admin'},select:{id:true}});
  const session=await db.refreshToken.findFirst({where:{used:false,expiryDate:{gt:new Date()},userId:{in:admins.map(u=>u.id)},jwtId:{not:null}},select:{userId:true,jwtId:true}});assert(session,'An existing administrator session is needed');
  headers={Authorization:'Bearer '+new JwtService({secret:process.env.JWT_SECRET}).sign({id:session.userId,jti:session.jwtId},{expiresIn:240})};
  assert.equal((await fetch(url+'/worker-count',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"count":7}'})).status,401);
  initial=await call();assert.equal(initial.waiting+initial.grading,0,'Do not interrupt active production work');
  assert.equal(initial.workers.length,7);assert(initial.workers.every(w=>w.connected));assert.equal(initial.compilation.slots.length,0);
  for(const count of [1,2,3,4,5,6,7]){
   await call('/worker-count','PATCH',{count});const data=await call();assert.deepEqual(data.workers.filter(w=>w.enabled).map(w=>w.id),Array.from({length:count},(_,i)=>i+1));
  }
  for(const count of [0,8,1.5,'7'])await call('/worker-count','PATCH',{count},400);
  await call('/worker-count','PATCH',{count:7,enabled:false},400);
  await call('/settings','PATCH',{maxWorkersPerUser:7});assert.equal((await call()).maxWorkersPerUser,7);
  await call('/settings','PATCH',{maxWorkersPerUser:initial.maxWorkersPerUser});
  await call('/workers/7','PATCH',{enabled:false});const worker=(await call()).workers.find(w=>w.id===7);assert(!worker.enabled&&worker.submissionId===null);
  const body={confirmed:true,startedAt:worker.startedAt,submissionId:null};await call('/workers/7/kill','POST',body);
  let restarted;
  for(let n=0;n<40;n++){restarted=(await call()).workers.find(w=>w.id===7);if(restarted.connected&&restarted.startedAt!==worker.startedAt)break;await new Promise(r=>setTimeout(r,500));}
  assert(restarted.connected&&restarted.startedAt!==worker.startedAt);assert(!restarted.enabled);assert.equal(restarted.cpuId,6);
  // The immutable snapshot protects against a stale restart after a new process starts.
  await call('/workers/7/kill','POST',body,409);
  console.log(JSON.stringify({passed:true,selectedCounts:[1,2,3,4,5,6,7],invalidRequestsRejected:true,unauthenticatedDenied:true,seventhRestartVerified:true,pauseSurvivesRestart:true,staleRestartRejected:true,perUserSevenSupported:true,graderCpus:initial.workers.map(w=>w.cpuId),productionSubmissionWrites:0}));
 }finally{
  if(initial&&headers){
   await call('/settings','PATCH',{maxWorkersPerUser:initial.maxWorkersPerUser});
   for(const worker of initial.workers)await call('/workers/'+worker.id,'PATCH',{enabled:worker.enabled});
  }
  await db.$disconnect();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
