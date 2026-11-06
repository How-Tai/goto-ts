"""Exercise real CF queue admission with the optional compiler/memory policies."""
import os,json,sys
sys.path.insert(0,'/usr/src/app/src')
import psycopg2
from postgresql.dbConfig import dbConfig
from worker_queue import claim,recover_owned,release_memory,lock_worker

assert dbConfig['dbname']=='otog_cf_test_20261031'
assert os.environ['OTOG_COMPILE_PIPELINE']=='1' and os.environ['OTOG_DEDICATED_COMPILER']=='1'
conn=psycopg2.connect(**dbConfig)
try:
    lock_worker(conn,1)
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout='10s'")
        cur.execute('SELECT "memoryReservationsEnabled" FROM "otogGradingSettings" WHERE id=1')
        assert cur.fetchone()[0]
    conn.commit()
    job=claim(conn,1)
    assert job and job.id==int(os.environ['CF_PROFILE_SUBMISSION_ID'])
    assert (job.timeLimit,job.memoryLimit)==(1000,64),(job.timeLimit,job.memoryLimit)
    assert job.fullCompilation and getattr(job,'pipelineStage','legacy')=='legacy'
    with conn.cursor() as cur:
        cur.execute('SELECT "reservedKiB" FROM "otogWorkerMemoryReservation" WHERE "workerId"=1')
        amount=cur.fetchone()[0]
        assert amount>=1024*1024,amount
    conn.commit();recover_owned(conn,1);release_memory(conn,1)
    with conn.cursor() as cur:
        cur.execute('SELECT status FROM submission WHERE id=%s',(job.id,));assert cur.fetchone()[0]=='waiting'
    conn.commit()
    os.environ['OTOG_WORKER_ROLE']='compiler'
    assert claim(conn,7) is None,'Dedicated compiler must not consume CF tool/hack jobs'
    os.environ['OTOG_WORKER_ROLE']='grader'
    job=claim(conn,1);assert job and job.id==int(os.environ['CF_PROFILE_SUBMISSION_ID'])
    recover_owned(conn,1);release_memory(conn,1)
    print(json.dumps({'passed':True,'memoryReservationsEnabled':True,'dedicatedCompilerEnabled':True,'compilerCannotClaimCf':True,'graderClaimsCfDirectly':True,'snapshotLimitsOverrideEditedProblem':True,'reservedMiB':amount//1024,'productionWrites':0}),flush=True)
finally:conn.close()
