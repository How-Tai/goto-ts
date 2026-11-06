'use strict';
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{createRequire}=require('node:module'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile);
const names=Array.from({length:7},(_,i)=>'otog-grader'+(i?i+1:'')+'-1');
function parseOnlineCpus(text) {
 const cpus = new Set();
 for (const item of text.trim().split(',')) {
  if (!/^\d+(?:-\d+)?$/.test(item)) throw Error('Invalid online CPU list');
  const [first, last = first] = item.split('-').map(Number);
  if (first > last || last > 4095) throw Error('Invalid online CPU range');
  for (let cpu = first; cpu <= last; cpu++) cpus.add(cpu);
 }
 return [...cpus].sort((a,b) => a-b);
}

function plan(snapshot, onlineCpus) {
 const requestedCount = snapshot.allocation.count;
 if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > names.length) {
  throw Error('Invalid configured grader count');
 }
 const graderCpus = onlineCpus.slice(0,-1).slice(0,names.length);
 const maxGraders = graderCpus.length;
 const count = Math.min(requestedCount,maxGraders);
 const busy = new Set(snapshot.busy);
 const reserved = new Set(graderCpus.slice(0,count));
 for (const worker of snapshot.workers) {
  const cpu = graderCpus[worker.workerId-1];
  if (cpu !== undefined && (worker.enabled || busy.has(worker.workerId))) reserved.add(cpu);
 }
 const serviceCpus = onlineCpus.filter(cpu => !reserved.has(cpu));
 if (!serviceCpus.length) throw Error('A CPU must remain available to services');
 const drainingWorkers = [...busy].filter(id => id > count).sort((a,b) => a-b);
 const workerCpus = names.map((name,i) => ({
  name, cpus: reserved.has(graderCpus[i]) ? [graderCpus[i]] : serviceCpus,
 }));
 return {count,requestedCount,maxGraders,onlineCpus,serviceCpus,workerCpus,drainingWorkers};
}
module.exports={plan,parseOnlineCpus};
if(require.main===module)main().catch(()=>{console.error('Grader allocator failed to start');process.exitCode=1});
async function main(){
 const req=createRequire(process.argv[2]),{PrismaClient}=req('@otog/database'),db=new PrismaClient();
 const compose='/home/otog/otog/docker-compose.vm.yml',root='/run/otog-grader-allocation';fs.mkdirSync(root,{recursive:true});
 const serviceContainers=['otog-postgres-1','otog-minio-1'];
 let lastMaxGraders=null;
 let state={observedAt:new Date().toISOString(),serviceCpus:[],drainingWorkers:[],error:'Starting CPU allocator'},signature='',running=false,again=false,stopping=false,lastAudit=0,kernelAffinity=null;
 const command=async(file,args)=>{const r=await execute(file,args,{timeout:20000,maxBuffer:1024*1024});return r.stdout.trim()};
 const snapshot=async()=>{
  const rows=await db.$queryRawUnsafe(`SELECT json_build_object(
   'allocation',(SELECT row_to_json(a) FROM "otogGraderAllocation" a WHERE id=1),
   'workers',(SELECT json_agg(json_build_object('workerId',"workerId",'enabled',enabled) ORDER BY "workerId") FROM "otogWorkerState"),
   'busy',(SELECT coalesce(json_agg(id),'[]'::json) FROM (SELECT "workerId" id FROM "otogWorkerJob" UNION SELECT "workerId" FROM "otogWorkerMemoryReservation") b)) AS data`);
  const s=rows[0].data;
  if(!s.allocation||s.workers.length!==7||s.workers.some((w,i)=>w.workerId!==i+1)||s.busy.some(id=>!Number.isInteger(id)||id<1||id>7))throw Error('Unexpected grader configuration');return s;
 };
 const apply=async(p)=>{
  // Move kernel background work before any additional grader is enabled.
  // The plan retains CPUs of retiring jobs until their sandbox cleanup ends.
  kernelAffinity=JSON.parse(await command('/usr/bin/python3',['/usr/local/lib/otog/kernel-affinity.py',JSON.stringify(p.serviceCpus)]));
  const mask=p.serviceCpus.join(',');const units=JSON.parse(await command('systemctl',['list-units','--type=service','--state=running','--output=json','--no-pager'])).map(v=>v.unit).concat('user.slice');
  for(const unit of units)if(!/^[A-Za-z0-9_.@:-]+\.service$/.test(unit)&&unit!=='user.slice')throw Error('Unexpected service name');
  const unitMasks=async()=>Object.fromEntries((await command('systemctl',['show',...units,'-p','Id','-p','AllowedCPUs','--no-pager'])).split(/\n\s*\n/).map(block=>{const v=Object.fromEntries(block.split('\n').filter(Boolean).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)]}));return[v.Id,v.AllowedCPUs]}));
  const previousMasks=await unitMasks();
  for(const unit of units){
   if(previousMasks[unit]&&sameMask(previousMasks[unit],p.serviceCpus))continue;
   try{await command('systemctl',['set-property','--runtime',unit,'AllowedCPUs='+mask])}
   catch(e){const active=await command('systemctl',['show',unit,'-p','LoadState','--value']);if(active!=='not-found')throw e}
  }
  // Ordinary containers are moved before any additional grader can be enabled.
  const before=JSON.parse(await command('docker',['inspect',...names,...serviceContainers]));
  for(let i=names.length;i<before.length;i++)if(!sameMask(before[i].HostConfig.CpusetCpus,p.serviceCpus))await command('docker',['update','--cpuset-cpus',mask,before[i].Name.slice(1)]);
  for(let i=0;i<7;i++){const w=p.workerCpus[i];if(!sameMask(before[i].HostConfig.CpusetCpus,w.cpus))await command('docker',['update','--cpuset-cpus',w.cpus.join(','),w.name])}
  // Persist the same layout for container recreation; avoid restarting them.
  const layout={serviceCpus:mask,workers:p.workerCpus.map(w=>w.cpus.join(','))};
  const python=`import json,sys,yaml,os\nfrom pathlib import Path\np=Path(sys.argv[1]);d=json.loads(sys.argv[2]);c=yaml.safe_load(p.read_text())\nfor n in ['postgres','minio']:c['services'][n]['cpuset']=d['serviceCpus']\nfor i,v in enumerate(d['workers'],1):c['services']['grader'+('' if i==1 else str(i))]['cpuset']=v\nt=p.with_suffix('.allocation.tmp');t.write_text(yaml.safe_dump(c,sort_keys=False));os.chmod(t,p.stat().st_mode);os.chown(t,p.stat().st_uid,p.stat().st_gid);t.replace(p)`;
  await command('/usr/bin/python3',['-c',python,compose,JSON.stringify(layout)]);
  const masks=await unitMasks();for(const unit of units)if(!masks[unit]||!sameMask(masks[unit],p.serviceCpus))throw Error('A service CPU assignment did not apply');
  const actual=JSON.parse(await command('docker',['inspect',...names,...serviceContainers]));
  for(let i=0;i<actual.length;i++){const expected=i<7?p.workerCpus[i].cpus:p.serviceCpus;if(!actual[i].State.Running||!sameMask(actual[i].HostConfig.CpusetCpus,expected))throw Error('A container CPU assignment did not apply')}
 };
 async function tick(){
  if(running){again=true;return}running=true;
  try{
   do{again=false;
    const onlineCpus=parseOnlineCpus(fs.readFileSync('/sys/devices/system/cpu/online','utf8'));
    const s=await snapshot(),p=plan(s,onlineCpus);
    // Stop excess claims before assigning their CPUs to services.
    if(s.workers.some(w=>w.enabled&&w.workerId>p.maxGraders)){
     await db.$executeRaw`UPDATE "otogWorkerState" SET enabled=false,"updatedAt"=now() WHERE enabled AND "workerId">${p.maxGraders}`;
    }
    const key=JSON.stringify([s.allocation.revision,p.serviceCpus,p.workerCpus]);
    if(key!==signature||Date.now()-lastAudit>30000){await apply(p);signature=key;lastAudit=Date.now()}
    let applied=false;
    if(s.allocation.revision!==s.allocation.appliedRevision || (lastMaxGraders!==null && p.maxGraders>lastMaxGraders)){
     applied=await db.$transaction(async tx=>{
      const rows=await tx.$queryRaw`SELECT revision FROM "otogGraderAllocation" WHERE id=1 FOR UPDATE`;
      if(rows[0].revision!==s.allocation.revision)return false;
      await tx.$queryRaw`SELECT "workerId" FROM "otogWorkerState" ORDER BY "workerId" FOR UPDATE`;
      await tx.$executeRaw`UPDATE "otogWorkerState" SET enabled=("workerId"<=${p.count}),"updatedAt"=now()`;
      await tx.$executeRaw`UPDATE "otogGraderAllocation" SET "appliedRevision"=revision WHERE id=1`;
      return true;
     });if(!applied)again=true;
    }
    lastMaxGraders=p.maxGraders;
    state={observedAt:new Date().toISOString(),count:p.count,requestedCount:p.requestedCount,maxGraders:p.maxGraders,onlineCpus:p.onlineCpus,revision:s.allocation.revision,serviceCpus:p.serviceCpus,drainingWorkers:p.drainingWorkers,error:null,kernelAffinity};
    fs.writeFileSync(root+'/status.json',JSON.stringify(state));
   }while(again&&!stopping);
  }catch(e){signature='';state={...state,observedAt:new Date().toISOString(),error:'CPU allocation is waiting for recovery; it will retry automatically'};console.error('CPU allocation reconciliation failed: '+String(e.code||e.name||'unknown'))}
  finally{running=false}
 }
 const server=http.createServer((request,response)=>{
  if(request.method==='GET'&&request.url==='/status'){response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(state));return}
  if(request.method==='POST'&&request.url==='/wake'&&!request.headers['transfer-encoding']&&(!request.headers['content-length']||request.headers['content-length']==='0')){response.writeHead(202);response.end();void tick();return}
  response.writeHead(404);response.end();
 });server.maxRequestsPerSocket=100;server.requestTimeout=2000;server.headersTimeout=3000;server.listen(8766,'127.0.0.1');
 const timer=setInterval(()=>void tick(),1000);await tick();
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearInterval(timer);server.close();const done=setInterval(async()=>{if(running)return;clearInterval(done);await db.$disconnect();process.exit(0)},100) });
}
function sameMask(text,values){const actual=new Set(text.split(',').flatMap(v=>{const[a,b=a]=v.split('-').map(Number);return Array.from({length:b-a+1},(_,i)=>a+i)}));return actual.size===values.length&&values.every(v=>actual.has(v))}
function compress(cpus){let result=[],start=cpus[0],last=start;for(const cpu of cpus.slice(1)){if(cpu===last+1){last=cpu;continue}result.push(start===last?''+start:start+'-'+last);start=last=cpu}result.push(start===last?''+start:start+'-'+last);return result.join(',')}
