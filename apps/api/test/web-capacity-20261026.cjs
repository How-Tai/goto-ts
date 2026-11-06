const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),r=createRequire(root+'/apps/api/package.json'),ts=r('typescript'),modules=new Map();
const actual=new Set(['bounded-work-queue.ts','short-lived-cache.ts','problem-visibility.ts']);
function load(relative){
 const file=path.resolve(root,relative);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
 function req(name){
  if(name==='@nestjs/common')return r(name);
  if(name==='@otog/database')return{PrismaClient:class{constructor(options){this.options=options}},UserRole:{user:'user',admin:'admin'}};
  if(name.endsWith('/env'))return{environment:{DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:9/fixture'}};
  if(name==='@otog/contract')return{ContestScoreSchema:{parse:x=>x}};
  if(name.endsWith('/constants'))return{Role:{User:'user',Admin:'admin'}};
  if(name.startsWith('src/'))return new Proxy({},{get:()=>()=>{}});
  if(name.startsWith('.')){const destination=path.resolve(path.dirname(file),name)+'.ts';return actual.has(path.basename(destination))?load(path.relative(root,destination)):new Proxy({},{get:()=>()=>{}})}
  return r(name);
 }
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(req,module,module.exports);return module.exports;
}
async function main(){
 const checks=[];
 const {databasePoolUrl,PrismaService}=load('apps/api/src/core/database/prisma.service.ts');assert.equal(new URL(databasePoolUrl('postgresql://x:y@localhost/db?schema=public')).searchParams.get('connection_limit'),'16');assert.equal(new URL(databasePoolUrl('postgresql://x:y@localhost/db?connection_limit=8')).searchParams.get('connection_limit'),'8');assert.equal(new URL(new PrismaService().options.datasources.db.url).searchParams.get('connection_limit'),'16');
 const authModule=fs.readFileSync(root+'/apps/api/src/modules/auth/auth.module.ts','utf8');assert(!authModule.includes('PrismaService'));checks.push('singleton provider and bounded default pool, explicit settings retained');
 const {BoundedWorkQueue}=load('apps/api/src/utils/bounded-work-queue.ts');let active=0,maximum=0;const queue=new BoundedWorkQueue(2,128,1000,()=>Error('busy'));
 const values=await Promise.all(Array.from({length:100},(_,i)=>queue.run(async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return i})));assert.equal(maximum,2);assert.equal(new Set(values).size,100);
 let release;const blocked=new BoundedWorkQueue(1,1,20,()=>Error('busy')),running=blocked.run(()=>new Promise(resolve=>release=resolve)),timeout=blocked.run(async()=>0);await assert.rejects(blocked.run(async()=>1),/busy/);await assert.rejects(timeout,/busy/);release(7);await running;assert.equal(await blocked.run(async()=>8),8);await assert.rejects(blocked.run(async()=>{throw Error('failed')}),/failed/);assert.equal(await blocked.run(async()=>9),9);checks.push('100 jobs finish within the concurrency limit; queue overload, expiry, failures and capacity recovery pass');
 const {ContestService}=load('apps/api/src/modules/contest/contest.service.ts');let builds=0,metadataReads=0,scoreReads=0,selection;
 const service=new ContestService({problem:{findMany:async()=>[],findFirst:async args=>{selection=args;return{id:67}}},contest:{findUnique:async args=>{metadataReads++;assert.deepEqual(args.select,{timeStart:true});return{timeStart:new Date(0)}}},contestScore:{findMany:async()=>{scoreReads++;return[]}}});
 service.buildScoreboard=async id=>{builds++;await Promise.resolve();return{contest:{id,contestProblem:[]},userContest:[]}};const boards=await Promise.all(Array.from({length:100},()=>service.scoreboardByContestId(2)));assert.equal(builds,1);assert(boards.every(x=>x.contest.id===2));await service.scoreboardByContestId(3);assert.equal(builds,2);
 for(let id=4;id<80;id++)await service.scoreboardByContestId(id);assert(service.scoreboards.size<=64);
 await service.getContestProblem(2,67);assert.deepEqual(selection.where,{id:67,contestProblem:{some:{contestId:2}},OR:[{show:true}]});await service.getContestProblem(2,67,{id:1,role:'admin'});assert.equal(selection.where.show,undefined);await service.getUserContestScores(2,101);assert.equal(metadataReads,1);assert.equal(scoreReads,1);checks.push('100 scoreboard reads collapse to one bounded cached calculation; problem membership/visibility and personal scores stay separate');
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
