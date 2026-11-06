"""Persistent pause state and low-frequency heartbeats; no judging-result writes."""
import os
import threading
import psycopg2

STATE = 'otogCompilerState' if os.environ.get('OTOG_WORKER_ROLE') == 'compiler' else 'otogWorkerState'


def register(conn, worker_id):
    cpus = sorted(os.sched_getaffinity(0))
    with conn.cursor() as cursor:
        cursor.execute(f'''INSERT INTO "{STATE}"
            ("workerId","cpuId","processId","startedAt","lastHeartbeat")
            VALUES (%s,%s,%s,NOW(),NOW()) ON CONFLICT ("workerId") DO UPDATE
            SET "cpuId"=EXCLUDED."cpuId","processId"=EXCLUDED."processId",
                "startedAt"=NOW(),"lastHeartbeat"=NOW()''',
            (worker_id, cpus[0] if len(cpus)==1 else None, os.getpid()))
    conn.commit()


def start_heartbeat(config, worker_id):
    stopping = threading.Event()

    def heartbeat():
        conn = None
        try:
            while not stopping.wait(5):
                try:
                    if conn is None or conn.closed:
                        conn = psycopg2.connect(**config, connect_timeout=5,
                                               application_name=f'otog-heartbeat-{worker_id}')
                        conn.autocommit = True
                        with conn.cursor() as cursor:
                            cursor.execute("SET statement_timeout='3s'")
                    with conn.cursor() as cursor:
                        cursor.execute(f'UPDATE "{STATE}" SET "lastHeartbeat"=NOW() WHERE "workerId"=%s', (worker_id,))
                except psycopg2.Error:
                    if conn is not None: conn.close()
                    conn = None
        finally:
            if conn is not None: conn.close()

    thread = threading.Thread(target=heartbeat, name='worker-heartbeat', daemon=True)
    thread.start()
    return stopping
