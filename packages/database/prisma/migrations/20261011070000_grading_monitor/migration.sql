-- Additive operational metadata. Existing submission/results remain untouched.
CREATE TABLE IF NOT EXISTS "otogWorkerJob" (
  "submissionId" integer PRIMARY KEY REFERENCES submission(id) ON DELETE CASCADE,
  "workerId" integer NOT NULL CHECK ("workerId" BETWEEN 1 AND 4),
  "claimedAt" timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE "otogWorkerJob" DROP CONSTRAINT IF EXISTS "otogWorkerJob_workerId_check";
ALTER TABLE "otogWorkerJob" ADD CONSTRAINT "otogWorkerJob_workerId_check" CHECK ("workerId" BETWEEN 1 AND 4);
CREATE TABLE IF NOT EXISTS "otogWorkerState" (
  "workerId" integer PRIMARY KEY CHECK ("workerId" BETWEEN 1 AND 4),
  enabled boolean NOT NULL DEFAULT true,
  "cpuId" integer,
  "processId" integer,
  "startedAt" timestamptz,
  "lastHeartbeat" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO "otogWorkerState" ("workerId") VALUES (1),(2),(3),(4) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS "otog_queue_fifo_idx" ON submission ("creationDate",id) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS "otog_queue_user_fifo_idx" ON submission ("userId","creationDate",id) WHERE status IN ('waiting','grading');
CREATE UNIQUE INDEX IF NOT EXISTS "otog_worker_one_lease_idx" ON "otogWorkerJob" ("workerId");
