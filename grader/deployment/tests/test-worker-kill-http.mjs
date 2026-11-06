import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire('/home/otog/otog/apps/api/package.json');
createRequire(require.resolve('@nestjs/common'))('reflect-metadata');
const {NestFactory}=require('@nestjs/core');
const {Module}=require('@nestjs/common');
const {GradingController}=await import(pathToFileURL(process.argv[2]).href);
const {WorkerControlService}=await import(pathToFileURL(process.argv[3]).href);
const [Grading,WorkerControl]=Reflect.getMetadata('design:paramtypes',GradingController);
let kills=[];
const grading={status:async()=>({workers:[]}),setEnabled:async()=>({enabled:true})};
const controls={kill:async(...args)=>{kills.push(args);return {restarted:true};}};
class TestModule {}
Module({controllers:[GradingController],providers:[{provide:Grading,useValue:grading},{provide:WorkerControl,useValue:controls}]})(TestModule);
const app=await NestFactory.create(TestModule,{logger:false});
let principal={id:7,role:'admin'};
app.use((req,_res,next)=>{req.user=principal;next();});
await app.listen(0,'127.0.0.1');
const base=`http://127.0.0.1:${app.getHttpServer().address().port}/admin/grading/workers`;
const startedAt='2026-10-11T08:00:00.000Z';
const body={confirmed:true,startedAt,submissionId:254};
const post=(id,data=body)=>fetch(`${base}/${id}/kill`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
try {
  assert.equal((await post('4')).status,200);
  assert.equal(kills.length,1);assert.equal(kills[0][0],4);assert.equal(kills[0][2],7);
  for(const id of ['5','6']) assert.equal((await post(id)).status,200);
  for(const id of ['0','7','01','-1','1.5','grader','nginx']) assert.equal((await post(id)).status,400);
  for(const data of [{},{...body,confirmed:false},{...body,startedAt:'yesterday'},{...body,submissionId:'254'},{...body,submissionId:-1},{...body,container:'nginx'}]) assert.equal((await post('4',data)).status,400);
  principal={id:8,role:'user'};assert.equal((await post('4')).status,403);
  principal=undefined;assert.equal((await post('4')).status,401);
  assert.equal(kills.length,3,'Invalid and unauthorised requests must not invoke worker controls');
} finally {await app.close();}

let invalidations=0;
let job=254;
const prisma={$transaction:async callback=>callback({$queryRaw:async(strings)=>strings.join('').includes('FOR UPDATE')?[{startedAt:new Date(startedAt)}]:job===null?[]:[{submissionId:job}]})};
const fakeGrading={invalidate:()=>invalidations++};
const container={Id:'a'.repeat(64),Config:{Image:'otog-grader',Env:['OTOG_WORKER_ID=4'],Labels:{'com.docker.compose.project':'otog','com.docker.compose.service':'grader4'}}};
function control(inspection=container) {
  const service=new WorkerControlService(prisma,fakeGrading);
  const requests=[];
  service.dockerRequest=async(method,path)=>{requests.push([method,path]);return method==='GET'?JSON.stringify(inspection):'';};
  return {service,requests};
}
const first=control();
for (const id of [5,6]) {
  const test=control({...container,Config:{...container.Config,Env:[`OTOG_WORKER_ID=${id}`],Labels:{'com.docker.compose.project':'otog','com.docker.compose.service':`grader${id}`}}});
  await test.service.kill(id,body,7);
  assert.equal(test.requests[0][1],`/v1.44/containers/otog-grader${id}-1/json`);
  const mismatched=control(container);
  await assert.rejects(mismatched.service.kill(id,body,7),error=>error.getStatus()===503);
  assert.equal(mismatched.requests.length,1,'A different worker container must never be restarted');
}
assert.deepEqual(await first.service.kill(4,body,7),{workerId:4,restarted:true,submissionId:254});
assert.deepEqual(first.requests,[['GET','/v1.44/containers/otog-grader4-1/json'],['POST',`/v1.44/containers/${container.Id}/restart?t=0&signal=SIGKILL`]]);
await assert.rejects(first.service.kill(4,body,7),error=>error.getStatus()===409);
assert.equal(first.requests.length,2,'Cooldown must prevent repeated restarts');
for(const expected of [{...body,submissionId:null},{...body,startedAt:'2026-10-11T07:59:59.000Z'}]) {
  const test=control();await assert.rejects(test.service.kill(4,expected,7),error=>error.getStatus()===409);assert.equal(test.requests.length,0);
}
for(const inspection of [
  {...container,Id:'nginx'},
  {...container,Config:{...container.Config,Image:'another-image'}},
  {...container,Config:{...container.Config,Env:['OTOG_WORKER_ID=3']}},
  {...container,Config:{...container.Config,Labels:{'com.docker.compose.project':'other','com.docker.compose.service':'grader4'}}},
  {...container,Config:{...container.Config,Labels:{'com.docker.compose.project':'otog','com.docker.compose.service':'postgres'}}},
]) {
  const test=control(inspection);await assert.rejects(test.service.kill(4,body,7),error=>error.getStatus()===503);assert.equal(test.requests.length,1);
}
const broken=control();broken.service.dockerRequest=async()=>{throw new Error('simulated socket timeout');};
await assert.rejects(broken.service.kill(4,body,7),error=>error.getStatus()===503);
assert.equal(broken.service.busy.size,0,'Failures must release the busy guard');
const concurrent=control();let release;
concurrent.service.dockerRequest=async(method)=>method==='GET'?new Promise(resolve=>{release=()=>resolve(JSON.stringify(container));}):'';
const active=concurrent.service.kill(4,body,7);
await new Promise(resolve=>setImmediate(resolve));
await assert.rejects(concurrent.service.kill(4,body,7),error=>error.getStatus()===409);release();await active;
job=null;const idle=control();await idle.service.kill(4,{...body,submissionId:null},7);
assert(invalidations>0);
console.log('Worker Kill authorization, confirmation validation, stale-job/start rejection, fixed container identity, SIGKILL/restart, cooldown, concurrent guard, failure cleanup and idle restart passed. Production workers were not touched.');
