// Real source functions, dummy persistence, bounded temporary files. No production config.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),apiRequire=createRequire(path.join(root,'apps/api/package.json'));
const ts=apiRequire('typescript'),results=[],cache=new Map();
const noop=()=>()=>{},routes=new Proxy({},{get:()=>({})});
function load(relative){
 const filename=path.resolve(root,relative);if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 function req(name){
  if(name==='@nestjs/common')return new Proxy({},{get:(_o,k)=>String(k).endsWith('Exception')?class extends Error{}:noop});
  if(name==='@ts-rest/nest')return{nestControllerContract:x=>x,TsRestHandler:noop,tsRestHandler:(_r,fn)=>fn};
  if(name==='@nestjs/platform-express')return{FileInterceptor:noop};
  if(name==='@otog/contract')return{contestRouter:routes,submissionRouter:routes};
  if(name==='@otog/database')return{SubmissionStatus:{},UserRole:{user:'user',admin:'admin'}};
  if(name.includes('constants'))return{Role:{Admin:'admin',User:'user'},AccessState:{}};
  if(name==='src/utils/contest-visibility')return load('apps/api/'+name+'.ts');
  if(name.startsWith('src/')||name.startsWith('.'))return new Proxy({},{get:()=>noop});
  if(name==='multer')return{};
  return apiRequire(name);
 }
 const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,experimentalDecorators:true,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',js)(req,module,module.exports);return module.exports;
}
async function main(){
 const {securityMiddleware}=load('apps/api/src/utils/security-middleware.ts');
 function request(url,ip,username){
  let status=200,next=false;
  securityMiddleware({method:'POST',path:url,socket:{remoteAddress:ip},headers:{},body:{username}},
   {setHeader(){},status(s){status=s;return this},json(){}},()=>{next=true});return{status,next};
 }
 for(const [index,endpoint] of ['login','register'].entries()){
  const variants=[`/auth/${endpoint}`,`/AUTH/${endpoint.toUpperCase()}`,`/auth/${endpoint}/`];
  for(let i=0;i<120;i++)assert(request(variants[i%3],`192.0.2.${index+1}`,`alias-${i}`).next);
  for(const variant of variants)assert.equal(request(variant,`192.0.2.${index+1}`,'alias-last').status,429);
  results.push({check:'shared throttle for canonical/case/trailing-slash routes',endpoint});
 }
 for(let i=0;i<35;i++)assert.equal(request('/auth/login',`198.51.100.${i+1}`,'shared-account').status,i<30?200:429);
 assert(request('/auth/login','198.51.100.100','different-account').next);
 results.push({check:'username throttle spans peer IPs without blocking another account'});
 const {NestFactory}=apiRequire('@nestjs/core'),{Module}=apiRequire('@nestjs/common');
 class FixtureModule{}Module({})(FixtureModule);
 const nest=await NestFactory.create(FixtureModule,{logger:false});
 try{
  nest.useBodyParser('json',{limit:'100kb'});nest.useBodyParser('urlencoded',{extended:true,limit:'100kb'});nest.use(securityMiddleware);await nest.init();
  const instance=nest.getHttpAdapter().getInstance();
  const stack=(instance.router || instance._router).stack;
  const guard=stack.findIndex(x=>x.handle===securityMiddleware),json=stack.findIndex(x=>x.name==='jsonParser'),form=stack.findIndex(x=>x.name==='urlencodedParser');
  assert(json>=0&&form>=0&&json<guard&&form<guard);
  const bootstrap=fs.readFileSync(path.join(root,'apps/api/src/index.ts'),'utf8');
  assert(bootstrap.indexOf("app.useBodyParser('json'")<bootstrap.indexOf('app.use(securityMiddleware)'));
  results.push({check:'bounded JSON and form parsers precede account throttling',json,form,guard});
 }finally{await nest.close()}
 const {ContestController}=load('apps/api/src/modules/contest/contest.controller.ts');
 let rows=0;
 const now=Date.now(),user={id:1,role:'user'},admin={id:2,role:'admin'};
 for(const policy of ['DURING_CONTEST','AFTER_CONTEST','ADMIN_ONLY'])for(const phase of ['before','during','after'])for(const viewer of [undefined,user,admin])for(const hidden of [false,true]){
  const contest={id:7,scoreboardPolicy:policy,timeStart:new Date(now+(phase==='before'?60000:-120000)),timeEnd:new Date(now+(phase==='after'?-60000:120000))};
  let aggregates=0;
  const service={findOneById:async()=>contest,hasHiddenProblems:async()=>hidden,
   scoreboardByContestId:async()=>{aggregates++;return{contest}},scoreboardPrizeByContestId:async()=>{aggregates++;return{}},getUserContestScoreHistory:async()=>{aggregates++;return[]}};
  const controller=new ContestController(service);
  const allowed=(!hidden||!!viewer)&&(viewer===admin||policy==='DURING_CONTEST'&&phase!=='before'||policy==='AFTER_CONTEST'&&phase==='after');
  for(const method of ['getContestScoreboard','getContestPrize','getUserContestScoreHistory']){
   let response;try{response=await controller[method](viewer)({params:{contestId:'7',userId:'9'}})}catch(e){assert(!allowed);response={status:403}}
   assert.equal(response.status,allowed?200:403,JSON.stringify({policy,phase,role:viewer?.role,hidden,method}));rows++;
  }
  if(!allowed)assert.equal(aggregates,0);
 }
 results.push({check:'scoreboard, prizes and history share policy/time/hidden/admin authorization',fixtures:rows});
 const {SubmissionService}=load('apps/api/src/modules/submission/submission.service.ts');
 for(const viewer of [undefined,user,admin]){
  let list,detail;
  const service=new SubmissionService({submission:{findMany:async q=>{list=q;return[]},findFirst:async q=>{detail=q;return null}}});
  await service.getSubmissionsByProblemId({userId:9,problemId:10,limit:10,offset:1000,viewer});
  await service.canRead(123,viewer);
  const {id,...detailVisibility}=detail.where;
  const {userId,problemId,id:cursor,...listVisibility}=list.where;
  function normalize(value){
   if(value instanceof Date){assert(Math.abs(Date.now()-value.getTime())<2000);return '<current-time>'}
   if(Array.isArray(value))return value.map(normalize);
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalize(item)]));
   return value;
  }
  assert.deepEqual(normalize(listVisibility),normalize(detailVisibility));
  assert.equal(list.where.userId,9);assert.equal(list.where.problemId,10);assert.equal(list.select.sourceCode,undefined);
  if(viewer!==admin)assert(list.where.OR.some(clause=>clause.problem?.show===true));
 }
 const {SubmissionController}=load('apps/api/src/modules/submission/submission.controller.ts');
 let passedViewer;
 const controller=new SubmissionController({isProblemInContestOrPublic:async()=>({id:10}),getSubmissionsByProblemId:async args=>{passedViewer=args.viewer;return[]}},{});
 await controller.getSubmissionsByProblemId(user)({params:{userId:'9',problemId:'10'},query:{offset:1000,limit:10}});
 assert.equal(passedViewer,user);
 results.push({check:'submission list and detail visibility match for guest/user/admin; controller supplies viewer'});
 const {isSafeLink}=load('apps/web/src/utils/safe-link.ts');
 for(const value of ['https://example.com','http://example.com','mailto:a@example.com','/problem/1'])assert(isSafeLink(value));
 for(const value of ['javascript:alert(1)','\tjavascript:alert(1)','data:text/html,test','vbscript:msgbox(1)'])assert(!isSafeLink(value));
 assert(fs.readFileSync(path.join(root,'apps/web/src/components/chat.tsx'),'utf8').includes('isSafeLink(token)'));
 results.push({check:'chat and announcements allow safe links and reject script/data schemes'});
 const next=createRequire(path.join(root,'apps/web/package.json'))('next/package.json').version;
 const platform=createRequire(apiRequire.resolve('@nestjs/platform-express/package.json'));
 const multer=platform('multer/package.json').version;
 assert.equal(next,'15.5.28');assert.equal(multer,'2.5.0');
 results.push({check:'actual local dependency resolution',next,multer});
 const report={passed:true,results,productionWrites:0};
 const dir=path.join(root,'docs/security-remediation-20261021');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'api-results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
