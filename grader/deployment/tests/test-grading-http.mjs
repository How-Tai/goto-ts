import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require=createRequire('/home/otog/otog/apps/api/package.json');
createRequire(require.resolve('@nestjs/common'))('reflect-metadata');
const {NestFactory}=require('@nestjs/core');
const {Module}=require('@nestjs/common');
const {GradingController}=await import(pathToFileURL(process.argv[2]).href);
const [Service,WorkerControl]=Reflect.getMetadata('design:paramtypes',GradingController);
assert(Service,'Controller dependency metadata missing');
const GradingService=Service;
let reads=0,writes=[];
const prisma={
  async $queryRaw(strings,...values) {
    const sql=strings.join('?');
    if(sql.includes('UPDATE')) { writes.push(values); return sql.includes('otogGradingSettings')?[{maxWorkersPerUser:values[0]}]:[{workerId:values[1],enabled:values[0]}]; }
    reads++; await new Promise(resolve=>setTimeout(resolve,15));
    return [{data:{waiting:0,grading:0,queueLimit:100,queue:[],workers:[]}}];
  }
};
const service=new GradingService(prisma);
class TestModule {}
Module({controllers:[GradingController],providers:[{provide:Service,useValue:service},...(WorkerControl?[{provide:WorkerControl,useValue:{kill:async()=>({restarted:true})}}]:[])]})(TestModule);
const app=await NestFactory.create(TestModule,{logger:false});
let principal={role:'admin'};
app.use((req,_res,next)=>{req.user=principal;next();});
await app.listen(0,'127.0.0.1');
const base=`http://127.0.0.1:${app.getHttpServer().address().port}/admin/grading`;
async function patch(id,body) {return fetch(`${base}/workers/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function settings(body) {return fetch(`${base}/settings`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
try {
  const results=await Promise.all(Array.from({length:8},()=>fetch(base)));
  assert(results.every(r=>r.status===200)); assert.equal(reads,1,'Concurrent status reads should coalesce');
  assert.equal(results[0].headers.get('cache-control'),'no-store');
  const data=await results[0].json(); assert.deepEqual(data.queue,[]);
  assert.equal((await patch('4',{enabled:false})).status,200);
  assert.deepEqual(writes,[[false,4]]);
  await fetch(base); assert.equal(reads,2,'Pause should invalidate the status cache');
  assert.equal((await patch('4',{enabled:true})).status,200);
  for(const id of ['5','6']) assert.equal((await patch(id,{enabled:false})).status,200,id);
  for(const id of ['0','7','-1','1.5','1x','01']) assert.equal((await patch(id,{enabled:false})).status,400,id);
  for(const body of [{enabled:'false'},{enabled:1},{},{enabled:false,kill:true}]) assert.equal((await patch('1',body)).status,400);
  for(const value of [1,2,3,4,5,6])assert.equal((await settings({maxWorkersPerUser:value})).status,200);
  for(const body of [{},{maxWorkersPerUser:0},{maxWorkersPerUser:7},{maxWorkersPerUser:1.5},{maxWorkersPerUser:'2'},{maxWorkersPerUser:true},{maxWorkersPerUser:2,enabled:true}])assert.equal((await settings(body)).status,400);
  const readsBefore=reads;await fetch(base);assert.equal(reads,readsBefore+1,'Changing the limit must invalidate status');
  const writesBefore=writes.length;
  principal={role:'user'};
  assert.equal((await settings({maxWorkersPerUser:2})).status,403);
  assert.equal((await fetch(base)).status,403); assert.equal((await patch('4',{enabled:false})).status,403);
  principal=undefined;
  assert.equal((await settings({maxWorkersPerUser:2})).status,401);
  assert.equal((await fetch(base)).status,401); assert.equal((await patch('4',{enabled:false})).status,401);
  assert.equal(writes.length,writesBefore);
  console.log('Admin authorization, strict validation, worker 4 control, pause/resume cache invalidation and coalesced status reads passed. No production data was changed.');
} finally {await app.close();}
