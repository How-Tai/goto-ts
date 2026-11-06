"""Six actual grader pipelines, restricted to a disposable database."""
import importlib.util
from pathlib import Path
import sys
import time

sys.path.insert(0, '/usr/src/app/src')
import psycopg2
from postgresql.dbConfig import dbConfig

if not dbConfig['dbname'].startswith('otog_worker_test_six_'):
    raise RuntimeError('Refusing the production database')
conn = psycopg2.connect(**dbConfig)

def scalar(sql):
    with conn.cursor() as cursor:
        cursor.execute(sql)
        value = cursor.fetchone()[0]
    conn.commit()
    return value

if sys.argv[1] == 'schema':
    spec = importlib.util.spec_from_file_location('worker_tests', '/worker-tests.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with conn.cursor() as cursor:
        cursor.execute(module.SCHEMA)
        cursor.execute(Path('/worker-expansion.sql').read_text())
        cursor.execute('UPDATE "otogWorkerState" SET enabled=true')
    conn.commit()
elif sys.argv[1] == 'grade':
    for attempt in range(40):
        if scalar('SELECT count(*) FROM "otogWorkerState" WHERE "startedAt" IS NOT NULL') == 6:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Six disposable workers did not register')
    code = '#include <stdio.h>\n#include <unistd.h>\nint main(){int x;if(scanf("%d",&x)!=1)return 1;usleep(1200000);printf("%d\\n",x);}\n'
    with conn.cursor() as cursor:
        cursor.execute("INSERT INTO problem VALUES (900006,1000,256,'1',100)")
        for job in range(991,997):
            cursor.execute('''INSERT INTO submission
                (id,"userId","problemId","contestId",status,"sourceCode",language)
                VALUES (%s,%s,900006,1,'waiting',%s,'cpp')''', (job,job,code))
    conn.commit()
    for attempt in range(60):
        if scalar("SELECT count(*) FROM submission WHERE status IN ('waiting','grading')") == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Six grading jobs did not finish')
    with conn.cursor() as cursor:
        cursor.execute('''SELECT S.id,S.status,R.score FROM submission S
            LEFT JOIN "submissionResult" R ON R."submissionId"=S.id ORDER BY S.id''')
        assert cursor.fetchall() == [(i,'accept',100) for i in range(991,997)]
        cursor.execute('SELECT score FROM "contestScore" ORDER BY "userId"')
        assert cursor.fetchall() == [(100,)] * 6
        cursor.execute('SELECT count(*) FROM "contestScoreHistory"')
        assert cursor.fetchone()[0] == 6
        cursor.execute('SELECT count(*) FROM "otogWorkerJob"')
        assert cursor.fetchone()[0] == 0
    print('Six actual C++ jobs accepted, six scores/history entries, no remaining leases.')
elif sys.argv[1] == 'same-user':
    code = '#include <stdio.h>\n#include <unistd.h>\nint main(){int x;scanf("%d",&x);usleep(1200000);printf("%d\\n",x);}\n'
    with conn.cursor() as cursor:
        cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=3')
        for job in range(997,1003):
            cursor.execute('''INSERT INTO submission
                (id,"userId","problemId","contestId",status,"sourceCode",language)
                VALUES (%s,777,900006,1,'waiting',%s,'cpp')''',(job,code))
    conn.commit();peak=0
    for attempt in range(900):
        active=scalar('SELECT count(*) FROM submission WHERE "userId"=777 AND status=\'grading\'')
        peak=max(peak,active)
        assert active<=3, f'User limit exceeded: {active}'
        if scalar('SELECT count(*) FROM submission WHERE "userId"=777 AND status IN (\'waiting\',\'grading\')')==0:break
        time.sleep(0.1)
    else:raise RuntimeError('Same-account parallel grading did not finish')
    assert peak==3, f'Three jobs should execute concurrently; observed {peak}'
    assert scalar('SELECT count(*) FROM submission S JOIN "submissionResult" R ON R."submissionId"=S.id WHERE S."userId"=777 AND S.status=\'accept\' AND R.score=100')==6
    assert scalar('SELECT score FROM "contestScore" WHERE "userId"=777')==100
    assert scalar('SELECT count(*) FROM "contestScoreHistory" H JOIN submission S ON S.id=H."submissionId" WHERE S."userId"=777')==6
    assert scalar('SELECT count(*) FROM "otogWorkerJob"')==0
    print('Six same-account C++ jobs accepted; exactly three ran together, scores/history remained correct.')
else:
    raise RuntimeError('Unsupported fixture mode')
conn.close()
