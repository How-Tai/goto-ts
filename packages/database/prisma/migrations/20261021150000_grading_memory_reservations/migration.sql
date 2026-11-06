-- Operational metadata only; no submission/verdict changes. New workers must
-- be activated together after draining old claimants (old code has no budget).
CREATE TABLE "otogWorkerMemoryBudget" (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  "budgetKiB" BIGINT NOT NULL DEFAULT 0 CHECK ("budgetKiB" >= 0),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "otogWorkerMemoryBudget" (id) VALUES (1);

-- Deliberately independent of the queue lease and submission foreign keys:
-- completing/deleting a result or queue lease does not stop sandbox processes.
-- Only the owning worker releases this after cleanup or container recovery.
CREATE TABLE "otogWorkerMemoryReservation" (
  "workerId" INTEGER PRIMARY KEY CHECK ("workerId" BETWEEN 1 AND 6),
  "submissionId" INTEGER NOT NULL UNIQUE,
  "reservedKiB" BIGINT NOT NULL CHECK ("reservedKiB" >= 1048576),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
