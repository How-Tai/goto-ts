// Full candidate API + disposable PostgreSQL schema; fails closed on database name.
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),crypto=require('node:crypto')
const req=createRequire(process.cwd()+'/package.json'),{PrismaClient}=req('@otog/database'),{JwtService}=req('@nestjs/jwt')
const db=new PrismaClient(),jwt=new JwtService({secret:process.env.JWT_SECRET}),base='http://127.0.0.1:18037'
const token=id=>jwt.sign({id,jti:'security-fixture-'+id},{expiresIn:900})
async function call(path,id,body,headers={}){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(id?{authorization:'Bearer '+token(id)}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})})
 return {status:response.status,body:await response.json()}
}
async function main(){try{
 assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name,'otog_security_test_20261101')
 for(const id of [1,2]){
  await db.user.create({data:{id,username:'security-fixture-'+id,showName:'Fixture '+id,role:id===1?'admin':'user',password:crypto.createHash('sha256').update('fixture-password').digest('hex')}})
  await db.refreshToken.create({data:{id:'security-fixture-'+id,userId:id,jwtId:'security-fixture-'+id,used:false,expiryDate:new Date(Date.now()+3600000)}})
 }
 await db.problem.create({data:{id:900001,name:'Hidden fixture',sname:'sec-fixture',score:100,timeLimit:1000,memoryLimit:64,case:'1',show:false,examples:'PRIVATE_FIXTURE_EXAMPLE'}})
 await db.contest.create({data:{id:900001,name:'Fixture',mode:'unrated',gradingMode:'classic',scoreboardPolicy:'DURING_CONTEST',timeStart:new Date(Date.now()-60000),timeEnd:new Date(Date.now()+60000)}})
 await db.contestProblem.create({data:{contestId:900001,problemId:900001}})
 let result=await call('/auth/login?username=security-fixture-2&password=fixture-password',undefined,{})
 assert.equal(result.status,400)
 const unknown=await call('/auth/login',undefined,{username:'security-fixture-absent',password:'wrong'})
 const wrong=await call('/auth/login',undefined,{username:'security-fixture-2',password:'wrong'})
 assert.equal(unknown.status,401);assert.equal(wrong.status,401);assert.equal(unknown.body.message,wrong.body.message)
 const valid=await call('/auth/login',undefined,{username:'security-fixture-2',password:'fixture-password'})
 assert.equal(valid.status,200);assert.equal(jwt.verify(valid.body.accessToken).id,2)
 const forged=jwt.sign({id:1,jti:'security-fixture-2'},{expiresIn:900})
 const denied=await fetch(base+'/auth/refresh/token',{headers:{authorization:'Bearer '+forged,cookie:'RID=security-fixture-2'}})
 assert.equal(denied.status,403);assert.equal((await db.refreshToken.findUnique({where:{id:'security-fixture-2'}})).used,false)
 for(const suffix of ['/problem/900001','/problem/900001/page']) assert.equal((await call('/contest/900001'+suffix,2)).status,200)
 const active=await call('/contest/900001/detail',2);assert.equal(active.status,200);assert.equal(active.body.contestProblem.length,1)
 const board=await call('/contest/900001/scoreboard',2);assert.equal(board.status,200)
 assert(!JSON.stringify(board.body).includes('PRIVATE_FIXTURE_EXAMPLE'))
 await db.contest.update({where:{id:900001},data:{timeEnd:new Date(Date.now()-1000)}})
 assert.equal((await call('/contest/900001/problem/900001',2)).status,404)
 assert.equal((await call('/contest/900001/problem/900001/page',2)).status,403)
 assert.equal((await call('/contest/900001/detail',2)).body.contestProblem.length,0)
 assert.equal((await call('/contest/900001/scoreboard',2)).body.contest.contestProblem.length,0)
 assert.equal((await call('/contest/900001/problem/900001',1)).status,200)
 const refreshed=await fetch(base+'/auth/refresh/token',{headers:{authorization:'Bearer '+token(2),cookie:'RID=security-fixture-2'}})
 assert.equal(refreshed.status,200);assert.equal(jwt.verify((await refreshed.json()).accessToken).id,2)
 assert.equal((await fetch(base+'/auth/refresh/token',{headers:{authorization:'Bearer '+token(2),cookie:'RID=security-fixture-2'}})).status,403)
 console.log(JSON.stringify({passed:true,realApiAndPostgres:true,bodyOnlyLogin:true,uniformLoginFailure:true,refreshOwnershipAndReplay:true,hiddenProblemAndScoreboardGates:true,productionWrites:0}))
}finally{await db.$disconnect()}}
main().catch(error=>{console.error(error);process.exitCode=1})
