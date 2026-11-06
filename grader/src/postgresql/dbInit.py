import traceback
import psycopg2
import psycopg2.extras

from constants.colors import colors
from .dbConfig import dbConfig


def init():
    # Main grading connections need their own bounds; a healthy heartbeat on
    # another connection cannot supervise a blocked connect/query/commit.
    config = dict(dbConfig)
    config.update(connect_timeout=5,
                  options='-c statement_timeout=60000 -c lock_timeout=10000',
                  keepalives=1, keepalives_idle=5, keepalives_interval=5,
                  keepalives_count=3, tcp_user_timeout=15000)
    return psycopg2.connect(**config)


class DB:
    conn = None

    def connect(self):
        self.conn = init()
        return

    def disconnect(self):
        self.conn.close()

    def update(self):
        self.conn.commit()

    def query(self, sql, value=()):
        try:
            cursor = self.conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor)
            cursor.execute(sql, value)
            return cursor
        except Exception:
            print(
                f"{colors.WARNING}[ PostgreSQL ]{colors.RESET} Execute failed."
            )
            traceback.print_exc()
            return None
