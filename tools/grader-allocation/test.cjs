const assert=require('node:assert/strict'),{plan,parseOnlineCpus}=require('./allocator.cjs');
const eightCpus=parseOnlineCpus('0-7');
for(let count=1;count<=7;count++){
 const s={allocation:{count},workers:Array.from({length:7},(_,i)=>({workerId:i+1,enabled:i<count})),busy:[]},p=plan(s,eightCpus);
 assert.deepEqual(p.serviceCpus,Array.from({length:8-count},(_,i)=>count+i));assert.deepEqual(p.drainingWorkers,[]);
 for(let i=0;i<7;i++)assert.deepEqual(p.workerCpus[i].cpus,i<count?[i]:p.serviceCpus);
}
let p=plan({allocation:{count:3},workers:Array.from({length:7},(_,i)=>({workerId:i+1,enabled:i<3})),busy:[4,6]},eightCpus);assert.deepEqual(p.serviceCpus,[4,6,7]);assert.deepEqual(p.drainingWorkers,[4,6]);
p=plan({allocation:{count:7},workers:Array.from({length:7},(_,i)=>({workerId:i+1,enabled:i<3})),busy:[1]},eightCpus);assert.deepEqual(p.serviceCpus,[7]);
assert.throws(()=>plan({allocation:{count:8}},eightCpus));
console.log(JSON.stringify({passed:true,checks:['all counts reclaim unused CPUs','draining leases and memory prevent premature core reuse','new grader cores reserved before enabling','CPU 7 always retained for services']}));

const snapshot={allocation:{count:7},workers:Array.from({length:7},(_,i)=>({workerId:i+1,enabled:true})),busy:[]};
for (const [topology,capacity,services] of [
 ['0',0,[0]],
 ['0-2',2,[2]],
 ['0,2,4',2,[4]],
 ['0-11',7,[7,8,9,10,11]],
]) {
 const resized=plan(snapshot,parseOnlineCpus(topology));
 assert.equal(resized.count,capacity);
 assert.equal(resized.requestedCount,7);
 assert.deepEqual(resized.serviceCpus,services);
 assert(resized.workerCpus.every(w=>w.cpus.every(cpu=>resized.onlineCpus.includes(cpu))));
}
assert.throws(()=>parseOnlineCpus(''));
console.log('Verified one CPU pauses all grading and smaller or sparse CPU lists cap the pool.');
