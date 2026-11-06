const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../..'),r=createRequire(root+'/apps/api/package.json'),ts=r('typescript'),modules=new Map(),callbacks=[];
function load(relative){const file=path.resolve(root,relative);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
 function req(name){
  if(name==='node:crypto')return{...crypto,scrypt(_password,_salt,_size,options,callback){assert.deepEqual(options,{N:32768,r:8,p:3,maxmem:64*1024*1024});callbacks.push(callback)}};
  if(name==='@nestjs/common')return r(name);
  if(name==='src/core/constants')return{Role:{User:'user'}};
  if(name.startsWith('src/')||name==='@otog/contract'||name==='@otog/database')return{};
  if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name)+'.ts'));
  return r(name);
 }
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(req,module,module.exports);return module.exports;
}
async function main(){const checks=[],passwords=load('apps/api/src/utils/password.ts'),{UserService}=load('apps/api/src/modules/user/user.service.ts');
 let inserts=0;const user=new UserService({user:{create:async()=>{inserts++;return{}}}});user.findOneByUsername=async()=>null;user.findOneByShowName=async()=>null;
 const stored='scrypt$32768$8$3$'+Buffer.alloc(16).toString('base64url')+'$'+Buffer.alloc(64).toString('base64url');
 const jobs=Array.from({length:12},(_,i)=>i%2?passwords.verifyPassword('fixture',stored):passwords.hashPassword('fixture'));
 assert.equal(callbacks.length,2);
 const busy=error=>error.getStatus()===503&&error.getResponse().retryAfterSeconds===1;
 await assert.rejects(passwords.hashPassword('overflow'),busy);await assert.rejects(passwords.verifyPassword('overflow',stored),busy);
 await assert.rejects(user.create({username:'fixture',showName:'fixture',password:'fixture'}),busy);assert.equal(inserts,0);
 checks.push('login and registration share two active slots plus ten waiting; further work gets HTTP 503 and registration inserts no account');
 for(let i=0;i<12;i++){assert.equal(callbacks.length,Math.min(12,i+2));callbacks[i](null,Buffer.alloc(64));await new Promise(resolve=>setImmediate(resolve))}
 const values=await Promise.all(jobs);assert(values.filter(x=>x===true).length===6);assert(values.filter(x=>typeof x==='string').length===6);
 const recovered=user.create({username:'fixture',showName:'fixture',password:'fixture'});await new Promise(resolve=>setImmediate(resolve));assert.equal(callbacks.length,13);callbacks[12](null,Buffer.alloc(64));await recovered;assert.equal(inserts,1);
 const failed=passwords.hashPassword('fixture');callbacks[13](Error('fixture failure'));await assert.rejects(failed,/fixture failure/);
 const afterFailure=passwords.hashPassword('fixture');callbacks[14](null,Buffer.alloc(64));await afterFailure;checks.push('accepted mixed jobs complete, capacity recovers after overload and hashing errors, password security parameters remain unchanged');
 console.log(JSON.stringify({passed:true,checks,productionWrites:0}));}
main().catch(error=>{console.error(error);process.exitCode=1});
