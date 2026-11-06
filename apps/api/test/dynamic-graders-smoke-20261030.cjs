const assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const req=createRequire(process.cwd()+'/package.json'),{PrismaClient}=req('@otog/database'),{JwtService}=req('@nestjs/jwt');
async function main(){const db=new PrismaClient(),fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),base='http://127.0.0.1:3000/backend/admin/grading';let initial,headers;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function admin(route='',method='GET',body){const r=await fetch(base+route,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
 async function settled(count){for(let i=0;i<120;i++){const d=await admin();if(d.graderAllocation.count===count&&d.graderAllocation.revision===d.graderAllocation.appliedRevision&&d.cpuAllocation?.revision===d.graderAllocation.revision&&!d.cpuAllocation.error&&d.cpuAllocation.drainingWorkers.length===0)return d;await sleep(250)}throw Error('Allocation did not settle');}
 try{
  const admins=await db.user.findMany({where:{role:'admin'},select:{id:true}}),session=await db.refreshToken.findFirst({where:{used:false,expiryDate:{gt:new Date()},userId:{in:admins.map(u=>u.id)},jwtId:{not:null}},select:{userId:true,jwtId:true}});assert(session);
  headers={Authorization:'Bearer '+new JwtService({secret:process.env.JWT_SECRET}).sign({id:session.userId,jti:session.jwtId},{expiresIn:300})};initial=await admin();
  await admin('/worker-count','PATCH',{count:7});await settled(7);
  for(let id=1;id<=6;id++)await admin('/workers/'+id,'PATCH',{enabled:false});
  let r=await fetch('http://127.0.0.1:3000/backend/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:fixture.users[0].username,password:fixture.password})});assert.equal(r.status,200);const user=await r.json();
  const denied=await fetch(base+'/worker-count',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+user.accessToken},body:'{"count":7}'});assert.equal(denied.status,403);
  const ref=fixture.references.find(v=>v.problemId===67);assert.equal(ref.expectedStatus,'accept');assert.equal(ref.language,'cpp');const form=new FormData();form.append('language','cpp');form.append('sourceCode',new Blob([ref.sourceCode],{type:'text/plain'}),'ordinary.cpp');
  r=await fetch('http://127.0.0.1:3000/backend/submission/problem/67?contestId=%222%22',{method:'POST',headers:{Authorization:'Bearer '+user.accessToken},body:form});assert.equal(r.status,200);const submission=await r.json();
  let claimed=false,requested=false,safeBusySamples=0,sawDraining=false,done=false;const started=performance.now();
  for(let i=0;i<500;i++){
   const rows=await db.$queryRaw`SELECT s.status,r.score,j."workerId",EXISTS(SELECT 1 FROM "otogWorkerMemoryReservation" WHERE "workerId"=7) AS busy FROM submission s LEFT JOIN "submissionResult" r ON r."submissionId"=s.id LEFT JOIN "otogWorkerJob" j ON j."submissionId"=s.id WHERE s.id=${submission.id}`;const d=rows[0];
   if(d.workerId===7&&!requested){claimed=true;await admin('/worker-count','PATCH',{count:6});requested=true;}
   if(requested&&d.busy){
    const a=await(await fetch('http://127.0.0.1:8766/status')).json();sawDraining||=a.drainingWorkers.includes(7);
    const cpus=execFileSync('docker',['inspect','--format','{{.HostConfig.CpusetCpus}}','otog-postgres-1'],{encoding:'utf8'}).trim();
    if(cpus==='7')safeBusySamples++;
    else{const second=await db.$queryRaw`SELECT EXISTS(SELECT 1 FROM "otogWorkerMemoryReservation" WHERE "workerId"=7) AS busy`;assert(!second[0].busy,'A grader CPU was released while its sandbox reservation remained');}
   }
   if(!['waiting','grading'].includes(d.status)){assert.equal(d.status,'accept');assert.equal(d.score,100);done=true;break;}await sleep(50);
  }
  assert(claimed&&requested&&done);assert(safeBusySamples>0);assert(sawDraining);const final=await settled(6);assert.deepEqual(final.cpuAllocation.serviceCpus,[6,7]);assert(!final.workers.find(w=>w.id===7).enabled);
  console.log(JSON.stringify({passed:true,ordinaryCppAccepted:true,gradedBy:7,reducedCountDuringJob:true,coreHeldUntilCleanup:true,safeBusySamples,drainingStateObserved:sawDraining,finalServiceCpus:[6,7],nonAdminDenied:true,seconds:Math.round(performance.now()-started)/1000}));
 }finally{
  if(initial&&headers){await admin('/worker-count','PATCH',{count:initial.graderAllocation.count});await settled(initial.graderAllocation.count);for(const w of initial.workers)if(w.id<=initial.graderAllocation.count)await admin('/workers/'+w.id,'PATCH',{enabled:w.enabled});}
  await db.$disconnect();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
