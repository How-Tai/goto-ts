const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),req=createRequire(root+'/apps/api/package.json'),ts=req('typescript');
req('@nestjs/common');
const cache=new Map();
function load(relative){
 const file=path.join(root,relative);if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',js)(name=>name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),name)+'.ts')):req(name),module,module.exports);
 return module.exports;
}
async function main(){
 const checks=[],{TokenBuckets}=load('apps/api/src/utils/token-bucket.ts');let now=0;
 const buckets=new TokenBuckets(20000,()=>now),policy={capacity:10,refillPerSecond:1};
 assert(Array.from({length:10},()=>buckets.take('one',policy)).every(r=>r.allowed));
 assert.deepEqual(buckets.take('one',policy),{allowed:false,retryAfterSeconds:1});
 now=999;assert(!buckets.take('one',policy).allowed);now=1000;assert(buckets.take('one',policy).allowed);assert(!buckets.take('one',policy).allowed);
 now=200000;assert(Array.from({length:10},()=>buckets.take('one',policy)).every(r=>r.allowed));assert(!buckets.take('one',policy).allowed);
 assert(buckets.take('two',policy).allowed);assert(buckets.take('api:one',{capacity:300,refillPerSecond:60}).allowed);
 checks.push('exact burst, continuous fractional refill, capped idle refill and separate identities/buckets');
 let time=0;const bounded=new TokenBuckets(1,()=>time);bounded.take('one',policy);assert(bounded.take('two',policy).unavailable);assert(bounded.take('one',policy).allowed);time=10000;assert(bounded.take('two',policy).allowed);
 checks.push('bounded memory never evicts depleted accounts; replenished entries can be reclaimed');
 const {AccountRateLimitGuard,SubmissionBucket,ACCOUNT_BUCKETS}=load('apps/api/src/core/guards/account-rate-limit.guard.ts');
 const {Reflector}=req('@nestjs/core'),{HttpCode,Controller,Get,Post,Module}=req('@nestjs/common'),{NestFactory}=req('@nestjs/core');
 // Exercise real Express/Nest routing and actual global guard ordering; no application DB or grader.
 class FixtureController {read(){return {ok:true}} submit(){return {ok:true}} admin(){return {ok:true}}}
 Controller()(FixtureController);
 for(const [method,decorator,route] of [['read',Get,'read'],['submit',Post,'submission'],['admin',Post,'admin/rejudge']])decorator(route)(FixtureController.prototype,method,Object.getOwnPropertyDescriptor(FixtureController.prototype,method));
 for(const method of ['submit','admin'])HttpCode(200)(FixtureController.prototype,method,Object.getOwnPropertyDescriptor(FixtureController.prototype,method));
 SubmissionBucket()(FixtureController.prototype,'submit',Object.getOwnPropertyDescriptor(FixtureController.prototype,'submit'));
 class FixtureModule{}Module({controllers:[FixtureController]})(FixtureModule);
 const app=await NestFactory.create(FixtureModule,{logger:false});
 let clock=0;const fixtureBuckets=new TokenBuckets(20000,()=>clock);
 app.useGlobalGuards({canActivate(ctx){const request=ctx.switchToHttp().getRequest();const id=request.headers['x-fixture-account'];if(id)request.user={id:Number(id),role:request.headers['x-fixture-role']==='admin'?'admin':'user'};return true}},new AccountRateLimitGuard(new Reflector(),fixtureBuckets));
 await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 async function call(route='read',id=1,role='user',method='GET'){
  const response=await fetch(base+'/'+route,{method,headers:{...(id?{'x-fixture-account':String(id)}:{}),'x-fixture-role':role}});const body=await response.json();return{status:response.status,body,retry:response.headers.get('retry-after')};
 }
 async function requests(count,work){const results=[];for(let start=0;start<count;start+=16)results.push(...await Promise.all(Array.from({length:Math.min(16,count-start)},work)));return results}
 try{
  const burst=await Promise.all(Array.from({length:11},()=>call('submission',1,'user','POST')));
  assert.equal(burst.filter(r=>r.status===200).length,10);const denied=burst.find(r=>r.status===429);assert.equal(denied.retry,'1');assert.equal(denied.body.message,'กรุณารอสักครู่แล้วลองใหม่');assert.equal(denied.body.code,'RATE_LIMITED');
  assert.equal((await call('SuBmIsSiOn/',1,'user','POST')).status,429);
  assert.equal((await call('submission',2,'user','POST')).status,200);
  clock=1000;assert.equal((await call('submission',1,'user','POST')).status,200);assert.equal((await call('submission',1,'user','POST')).status,429);
  checks.push('real HTTP parallel submission burst, 429/Retry-After/Thai body, route aliases, per-account isolation and refill');
  const reads=await requests(301,()=>call());assert.equal(reads.filter(r=>r.status===200).length,300);assert.equal(reads.filter(r=>r.status===429).length,1);
  assert.equal((await call('submission',2,'user','POST')).status,200);
  clock+=1000;const refill=await requests(61,()=>call());assert.equal(refill.filter(r=>r.status===200).length,60);
  assert.equal((await call('read',2)).status,200);assert.equal((await call('read',undefined)).status,429);assert.equal((await call('read',null)).status,200);
  checks.push('300-read burst, 60-per-second refill and independent submission allowance');
  const admin=await requests(601,()=>call('admin/rejudge',7,'admin','POST'));assert.equal(admin.filter(r=>r.status===200).length,600);assert.equal(admin.filter(r=>r.status===429).length,1);
  assert.equal((await call('submission',7,'admin','POST')).status,200);
  checks.push('admin operations have separate 600/120 bucket; submissions remain independently bounded');
  const source=fs.readFileSync(root+'/apps/api/src/index.ts','utf8');assert(source.indexOf('new JwtAuthGuard(reflector)')<source.indexOf('new AccountRateLimitGuard(reflector)'));
  const uploads=fs.readFileSync(root+'/apps/api/src/modules/submission/submission.controller.ts','utf8');assert.match(uploads,/@TsRestHandler\(c.uploadFile[^\n]*\)\s+@SubmissionBucket\(\)/);
  console.log(JSON.stringify({passed:true,checks,policies:ACCOUNT_BUCKETS,productionWrites:0}));
 }finally{await app.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
