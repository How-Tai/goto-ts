-- Drained rollout: older workers can still use the initial >=1 GiB allowance.
-- Only the new evaluator lowers it after both compilation phases have ended.
ALTER TABLE "otogWorkerMemoryReservation"
  DROP CONSTRAINT "otogWorkerMemoryReservation_reservedKiB_check",
  ADD CONSTRAINT "otogWorkerMemoryReservation_reservedKiB_check"
    CHECK ("reservedKiB" >= 263168),
  ADD COLUMN phase TEXT NOT NULL DEFAULT 'compiling'
    CHECK (phase IN ('compiling', 'evaluating')),
  ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
