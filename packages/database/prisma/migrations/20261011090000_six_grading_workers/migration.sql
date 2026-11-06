-- Expand only operational metadata; contestant submissions/results are untouched.
-- The new workers start paused so deployment can verify them before accepting jobs.
ALTER TABLE "otogWorkerJob" DROP CONSTRAINT "otogWorkerJob_workerId_check";
ALTER TABLE "otogWorkerJob" ADD CONSTRAINT "otogWorkerJob_workerId_check"
  CHECK ("workerId" BETWEEN 1 AND 6);
ALTER TABLE "otogWorkerState" DROP CONSTRAINT "otogWorkerState_workerId_check";
ALTER TABLE "otogWorkerState" ADD CONSTRAINT "otogWorkerState_workerId_check"
  CHECK ("workerId" BETWEEN 1 AND 6);
INSERT INTO "otogWorkerState" ("workerId",enabled) VALUES (5,false),(6,false)
  ON CONFLICT DO NOTHING;
