import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire('/home/otog/otog/apps/api/package.json');
createRequire(require.resolve('@nestjs/common'))('reflect-metadata');
const {PrismaClient}=require('@otog/database');
const {GradingService}=await import(pathToFileURL(process.argv[2]).href);
const name=process.argv[3];assert(/^otog_worker_test_six_\d+_\d+$/.test(name));
const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;
const prisma=new PrismaClient({datasources:{db:{url:url.toString()}}});
try {
  await prisma.$executeRawUnsafe('ALTER TABLE problem ADD COLUMN name text DEFAULT \'Fixture\'');
  const service=new GradingService(prisma);service.readTelemetry=async()=>null;
  assert.equal((await service.status()).maxWorkersPerUser,1);
  for(const value of [2,3,6,1]){
    await service.setMaxWorkersPerUser(value);
    assert.equal((await service.status()).maxWorkersPerUser,value);
  }
  await service.setMaxWorkersPerUser(2);
  await prisma.$executeRawUnsafe(`INSERT INTO submission (id,"userId","problemId",status,"sourceCode",language)
    VALUES (1,77,1,'grading','','cpp'),(2,77,1,'waiting','','cpp'),(3,77,1,'waiting','','cpp')`);
  await prisma.$executeRawUnsafe('INSERT INTO "otogWorkerJob" ("submissionId","workerId") VALUES (1,1)');
  service.invalidate();let data=await service.status();
  assert.equal(data.queue.find(q=>q.id===2).waitingForUser,false);
  // A very old submission rejudged now retains its original queue priority,
  // while the dashboard's waiting timer measures this queue entry only.
  await prisma.$executeRawUnsafe(`UPDATE submission SET "creationDate"=NOW()-INTERVAL '3 days',
    "queuedAt"=NOW()-INTERVAL '2 days' WHERE id=1`);
  const [before]=await prisma.$queryRawUnsafe('SELECT "creationDate" FROM submission WHERE id=1');
  await prisma.$executeRawUnsafe("UPDATE submission SET status='waiting',\"updateDate\"=NOW() WHERE id=1");
  service.invalidate();data=await service.status();
  assert.equal(data.queue[0].id,1);
  const queued=Date.parse(data.queue[0].queuedAt);
  assert(Math.abs(Date.now()-queued)<10000,'Rejudge waiting time must start now, not days ago');
  const [after]=await prisma.$queryRawUnsafe('SELECT "creationDate","queuedAt" FROM submission WHERE id=1');
  assert.equal(after.creationDate.toISOString(),before.creationDate.toISOString());
  await prisma.$executeRawUnsafe("UPDATE submission SET \"updateDate\"=NOW()+INTERVAL '1 day' WHERE id=1");
  service.invalidate();assert.equal(Date.parse((await service.status()).queue[0].queuedAt),queued);
  await prisma.$executeRawUnsafe("UPDATE submission SET status='waiting' WHERE \"problemId\"=1");
  const times=await prisma.$queryRawUnsafe('SELECT DISTINCT "queuedAt" FROM submission');
  assert.equal(times.length,1,'Bulk rejudge entries should share the same request timestamp');
  assert.equal(data.queue.find(q=>q.id===3).waitingForUser,true);
  await service.setMaxWorkersPerUser(1);data=await service.status();
  assert(data.queue.every(q=>q.waitingForUser));
  await prisma.$executeRawUnsafe("UPDATE submission SET status='waiting' WHERE id=1");
  await service.setMaxWorkersPerUser(2);data=await service.status();
  assert.equal(data.queue.find(q=>q.id===1).waitingForUser,true);
  assert.equal(data.queue.find(q=>q.id===2).waitingForUser,false);
  await service.setMaxWorkersPerUser(1);
  const fresh=new GradingService(prisma);fresh.readTelemetry=async()=>null;
  assert.equal((await fresh.status()).maxWorkersPerUser,1);
  console.log('Real PostgreSQL persistence, queue reasons, rejudge timers, bulk rejudge and original ordering passed.');
} finally {await prisma.$disconnect();}
