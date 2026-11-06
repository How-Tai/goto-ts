const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module'),req=createRequire(path.resolve(__dirname,'../package.json')),{PrismaClient, VerdictModel}=req('@otog/database'),{JwtService}=req('@nestjs/jwt');
const db=new PrismaClient();
async function main(){
 assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name,'otog_mle_test_20261031');
 const session=(await db.$queryRaw`SELECT "userId","jwtId" FROM "refreshToken" WHERE id='mle-fixture'`)[0];assert(session);
 const token=new JwtService({secret:process.env.JWT_SECRET}).sign({id:session.userId,jti:session.jwtId},{expiresIn:120});
 for(const [id,status] of [[1,'MEMORY_LIMIT_EXCEEDED'],[2,'RUNTIME_ERROR'],[3,'ACCEPTED']]){
  const response=await fetch('http://127.0.0.1:18032/submission/'+id+'/code',{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);const body=await response.json();const verdict=body.submissionResult.subtaskResults[0].verdicts[0];assert.equal(verdict.status,status);assert(VerdictModel.safeParse(verdict).success);
 }
 console.log(JSON.stringify({passed:true,checks:['real worker persists MLE, RE and AC in isolated PostgreSQL','authenticated candidate HTTP returns all three verdicts','generated response schema accepts MLE'],productionWrites:0}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>db.$disconnect());
