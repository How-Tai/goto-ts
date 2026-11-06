"""Real claim transactions in a disposable database; no contestant programs run."""
from pathlib import Path
import concurrent.futures,importlib.util,json,statistics,sys,threading,time
sys.path.insert(0,'/usr/src/app/src')
import psycopg2
from psycopg2.extras import execute_values
from postgresql.dbConfig import dbConfig

DB='otog_contest_priority_test_20261030'
assert sys.argv[1]==DB
config={**dbConfig,'dbname':DB}
def connect():return psycopg2.connect(**config,application_name='otog-contest-priority-test',options='-c statement_timeout=10000 -c lock_timeout=5000')
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.memory_guard=type('MemoryFixture',(),{'allows':lambda self:True})()
 module.pool_kib=lambda snapshot:8*1024*1024
 module.read_snapshot_kib=lambda:(16*1024*1024,12*1024*1024)
 return module
new=load('contest_priority','/candidate-queue.py')
old=load('baseline_priority','/baseline-queue.py')
admin=connect();admin.autocommit=True
def sql(text,args=None):
 with admin.cursor() as cursor:
  cursor.execute(text,args)
  return cursor.fetchall() if cursor.description else None
sql('''CREATE TABLE contest(id int PRIMARY KEY,"timeStart" timestamptz,"timeEnd" timestamptz);
CREATE TABLE problem(id int PRIMARY KEY,"timeLimit" int,"memoryLimit" int,"case" text,score int);
CREATE TABLE submission(id int PRIMARY KEY,"userId" int,"problemId" int REFERENCES problem(id),status text,"contestId" int REFERENCES contest(id),language text DEFAULT 'cpp',"sourceCode" text DEFAULT '',"creationDate" timestamptz DEFAULT now(),"queuedAt" timestamptz DEFAULT now(),"updateDate" timestamptz DEFAULT now());
CREATE TABLE "otogWorkerState"("workerId" int PRIMARY KEY,enabled boolean);
CREATE TABLE "otogGradingSettings"(id int PRIMARY KEY,"maxWorkersPerUser" int,"memoryReservationsEnabled" boolean);
CREATE TABLE "otogWorkerMemoryBudget"(id int PRIMARY KEY,"budgetKiB" bigint,"updatedAt" timestamptz DEFAULT now());
CREATE TABLE "otogWorkerMemoryReservation"("workerId" int PRIMARY KEY,"submissionId" int UNIQUE,"reservedKiB" bigint,phase text,"updatedAt" timestamptz DEFAULT now());
CREATE TABLE "otogWorkerJob"("workerId" int UNIQUE,"submissionId" int PRIMARY KEY REFERENCES submission(id));
CREATE TABLE "otogCompilationProfile"("submissionId" int PRIMARY KEY);
CREATE TABLE "otogWorkerAttempt"("submissionId" int PRIMARY KEY,attempts int);
CREATE TABLE "otogProblemGradingLimit"("problemId" int PRIMARY KEY,"maxWorkers" int);
CREATE INDEX queue_fifo ON submission("creationDate",id) WHERE status='waiting';
CREATE INDEX queue_user_fifo ON submission("userId","creationDate",id) WHERE status IN ('waiting','grading');
CREATE INDEX queue_status_problem_user ON submission(status,"problemId","userId");
INSERT INTO problem VALUES(9001,1000,64,'1',100),(9002,1000,64,'1',100),(9003,1000,1048576,'1',100);
INSERT INTO "otogWorkerState" SELECT i,true FROM generate_series(1,7) i;
INSERT INTO "otogGradingSettings" VALUES(1,7,false);
INSERT INTO "otogWorkerMemoryBudget" VALUES(1,8388608,now());''')
def reset(limit=7):
 sql('TRUNCATE submission,"otogWorkerJob","otogWorkerMemoryReservation","otogCompilationProfile","otogWorkerAttempt","otogProblemGradingLimit",contest CASCADE')
 sql('UPDATE "otogWorkerState" SET enabled=true')
 sql('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=%s,"memoryReservationsEnabled"=false',(limit,))
 sql('''INSERT INTO contest VALUES(1,now()-interval '1 hour',now()+interval '1 hour'),(2,now()-interval '2 days',now()-interval '1 day'),(3,now()+interval '1 day',now()+interval '2 days')''')
def add(sid,user,contest,minutes,problem=9001,creation_minutes=None):
 sql('''INSERT INTO submission(id,"userId","problemId",status,"contestId","queuedAt","creationDate") VALUES(%s,%s,%s,'waiting',%s,now()-(%s*interval '1 minute'),now()-(%s*interval '1 minute'))''',(sid,user,problem,contest,minutes,minutes if creation_minutes is None else creation_minutes))
def fixtures():
 add(1,10,None,30);add(2,10,2,29);add(3,11,3,28);add(4,10,1,10);add(5,11,1,10);add(6,12,None,29)
def claim(worker,module=new):
 conn=connect()
 try:return module.claim(conn,worker)
 finally:conn.close()
checks=[]
reset();fixtures();order=[claim(worker).id for worker in range(1,7)]
assert order==[4,5,2,3,1,6],order
checks.append('live contests before other contest work before practice, including older practice from the same user')
reset();fixtures();add(7,13,1,0,creation_minutes=100000)
assert [claim(i).id for i in [1,2,3]]==[4,5,7]
checks.append('FIFO uses latest enqueue time with ID tie-breaker; rejudging an old submission does not jump its priority group')
reset();fixtures();sql('UPDATE contest SET "timeEnd"=now()-interval \'1 second\' WHERE id=1');assert claim(1).id==2
reset();fixtures();sql('UPDATE contest SET "timeStart"=now()-interval \'1 second\' WHERE id=3');assert claim(1).id==3
checks.append('contest start/end and schedule changes are reflected on the next claim')
reset(1);fixtures();assert [claim(i).id for i in [1,2,3]]==[4,5,6]
assert claim(4) is None
checks.append('per-user concurrency remains enforced; capped users do not block another user')
reset();fixtures();sql('INSERT INTO "otogProblemGradingLimit" VALUES(9001,1)');add(8,14,None,0,problem=9002)
assert claim(1).id==4;assert claim(2).id==8;assert claim(3) is None
checks.append('per-problem limits still apply and do not block eligible lower-priority work')
reset();sql('UPDATE "otogGradingSettings" SET "memoryReservationsEnabled"=true');add(1,10,1,30,problem=9003);add(2,10,None,20)
assert claim(1).id==2
checks.append('an ineligible large contest job does not block a smaller eligible job')
reset();fixtures();sql('UPDATE "otogWorkerState" SET enabled=false WHERE "workerId"=1');assert claim(1) is None
hold=connect()
try:
 with hold.cursor() as cursor:cursor.execute('SELECT id FROM submission WHERE id=4 FOR UPDATE')
 assert claim(2).id==5
finally:hold.rollback();hold.close()
checks.append('paused workers stay paused and row locking allows other eligible users to progress')
reset(2)
for sid in range(1,31):add(sid,1,None if sid<=10 else 1,100-sid)
barrier=threading.Barrier(7)
def parallel(worker):barrier.wait();job=claim(worker);return job.id if job else None
with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:results=list(pool.map(parallel,range(1,8)))
claimed=sorted(x for x in results if x is not None);assert claimed==[11,12],claimed
assert sql('SELECT count(*) FROM "otogWorkerMemoryReservation"')[0][0]==2
assert sql('SELECT sum(attempts) FROM "otogWorkerAttempt"')[0][0]==2
checks.append('seven concurrent claimers create exactly two distinct contest leases under a per-user cap of two')
bench=[]
for size in [100,1000,5000]:
 row={'queued':size}
 for label,module in [('before',old),('after',new)]:
  reset()
  with admin.cursor() as cursor:execute_values(cursor,'''INSERT INTO submission(id,"userId","problemId",status,"contestId","queuedAt","creationDate") VALUES %s''',[(i,i%100+1,9001,'waiting',None if i%3==0 else 1 if i%3==1 else 2,'2026-01-01','2026-01-01') for i in range(1,size+1)])
  sql('ANALYZE submission');times=[]
  for worker in range(1,8):
   start=time.perf_counter();assert claim(worker,module) is not None;times.append((time.perf_counter()-start)*1000)
  row[label+'MedianClaimMs']=round(statistics.median(times),3);row[label+'MaxClaimMs']=round(max(times),3)
 bench.append(row)
admin.close()
print(json.dumps({'passed':True,'checks':checks,'claimBenchmarks':bench,'database':DB,'productionWrites':0,'contestProgramsExecuted':0}),flush=True)
