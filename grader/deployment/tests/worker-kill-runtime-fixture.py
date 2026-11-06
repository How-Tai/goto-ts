"""Kill/recovery fixture restricted to a disposable test database."""
import importlib.util
import os
import sys
import time
sys.path.insert(0, '/usr/src/app/src')
import psycopg2
from postgresql.dbConfig import dbConfig
if not dbConfig['dbname'].startswith('otog_worker_test_kill_'):
    raise RuntimeError('Kill tests refuse the production database.')
conn = psycopg2.connect(**dbConfig)
mode = sys.argv[1]

def scalar(sql):
    with conn.cursor() as cursor:
        cursor.execute(sql)
        result = cursor.fetchone()[0]
    conn.commit()
    return result

def wait(sql, expected, seconds=30):
    for _ in range(seconds * 5):
        if scalar(sql) == expected: return
        time.sleep(0.2)
    raise RuntimeError('Fixture condition timed out: ' + sql)

if mode == 'schema':
    spec = importlib.util.spec_from_file_location('worker_tests', '/worker-tests.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with conn.cursor() as cursor: cursor.execute(module.SCHEMA)
    conn.commit()
elif mode == 'claimed':
    wait('SELECT count(*) FROM "otogWorkerState" WHERE "workerId"=4 AND "startedAt" IS NOT NULL', 1)
    code = '#include <stdio.h>\n#include <unistd.h>\nint main(){int x;scanf("%d",&x);usleep(6000000);printf("%d\\n",x);}\n'
    with conn.cursor() as cursor:
        cursor.execute("INSERT INTO problem VALUES (900004,10000,256,'1',100)")
        cursor.execute('''INSERT INTO submission (id,"userId","problemId","contestId",status,"sourceCode",language)
          VALUES (991,991,900004,1,'waiting',%s,'cpp')''', (code,))
    conn.commit()
    wait('SELECT count(*) FROM "otogWorkerJob" WHERE "workerId"=4 AND "submissionId"=991', 1)
    # Pause is persistent. Restart must recover the interrupted job but leave
    # it waiting until Resume, allowing us to verify there is no invented score.
    with conn.cursor() as cursor:
        cursor.execute('UPDATE "otogWorkerState" SET enabled=false WHERE "workerId"=4')
    conn.commit()
    wait("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='otog-worker-4'", 1)
    print('Disposable worker has an active job and is paused for the recovery check.', flush=True)
elif mode == 'recover':
    wait("SELECT count(*) FROM submission WHERE id=991 AND status='waiting'", 1)
    assert scalar('SELECT count(*) FROM "otogWorkerJob"') == 0
    assert scalar('SELECT count(*) FROM "submissionResult"') == 0
    assert scalar('SELECT enabled FROM "otogWorkerState" WHERE "workerId"=4') is False
    with conn.cursor() as cursor: cursor.execute('UPDATE "otogWorkerState" SET enabled=true WHERE "workerId"=4')
    conn.commit()
    wait("SELECT count(*) FROM submission WHERE id=991 AND status='accept'", 1, 45)
    assert scalar('SELECT count(*) FROM "submissionResult" WHERE "submissionId"=991 AND score=100') == 1
    assert scalar('SELECT count(*) FROM "contestScore" WHERE "userId"=991 AND score=100') == 1
    assert scalar('SELECT count(*) FROM "contestScoreHistory" WHERE "submissionId"=991') == 1
    assert scalar('SELECT count(*) FROM "otogWorkerJob"') == 0
    print('Forced container restart recovered the active lease, preserved Pause, resumed to AC and committed exactly one score/history entry.', flush=True)
else: raise ValueError('Unknown fixture mode')
conn.close()
