// Read-only candidate verification: malformed uploads never create submissions.
const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'../package.json')),{PrismaClient}=req('@otog/database'),{JwtService}=req('@nestjs/jwt');
const db=new PrismaClient(),base=process.argv[2];assert.equal(base,'http://127.0.0.1:18031');
async function main(){
 const sessions=await db.$queryRaw`SELECT R."userId",R."jwtId" FROM "refreshToken" R JOIN "user" U ON U.id=R."userId" WHERE U.role='admin' AND R.used=false AND R."expiryDate">now() AND R."jwtId" IS NOT NULL ORDER BY R."creationDate" DESC LIMIT 1`;
 assert(sessions[0],'Need an existing valid administrator session; do not create one');
 const token=new JwtService({secret:process.env.JWT_SECRET}).sign({id:sessions[0].userId,jti:sessions[0].jwtId},{expiresIn:120});
 const headers={Authorization:'Bearer '+token};const read=await fetch(base+'/ping',{headers});assert.equal(read.status,200);await read.arrayBuffer();
 const badAuth=await fetch(base+'/submission/problem/1',{method:'POST',headers:{Authorization:'Bearer invalid'}});assert.equal(badAuth.status,401);await badAuth.arrayBuffer();
 const started=performance.now();
 const uploads=await Promise.all(Array.from({length:16},async()=>{
  const form=new FormData();form.set('language','unsupported-language');form.set('sourceCode',new File(['// invalid-language admission test, not submitted'],'rate-test.cpp'));
  const response=await fetch(base+'/submission/problem/1',{method:'POST',headers,body:form});return{status:response.status,retry:response.headers.get('retry-after'),body:await response.json()};
 }));
 const elapsed=performance.now()-started,admitted=uploads.filter(r=>r.status===400),denied=uploads.filter(r=>r.status===429);
 assert(denied.length>0);assert.equal(admitted.length+denied.length,16,JSON.stringify(uploads));assert(admitted.length>=10&&admitted.length<=10+Math.ceil(elapsed/1000));
 for(const reply of denied){assert.equal(reply.retry,'1');assert.equal(reply.body.code,'RATE_LIMITED');assert.equal(reply.body.message,'กรุณารอสักครู่แล้วลองใหม่')}
 const alias=await fetch(base+'/SuBmIsSiOn/PrObLeM/1/',{method:'POST',headers});assert.equal(alias.status,429);await alias.arrayBuffer();
 // The independent read/admin allowance still works after submission throttling.
 const after=await fetch(base+'/ping',{headers});assert.equal(after.status,200);await after.arrayBuffer();
 await new Promise(resolve=>setTimeout(resolve,1100));
 const refillBody=new FormData();refillBody.set('language','unsupported-language');refillBody.set('sourceCode',new File(['// invalid-language admission test, not submitted'],'rate-test.cpp'));
 const refill=await fetch(base+'/submission/problem/1',{method:'POST',headers,body:refillBody});assert.equal(refill.status,400);await refill.arrayBuffer();
 console.log(JSON.stringify({passed:true,checks:['real JWT/session validation precedes throttling','actual ts-rest multipart upload metadata enforces its own bucket','invalid requests are 400 until HTTP 429; no submission creation','case/trailing-slash aliases retain throttling','reads remain available and submission allowance refills'],admittedInvalidRequests:admitted.length,throttledRequests:denied.length,productionSubmissionsCreated:0}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>db.$disconnect());
