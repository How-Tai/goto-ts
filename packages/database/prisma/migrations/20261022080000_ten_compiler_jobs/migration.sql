-- Job slot identities are independent of the six grading-worker identities.
ALTER TABLE "otogWorkerJob" DROP CONSTRAINT "otogWorkerJob_workerId_check",
 ADD CONSTRAINT "otogWorkerJob_workerId_check" CHECK ("workerId" BETWEEN 1 AND 16);
ALTER TABLE "otogWorkerMemoryReservation" DROP CONSTRAINT "otogWorkerMemoryReservation_workerId_check",
 ADD CONSTRAINT "otogWorkerMemoryReservation_workerId_check" CHECK ("workerId" BETWEEN 1 AND 16);
ALTER TABLE "otogCompiledArtifact" DROP CONSTRAINT "otogCompiledArtifact_ownerWorkerId_check",
 ADD CONSTRAINT "otogCompiledArtifact_ownerWorkerId_check" CHECK ("ownerWorkerId" BETWEEN 1 AND 16);
ALTER TABLE "otogCompilerState" DROP CONSTRAINT "otogCompilerState_workerId_check",
 ADD CONSTRAINT "otogCompilerState_workerId_check" CHECK ("workerId" BETWEEN 7 AND 16);
INSERT INTO "otogCompilerState" ("workerId",enabled)
 SELECT id,COALESCE((SELECT bool_and(enabled) FROM "otogCompilerState" WHERE "workerId" IN (7,8)),false)
 FROM generate_series(9,16) id ON CONFLICT ("workerId") DO NOTHING;

-- 18 grader connections + 12 idle dispatcher connections + 10 active runners.
ALTER ROLE otog_grader_runtime CONNECTION LIMIT 48;
