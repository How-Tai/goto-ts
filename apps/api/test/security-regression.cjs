// Real patched functions; dummy database and temporary files only.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{Writable,Readable}=require('node:stream'),{once}=require('node:events'),cp=require('node:child_process');
const api=path.resolve(__dirname,'..'),workspace=path.resolve(api,'../..'),r=createRequire(api+'/package.json'),ts=r('typescript'),cache=new Map();
const env={JWT_SECRET:'dummy-security-test-key-not-production',S3_BUCKET:'dummy',S3_REGION:'test',S3_ENDPOINT:'http://127.0.0.1:9',S3_ACCESS_KEY_ID:'dummy',S3_SECRET_ACCESS_KEY:'dummy',USE_S3:false};
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
 const mod={exports:{}};cache.set(file,mod);const local=createRequire(file);
 function req(n){
  if(n==='src/env')return{environment:env};if(n==='src/core/database/prisma.service')return{PrismaService:class{}};
  if(n==='@otog/contract')return load(workspace+'/packages/contract/src/index.ts');
  let p=n.startsWith('src/')?path.join(api,n):n.startsWith('.')?path.resolve(path.dirname(file),n):null;
  if(p){p=[p+'.ts',p+'/index.ts'].find(fs.existsSync);if(p)return load(p)}return local(n);
 }
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021,experimentalDecorators:true,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',js)(req,mod,mod.exports);return mod.exports;
}
async function main(){
 const checks=[],{hashPassword,verifyPassword}=load(api+'/src/utils/password.ts');
 const legacy=require('node:crypto').createHash('sha256').update('old-password').digest('hex');
 assert(await verifyPassword('old-password',legacy));assert(!await verifyPassword('wrong',legacy));
 const hash=await hashPassword('new-password'),other=await hashPassword('new-password');
 assert.notEqual(hash,other);assert(await verifyPassword('new-password',hash));assert(!await verifyPassword('wrong',hash));assert(!await verifyPassword('x','scrypt$bad'));
 checks.push('salted scrypt, legacy compatibility, wrong-password rejection');
 const users=new Map([[1,{id:1,username:'dummy-user',showName:'Dummy',role:'user',rating:0,password:legacy}],[2,{id:2,username:'dummy-admin',showName:'Dummy admin',role:'admin',rating:0,password:legacy}]]);
 const sessions=[];const match=(row,w)=>Object.entries(w).every(([k,v])=>k==='expiryDate'?row.expiryDate>v.gt:row[k]===v);
 const prisma={user:{findUnique:async({where})=>{const u=where.id?users.get(where.id):[...users.values()].find(u=>u.username===where.username);return u?{...u}:null},updateMany:async({where,data})=>{const u=users.get(where.id);if(u&&u.password===where.password){Object.assign(u,data);return{count:1}}return{count:0}}},refreshToken:{findFirst:async({where})=>sessions.find(s=>match(s,where))||null,updateMany:async({where,data})=>{let count=0;for(const row of sessions)if(match(row,where)){Object.assign(row,data);count++}return{count}}}};
 prisma.$queryRaw=async(strings,id,jti)=>{
  const sql=strings.join('?');assert(sql.includes('R."userId"=U.id')&&sql.includes('R.used=false')&&sql.includes('R."expiryDate">now()'));
  const user=users.get(id),session=sessions.find(s=>s.userId===id&&s.jwtId===jti&&!s.used&&s.expiryDate>new Date());
  return user&&session?[{id:user.id,username:user.username,showName:user.showName,role:user.role,rating:user.rating}]:[];
 };
 const {UserService}=load(api+'/src/modules/user/user.service.ts'),{AuthService}=load(api+'/src/modules/auth/auth.service.ts');
 const auth=new AuthService(new UserService(prisma),{},prisma);
 const account=await auth.validateUser('dummy-user','old-password');assert.equal(account.id,1);assert(users.get(1).password.startsWith('scrypt$'));assert.equal(account.password,undefined);
 checks.push('legacy password upgrades without changing login');
 const row={id:'dummy-rid',userId:1,jwtId:'dummy-jti',used:false,expiryDate:new Date(Date.now()+60000)};sessions.push(row);
 const identity=await auth.resolveAccessIdentity({id:1,jti:'dummy-jti',role:'admin'});assert.equal(identity.role,'user');
 const race=await Promise.allSettled([auth.validateToken('dummy-rid','dummy-jti',1),auth.validateToken('dummy-rid','dummy-jti',1)]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(()=>auth.resolveAccessIdentity({id:1,jti:'dummy-jti'}));
 row.used=false;await auth.revokeSession(row.id);await assert.rejects(()=>auth.resolveAccessIdentity({id:1,jti:'dummy-jti'}));
 row.used=false;row.expiryDate=new Date(0);assert.equal(await auth.findOneByRID(row.id),null);row.expiryDate=new Date(Date.now()+60000);
 users.delete(1);await assert.rejects(()=>auth.resolveAccessIdentity({id:1,jti:'dummy-jti'}));
 checks.push('current database identity, atomic refresh consumption, logout, expiry and deleted-account rejection');
 const {ProblemController}=load(api+'/src/modules/problem/problem.controller.ts');
 let visible=true,contest=false;
 const problemService={findOneById:async()=>({id:100,show:visible}),canRead:async(_id,u)=>visible||u?.role==='admin'||!!u&&contest,getProblemDocMetadata:async()=>({etag:'W/"fixture"',size:10,lastModified:new Date(0)}),getProblemDocStream:async()=>Readable.from(['%PDF-dummy'])};
 const controller=new ProblemController(problemService,{},auth,new UserService(prisma));
 async function pdf(rid){let bytes='';const res=new Writable({write(c,_e,done){bytes+=c;done()}});res.type=()=>res;res.setHeader=()=>res;const finished=once(res,'finish');await controller.getPdf(100,{cookies:{RID:rid}},res);await finished;return bytes}
 assert.equal(await pdf(undefined),'%PDF-dummy');visible=false;await assert.rejects(()=>pdf(undefined));await assert.rejects(()=>pdf('not-a-session'));
 sessions.push({id:'admin-rid',userId:2,jwtId:'admin-jti',used:false,expiryDate:new Date(Date.now()+60000)});assert.equal(await pdf('admin-rid'),'%PDF-dummy');sessions.at(-1).used=true;await assert.rejects(()=>pdf('admin-rid'));
 checks.push('public PDF stays anonymous; hidden PDF requires a valid authorized session');
 const {updateProblemTestCase}=load(api+'/src/utils/file.util.ts');const tmp=fs.mkdtempSync('/home/otog/worker-setup/security-zip-test-');const old=process.cwd();process.chdir(tmp);
 try{
  fs.mkdirSync('source/100',{recursive:true});fs.writeFileSync('source/100/1.in','old input');fs.writeFileSync('source/100/1.sol','old solution');
  for(const name of ['../../escape.txt','/tmp/escape.txt','C:/escape.txt','..\\..\\escape.txt']){
   cp.execFileSync('python3',['-c','import zipfile,sys;z=zipfile.ZipFile("test.zip","w");z.writestr(sys.argv[1],"DUMMY");z.close()',name]);
   await assert.rejects(()=>updateProblemTestCase('100','test.zip',{}));assert.equal(fs.readFileSync('source/100/1.sol','utf8'),'old solution');
  }
  cp.execFileSync('python3',['-c','import zipfile;z=zipfile.ZipFile("test.zip","w");z.writestr("1.in","new input");z.writestr("1.sol","new solution");z.close()']);
  await updateProblemTestCase('100','test.zip',{});assert.equal(fs.readFileSync('source/100/1.sol','utf8'),'new solution');assert(!fs.existsSync('escape.txt'));
  checks.push('ZIP traversal rejection preserves old testcases; valid archive replaces them');
 }finally{process.chdir(old);fs.rmSync(tmp,{recursive:true,force:true})}
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
