// Real candidate API + disposable PostgreSQL; never use the production DB.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),{createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'../package.json')),{PrismaClient}=req('@otog/database'),{JwtService}=req('@nestjs/jwt'),db=new PrismaClient();
const passwords={1:'fixture-admin-password',3:'different-admin-password',4:'legacy-admin-password'};
const jwt=new JwtService({secret:process.env.JWT_SECRET});
const token=id=>jwt.sign({id,jti:'rejudge-test-'+id},{expiresIn:180});
async function call(id,body){
 const response=await fetch('http://127.0.0.1:18033/submission/problem/all/rejudge',{method:'PATCH',headers:{'content-type':'application/json',...(id?{Authorization:'Bearer '+token(id)}:{})},body:JSON.stringify(body)});
 return{status:response.status,body:await response.json()};
}
async function fingerprint(){return JSON.stringify(await db.submission.findMany({orderBy:{id:'asc'},include:{submissionResult:true}}))}
async function main(){
 assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name,'otog_rejudge_test_20261031');
 const checks=[];
 for(const id of [1,2,3,4]){
  const salt=crypto.randomBytes(16),password=passwords[id]||'regular-user-password';
  const hash=id===4?crypto.createHash('sha256').update(password).digest('hex'):'scrypt$32768$8$3$'+salt.toString('base64url')+'$'+(await new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(e,v)=>e?reject(e):resolve(v)))).toString('base64url');
  await db.user.create({data:{id,username:'rejudge-fixture-'+id,showName:'Rejudge fixture '+id,password:hash,role:id===2?'user':'admin'}});
  await db.refreshToken.create({data:{id:'rejudge-session-'+id,userId:id,jwtId:'rejudge-test-'+id,used:false,expiryDate:new Date(Date.now()+3600000)}});
 }
 await db.problem.createMany({data:[1,2].map(id=>({id,name:'Rejudge fixture '+id,score:100,timeLimit:1000,memoryLimit:64,show:id===1,case:'1'}))});
 await db.contest.create({data:{id:2,name:'Rejudge fixture',mode:'unrated',gradingMode:'classic',scoreboardPolicy:'AFTER_CONTEST',timeStart:new Date(Date.now()-3600000),timeEnd:new Date(Date.now()+3600000)}});
 const statuses=['accept','reject','compileError','waiting','grading','judgeError','accept'];
 for(let i=0;i<statuses.length;i++){
  const id=i+1;
  await db.submission.create({data:{id,userId:2,problemId:id%2?1:2,contestId:id===2?2:null,status:statuses[i],sourceCode:'int main(){}',language:'cpp',queuedAt:new Date('2020-01-01T00:00:00Z')}});
  await db.submissionResult.create({data:{id,submissionId:id,result:'old-result',score:100,timeUsed:1,memUsed:1}});
 }
 await db.subtaskResult.create({data:{id:1,submissionResultId:1,score:100,fullScore:100,subtaskIndex:1}});
 await db.verdict.create({data:{id:1,subtaskId:1,status:'ACCEPTED',percent:1,timeUsed:1,memUsed:1,testcaseIndex:1}});
 await db.gradingWorkerJob.createMany({data:[{submissionId:5,workerId:1},{submissionId:7,workerId:2}]});
 await db.$executeRaw`INSERT INTO "otogWorkerAttempt"("submissionId",attempts) VALUES(5,1),(6,2)`;
 const before=await fingerprint();
 assert.equal((await call(null,{password:passwords[1]})).status,401);
 assert.equal((await call(2,{password:passwords[1]})).status,403);
 assert.equal((await call(1,{})).status,400);
 assert.equal((await call(1,{password:''})).status,400);
 assert.equal((await call(1,{password:'x'.repeat(256)})).status,400);
 assert.equal((await call(1,{password:'wrong'})).status,403);
 assert.equal((await call(1,{password:passwords[3]})).status,403);
 assert.equal((await call(1,{password:passwords[1],userId:3})).status,400);
 assert.equal(await fingerprint(),before);
 checks.push('actual JWT/session authorization; anonymous/non-admin/missing/oversized/wrong/other-admin passwords cannot mutate any submission');
 const result=await call(1,{password:passwords[1]});assert.equal(result.status,200,JSON.stringify(result));assert.deepEqual(result.body,{queued:4});
 const rows=await db.submission.findMany({orderBy:{id:'asc'}});assert.deepEqual(rows.map(r=>r.status),['waiting','waiting','waiting','waiting','grading','waiting','accept']);
 assert(rows[0].queuedAt>new Date('2025-01-01'));assert.equal(rows[3].queuedAt.toISOString(),'2020-01-01T00:00:00.000Z');
 assert.deepEqual((await db.submissionResult.findMany({orderBy:{id:'asc'}})).map(r=>r.submissionId),[4,5,7]);
 assert.equal(await db.verdict.count(),0);assert.equal(await db.subtaskResult.count(),0);
 assert.deepEqual((await db.$queryRaw`SELECT "submissionId",attempts FROM "otogWorkerAttempt" ORDER BY "submissionId"`).map(r=>r.submissionId),[5]);
 assert.equal(await db.gradingWorkerJob.count(),2);
 checks.push('one atomic bulk operation includes contest/private/practice problems, clears result cascades and stale retry counts, and preserves pending/leased work');
 const queuedAt=rows.map(r=>r.queuedAt.toISOString());assert.deepEqual((await call(1,{password:passwords[1]})).body,{queued:0});
 assert.deepEqual((await db.submission.findMany({orderBy:{id:'asc'}})).map(r=>r.queuedAt.toISOString()),queuedAt);
 assert.equal((await call(4,{password:passwords[4]})).status,200);
 assert.equal((await call(1,{password:'wrong'})).status,403);const limited=await call(1,{password:'wrong'});assert.equal(limited.status,429);assert(limited.body.retryAfterSeconds>0);
 checks.push('repeat requests preserve queue age, legacy hashes verify, and password verification has a separate per-admin token bucket');
 const legacy=await fetch('http://127.0.0.1:18033/submission/problem/2/rejudge',{method:'PATCH',headers:{Authorization:'Bearer '+token(3)}});assert.equal(legacy.status,200);
 checks.push('static all route does not break existing numeric problem rejudge route');
 console.log(JSON.stringify({passed:true,checks,productionWrites:0,queuedFixtureSubmissions:4}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
