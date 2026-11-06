-- Operational metadata only. Worker 7 starts paused until an admin enables it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "otogCompilerState") THEN
    RAISE EXCEPTION 'Stop and remove the dedicated compiler slots before assigning grader 7';
  END IF;
END $$;
ALTER TABLE "otogWorkerState" DROP CONSTRAINT "otogWorkerState_workerId_check";
ALTER TABLE "otogWorkerState" ADD CONSTRAINT "otogWorkerState_workerId_check"
  CHECK ("workerId" BETWEEN 1 AND 7);
ALTER TABLE "otogGradingSettings" DROP CONSTRAINT "otogGradingSettings_maxWorkersPerUser_check";
ALTER TABLE "otogGradingSettings" ADD CONSTRAINT "otogGradingSettings_maxWorkersPerUser_check"
  CHECK ("maxWorkersPerUser" BETWEEN 1 AND 7);
INSERT INTO "otogWorkerState" ("workerId",enabled) VALUES (7,false) ON CONFLICT DO NOTHING;
