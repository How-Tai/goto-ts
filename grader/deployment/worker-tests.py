"""Integration tests run only in a disposable database, never the live queue."""
import os
import sys
import threading
import unittest
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, '/usr/src/app/src')
import psycopg2
from postgresql import dbQuery as database
from postgresql.dbConfig import dbConfig
from DTO.submission import SubmissionDTO
from DTO.result import ResultDTO, GroupResult
from DTO.verdictTestcase import VerdictTestcase
from constants.Enums import SubmissionStatus, VerdictStatus
from worker_queue import claim, lock_worker, recover_owned, unlock_user, persist

if not dbConfig['dbname'].startswith('otog_worker_test_'):
    raise RuntimeError('Tests refuse to use the production database.')

SCHEMA = '''
CREATE TABLE problem (id integer PRIMARY KEY, "timeLimit" integer, "memoryLimit" integer, "case" text, score integer);
CREATE TABLE contest (id integer PRIMARY KEY,"gradingMode" text);
CREATE TABLE submission (id integer PRIMARY KEY,"userId" integer,"problemId" integer,"contestId" integer,
 status text,"sourceCode" text,language text,"creationDate" timestamptz DEFAULT NOW(),"updateDate" timestamptz DEFAULT NOW());
CREATE TABLE "submissionResult" (id serial PRIMARY KEY,"submissionId" integer UNIQUE REFERENCES submission(id) ON DELETE CASCADE,
 result text,score integer,"timeUsed" integer,"memUsed" integer,errmsg text);
CREATE TABLE "subtaskResult" (id serial PRIMARY KEY,"submissionResultId" integer REFERENCES "submissionResult"(id) ON DELETE CASCADE,
 "subtaskIndex" integer,score integer,"fullScore" integer);
CREATE TABLE verdict (id serial PRIMARY KEY,"subtaskId" integer REFERENCES "subtaskResult"(id) ON DELETE CASCADE,
 "testcaseIndex" integer,status text,percent double precision,"timeUsed" integer,"memUsed" integer);
CREATE TABLE "contestScore" (id serial PRIMARY KEY,"contestId" integer,"userId" integer,"problemId" integer,
 score integer,"latestSubmission" timestamptz,UNIQUE("contestId","userId","problemId"));
CREATE TABLE "contestScoreHistory" (id serial PRIMARY KEY,"contestScoreId" integer,"submissionId" integer UNIQUE,score integer);
CREATE TABLE "otogWorkerJob" ("submissionId" integer PRIMARY KEY REFERENCES submission(id) ON DELETE CASCADE,
 "workerId" integer NOT NULL CHECK ("workerId" BETWEEN 1 AND 4),"claimedAt" timestamptz NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX "worker_one_lease" ON "otogWorkerJob" ("workerId");
CREATE TABLE "otogWorkerState" ("workerId" integer PRIMARY KEY CHECK ("workerId" BETWEEN 1 AND 4),enabled boolean NOT NULL DEFAULT true,
 "cpuId" integer,"processId" integer,"startedAt" timestamptz,"lastHeartbeat" timestamptz,
 "updatedAt" timestamptz DEFAULT NOW());
INSERT INTO "otogWorkerState" ("workerId") VALUES (1),(2),(3),(4);
INSERT INTO problem VALUES (1,1000,256,'2',100);
INSERT INTO contest VALUES (1,'bestSubmission');
''' + Path('/user-limit.sql').read_text() + Path('/queue-time.sql').read_text()


def connect():
    return psycopg2.connect(**dbConfig)


def dto(job):
    return SubmissionDTO(job.id, job.userId, job.problemId, '', job.contestId,
                         job.sourceCode, job.language, job.maxScore,
                         job.timeLimit, job.memoryLimit, job.case, 'classic')


def result(job, score=100):
    verdict = VerdictTestcase(VerdictStatus.accept, 1, 10, 1024)
    return ResultDTO(job.id, 'PP', score, 10, 1024, None,
                     SubmissionStatus.accept, [GroupResult(score,100,[verdict])])


class Workers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        conn = connect()
        with conn.cursor() as cursor:
            cursor.execute(SCHEMA)
            cursor.execute('UPDATE "otogWorkerState" SET enabled=false,"startedAt"=NOW() WHERE "workerId"=4')
            cursor.execute('SELECT "startedAt" FROM "otogWorkerState" WHERE "workerId"=4')
            before = cursor.fetchone()[0]
            cursor.execute(Path('/worker-expansion.sql').read_text())
            cursor.execute('SELECT enabled,"startedAt" FROM "otogWorkerState" WHERE "workerId"=4')
            assert cursor.fetchone() == (False, before), 'Migration must preserve existing worker controls'
            cursor.execute('SELECT "workerId",enabled FROM "otogWorkerState" WHERE "workerId">4 ORDER BY "workerId"')
            assert cursor.fetchall() == [(5, False), (6, False)], 'New workers must start paused'
        conn.commit()
        conn.close()

    def setUp(self):
        self.conn = connect()
        with self.conn.cursor() as cursor:
            cursor.execute('TRUNCATE submission,"contestScoreHistory","contestScore" RESTART IDENTITY CASCADE')
            cursor.execute("UPDATE contest SET \"gradingMode\"='bestSubmission'")
            cursor.execute('UPDATE "otogWorkerState" SET enabled=true')
            cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=1 WHERE id=1')
        self.conn.commit()
        database.db.conn = self.conn
        os.environ['OTOG_WORKER_ID'] = '1'

    def tearDown(self):
        self.conn.close()

    def add(self, count, same_user=False, contest=False):
        with self.conn.cursor() as cursor:
            for i in range(1,count+1):
                cursor.execute('''INSERT INTO submission (id,"userId","problemId","contestId",status,"sourceCode",language)
                    VALUES (%s,%s,1,%s,'waiting','int main(){}','cpp')''',
                    (i,1 if same_user else i,1 if contest else None))
        self.conn.commit()

    def scalar(self, sql):
        with self.conn.cursor() as cursor:
            cursor.execute(sql)
            return cursor.fetchone()[0]

    def test_six_concurrent_workers_never_duplicate_jobs(self):
        self.add(30)
        barrier = threading.Barrier(6)
        completed, errors = [], []
        guard = threading.Lock()
        def run(worker):
            conn = connect()
            try:
                lock_worker(conn, worker)
                barrier.wait(timeout=10)
                while True:
                    job = claim(conn,worker)
                    if job is None:
                        break
                    with conn.cursor() as cursor:
                        cursor.execute("UPDATE submission SET status='accept' WHERE id=%s",(job.id,))
                        cursor.execute('DELETE FROM "otogWorkerJob" WHERE "submissionId"=%s',(job.id,))
                    conn.commit()
                    unlock_user(conn,job.userId)
                    with guard:
                        completed.append(job.id)
            except Exception as exc:
                with guard: errors.append(repr(exc))
            finally:
                conn.close()
        threads = [threading.Thread(target=run,args=(worker,)) for worker in (1,2,3,4,5,6)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=30)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(errors,[])
        self.assertEqual(sorted(completed),list(range(1,31)))
        self.assertEqual(len(completed),len(set(completed)))

    def test_paused_worker_four_does_not_claim(self):
        self.add(2)
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE "otogWorkerState" SET enabled=false WHERE "workerId"=4')
        self.conn.commit()
        self.assertIsNone(claim(self.conn,4))
        self.assertEqual(claim(self.conn,1).id,1)

    def test_cap_two_then_lower_to_one_preserves_active_jobs(self):
        self.add(3,same_user=True)
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=2')
        self.conn.commit()
        other=connect()
        try:
            first=claim(self.conn,1);second=claim(other,2)
            self.assertEqual((first.id,second.id),(1,2))
            self.assertIsNone(claim(self.conn,3))
            with self.conn.cursor() as cursor:
                cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=1')
            self.conn.commit()
            self.assertIsNone(claim(self.conn,3))
            self.assertEqual(self.scalar("SELECT count(*) FROM submission WHERE status='grading'"),2)
            os.environ['OTOG_WORKER_ID']='2';database.db.conn=other
            persist(other,database,dto(second),result(second))
            self.assertIsNone(claim(self.conn,3))
            os.environ['OTOG_WORKER_ID']='1';database.db.conn=self.conn
            persist(self.conn,database,dto(first),result(first))
            self.assertEqual(claim(self.conn,3).id,3)
        finally:
            other.close();database.db.conn=self.conn

    def test_six_claimers_respect_cap_three_and_allow_other_users(self):
        import time
        self.add(8,same_user=True)
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=3')
        self.conn.commit()
        barrier=threading.Barrier(6);claimed=[];errors=[];guard=threading.Lock()
        def run(worker):
            conn=connect()
            try:
                lock_worker(conn,worker);barrier.wait(timeout=10)
                for _ in range(20):
                    job=claim(conn,worker)
                    if job:
                        with guard:claimed.append(job.id)
                        break
                    time.sleep(0.01)
            except Exception as exc:
                with guard:errors.append(repr(exc))
            finally:conn.close()
        threads=[threading.Thread(target=run,args=(i,)) for i in range(1,7)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(timeout=20)
        self.assertEqual(errors,[]);self.assertFalse(any(t.is_alive() for t in threads))
        self.assertEqual(sorted(claimed),[1,2,3])
        with self.conn.cursor() as cursor:
            cursor.execute('INSERT INTO submission (id,"userId","problemId",status,"sourceCode",language) VALUES (99,99,1,\'waiting\',\'int main(){}\',\'cpp\')')
        self.conn.commit()
        idle=self.scalar('SELECT "workerId" FROM "otogWorkerState" WHERE "workerId" NOT IN (SELECT "workerId" FROM "otogWorkerJob") ORDER BY "workerId" LIMIT 1')
        self.assertEqual(claim(self.conn,idle).id,99,'A capped account must not block another account')

    def test_requeued_owned_job_still_reserves_its_user_slot(self):
        self.add(3,same_user=True)
        first=claim(self.conn,1)
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE submission SET status='waiting' WHERE id=%s",(first.id,))
        self.conn.commit()
        self.assertIsNone(claim(self.conn,2),'A status change must not free an owned execution slot')
        with self.conn.cursor() as cursor:cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=2')
        self.conn.commit()
        self.assertEqual(claim(self.conn,2).id,2,'An owned job must never be claimed twice')
        self.assertIsNone(claim(self.conn,3))
        self.assertEqual(self.scalar('SELECT count(*) FROM "otogWorkerJob"'),2)

    def test_rejudge_resets_queue_time_without_changing_claim_order(self):
        self.add(2,same_user=True)
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE submission SET "queuedAt"=NOW()-INTERVAL \'2 days\',"creationDate"=NOW()-INTERVAL \'3 days\' WHERE id=1')
            cursor.execute('SELECT "creationDate" FROM submission WHERE id=1')
            created=cursor.fetchone()[0]
        self.conn.commit()
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE submission SET status='waiting',\"updateDate\"=NOW() WHERE id=1 RETURNING \"queuedAt\",\"creationDate\"")
            queued,still_created=cursor.fetchone()
            cursor.execute('SELECT NOW()-INTERVAL \'5 seconds\'')
            self.assertGreater(queued,cursor.fetchone()[0])
            self.assertEqual(still_created,created)
        self.conn.commit()
        self.assertEqual(claim(self.conn,1).id,1,'Queue age must not change the established claim order')
        self.assertEqual(self.scalar('SELECT "queuedAt" FROM submission WHERE id=1'),queued)

    def test_unrelated_edits_do_not_reset_queue_time(self):
        self.add(1)
        before=self.scalar('SELECT "queuedAt" FROM submission WHERE id=1')
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE submission SET "updateDate"=NOW()+INTERVAL \'1 day\' WHERE id=1')
        self.conn.commit()
        self.assertEqual(self.scalar('SELECT "queuedAt" FROM submission WHERE id=1'),before)

    def test_reverse_completion_preserves_all_scoring_modes_and_rejudge(self):
        for mode,expected in [('classic',40),('bestSubmission',80),('bestSubtask',80)]:
            with self.subTest(mode=mode):
                with self.conn.cursor() as cursor:
                    cursor.execute('TRUNCATE submission,"contestScoreHistory","contestScore" RESTART IDENTITY CASCADE')
                    cursor.execute('UPDATE contest SET "gradingMode"=%s',(mode,))
                    cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=2')
                self.conn.commit();self.add(2,same_user=True,contest=True)
                first=claim(self.conn,1);second=claim(self.conn,2)
                os.environ['OTOG_WORKER_ID']='2';persist(self.conn,database,dto(second),result(second,40))
                os.environ['OTOG_WORKER_ID']='1';persist(self.conn,database,dto(first),result(first,80))
                self.assertEqual(self.scalar('SELECT score FROM "contestScore"'),expected)
                # Both historical entries remain while their results are absent.
                with self.conn.cursor() as cursor:
                    cursor.execute('DELETE FROM "submissionResult"')
                    cursor.execute("UPDATE submission SET status='waiting'")
                self.conn.commit()
                first=claim(self.conn,1);second=claim(self.conn,2)
                os.environ['OTOG_WORKER_ID']='2';persist(self.conn,database,dto(second),result(second,40))
                os.environ['OTOG_WORKER_ID']='1';persist(self.conn,database,dto(first),result(first,80))
                self.assertEqual(self.scalar('SELECT score FROM "contestScore"'),expected)
                self.assertEqual(self.scalar('SELECT count(*) FROM "contestScoreHistory"'),2)
                self.assertEqual(self.scalar('SELECT count(*) FROM "otogWorkerJob"'),0)

    def test_concurrent_score_commits_are_serialized(self):
        import importlib.util
        self.add(2,same_user=True,contest=True)
        with self.conn.cursor() as cursor:cursor.execute('UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=2')
        self.conn.commit();jobs=[claim(self.conn,1),claim(self.conn,2)]
        barrier=threading.Barrier(2);errors=[]
        # Separate modules model separate worker processes, avoiding shared
        # Python db globals in the two test threads.
        def run(job):
            conn=connect()
            try:
                spec=importlib.util.spec_from_file_location(f'postgresql.scoring_test_{job.id}',Path(database.__file__))
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.db.conn=conn
                barrier.wait(timeout=10);persist(conn,module,dto(job),result(job,80 if job.id==1 else 40),job.id)
            except Exception as exc:errors.append(repr(exc))
            finally:conn.close()
        threads=[threading.Thread(target=run,args=(job,)) for job in jobs]
        for thread in threads:thread.start()
        for thread in threads:thread.join(timeout=20)
        self.assertEqual(errors,[]);self.assertFalse(any(t.is_alive() for t in threads))
        self.assertEqual(self.scalar('SELECT score FROM "contestScore"'),80)
        self.assertEqual(self.scalar('SELECT count(*) FROM "contestScoreHistory"'),2)
        self.assertEqual(self.scalar('SELECT count(*) FROM "submissionResult"'),2)
        self.assertEqual(self.scalar('SELECT count(*) FROM "otogWorkerJob"'),0)

    def test_pause_preserves_current_job_then_resume(self):
        self.add(2,same_user=True,contest=True)
        first=claim(self.conn,4)
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE "otogWorkerState" SET enabled=false WHERE "workerId"=4')
        self.conn.commit()
        self.assertEqual(self.scalar('SELECT count(*) FROM "otogWorkerJob"'),1)
        self.assertEqual(self.scalar("SELECT count(*) FROM submission WHERE status='grading'"),1)
        os.environ['OTOG_WORKER_ID']='4'
        persist(self.conn,database,dto(first),result(first,80))
        unlock_user(self.conn,first.userId)
        self.assertIsNone(claim(self.conn,4))
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE "otogWorkerState" SET enabled=true WHERE "workerId"=4')
        self.conn.commit()
        self.assertEqual(claim(self.conn,4).id,2)

    def test_register_preserves_admin_pause(self):
        from worker_control import register
        with self.conn.cursor() as cursor:
            cursor.execute('UPDATE "otogWorkerState" SET enabled=false WHERE "workerId"=4')
        self.conn.commit()
        register(self.conn,4)
        self.assertFalse(self.scalar('SELECT enabled FROM "otogWorkerState" WHERE "workerId"=4'))
        self.assertIsNotNone(self.scalar('SELECT "lastHeartbeat" FROM "otogWorkerState" WHERE "workerId"=4'))

    def test_user_scoring_is_serial_and_best_score_is_preserved(self):
        self.check_serial_scoring(80)

    def test_latest_submission_scoring_is_preserved(self):
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE contest SET \"gradingMode\"='classic'")
        self.conn.commit()
        self.check_serial_scoring(40)

    def test_best_subtask_scoring_is_preserved(self):
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE contest SET \"gradingMode\"='bestSubtask'")
        self.conn.commit()
        self.check_serial_scoring(80)

    def check_serial_scoring(self, expected):
        self.add(2,same_user=True,contest=True)
        first = claim(self.conn,1)
        second_conn = connect()
        try:
            self.assertIsNone(claim(second_conn,2))
            persist(self.conn,database,dto(first),result(first,80))
            unlock_user(self.conn,first.userId)
            second = claim(second_conn,2)
            self.assertEqual(second.id,2)
            database.db.conn = second_conn
            os.environ['OTOG_WORKER_ID']='2'
            persist(second_conn,database,dto(second),result(second,40))
            unlock_user(second_conn,second.userId)
            self.assertEqual(self.scalar('SELECT score FROM "contestScore"'),expected)
            self.assertEqual(self.scalar('SELECT count(*) FROM "contestScoreHistory"'),2)
        finally:
            second_conn.close()

    def test_score_failure_rolls_back_result_and_verdicts(self):
        self.add(1,contest=True)
        job = claim(self.conn,1)
        original = database.updateContestScore
        def fail(*args): raise RuntimeError('Injected score save failure')
        database.updateContestScore = fail
        try:
            with self.assertRaisesRegex(RuntimeError,'Injected'):
                persist(self.conn,database,dto(job),result(job))
            self.assertEqual(self.scalar('SELECT count(*) FROM "submissionResult"'),0)
            self.assertEqual(self.scalar('SELECT count(*) FROM verdict'),0)
            self.assertEqual(self.scalar('SELECT status FROM submission'), 'grading')
            self.assertEqual(self.scalar('SELECT count(*) FROM "otogWorkerJob"'),1)
        finally:
            database.updateContestScore=original

    def test_restart_recovers_only_its_interrupted_job(self):
        self.add(2)
        lock_worker(self.conn,1)
        first = claim(self.conn,1)
        other = connect()
        lock_worker(other,2)
        second = claim(other,2)
        self.conn.close()  # releases the crashed worker's session locks
        self.conn=connect()
        database.db.conn=self.conn
        try:
            lock_worker(self.conn,1)
            self.assertEqual(recover_owned(self.conn,1),[first.id])
            self.assertEqual(self.scalar(f'SELECT status FROM submission WHERE id={second.id}'),'grading')
            recovered=claim(self.conn,1)
            self.assertEqual(recovered.id,first.id)
        finally:
            other.close()

    def test_duplicate_worker_id_is_rejected(self):
        lock_worker(self.conn,1)
        other=connect()
        try:
            with self.assertRaisesRegex(RuntimeError,'already running'):
                lock_worker(other,1)
        finally:
            other.close()

    def test_checker_files_are_private_and_test_inputs_read_only(self):
        import mainWorkers
        private=Path(mainWorkers.prepare_problem(900001))
        self.assertTrue((private/'1.in').is_symlink())
        self.assertFalse((private/'check.cpp').is_symlink())
        (private/'binCheck').write_text('worker-private')
        self.assertFalse(Path('/usr/src/app/shared-source/900001/binCheck').exists())
        (private/'check.cpp').write_text('private edit')
        self.assertEqual(Path('/usr/src/app/shared-source/900001/check.cpp').read_text(),'checker fixture\n')


if __name__ == '__main__':
    unittest.main(verbosity=2)
