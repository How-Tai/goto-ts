-- Additive operational metadata; six grading-worker identities stay unchanged.
ALTER TABLE "otogWorkerJob" DROP CONSTRAINT "otogWorkerJob_workerId_check";
ALTER TABLE "otogWorkerJob" ADD CONSTRAINT "otogWorkerJob_workerId_check" CHECK ("workerId" BETWEEN 1 AND 8);
ALTER TABLE "otogWorkerMemoryReservation" DROP CONSTRAINT "otogWorkerMemoryReservation_workerId_check";
ALTER TABLE "otogWorkerMemoryReservation" ADD CONSTRAINT "otogWorkerMemoryReservation_workerId_check" CHECK ("workerId" BETWEEN 1 AND 8);
ALTER TABLE "otogCompiledArtifact" DROP CONSTRAINT "otogCompiledArtifact_ownerWorkerId_check";
ALTER TABLE "otogCompiledArtifact" ADD CONSTRAINT "otogCompiledArtifact_ownerWorkerId_check" CHECK ("ownerWorkerId" BETWEEN 1 AND 8);
CREATE TABLE "otogCompilerState" (
  "workerId" INTEGER PRIMARY KEY CHECK ("workerId" IN (7,8)),
  enabled BOOLEAN NOT NULL DEFAULT false,
  "cpuId" INTEGER,
  "processId" INTEGER,
  "startedAt" TIMESTAMPTZ(6),
  "lastHeartbeat" TIMESTAMPTZ(6),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "otogCompilerState" ("workerId") VALUES (7),(8);
REVOKE ALL ON "otogCompilerState" FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON "otogCompilerState" TO otog_grader_runtime;
