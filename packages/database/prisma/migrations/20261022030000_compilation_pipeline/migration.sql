-- Operational handoff only. Existing worker IDs, submission statuses and
-- grading results are unchanged. Activate only after draining old workers.
CREATE TABLE "otogCompiledArtifact" (
  "submissionId" INTEGER PRIMARY KEY REFERENCES submission(id) ON DELETE CASCADE ON UPDATE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('compiling','ready','evaluating','bypass')),
  "ownerWorkerId" INTEGER UNIQUE CHECK ("ownerWorkerId" BETWEEN 1 AND 6),
  token TEXT NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{32}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "sourceName" TEXT,
  digest TEXT CHECK (digest ~ '^[0-9a-f]{64}$'),
  "sizeBytes" BIGINT NOT NULL CHECK ("sizeBytes" BETWEEN 0 AND 67108864),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((state IN ('compiling','evaluating')) = ("ownerWorkerId" IS NOT NULL)),
  CHECK (state NOT IN ('ready','evaluating') OR
    ("sourceName" IS NOT NULL AND digest IS NOT NULL AND "sizeBytes">0)),
  CHECK (state!='bypass' OR "sizeBytes"=0)
);
CREATE INDEX "otogCompiledArtifact_ready_idx" ON "otogCompiledArtifact" (state,"updatedAt");
CREATE INDEX "otogCompiledArtifact_active_idx" ON "otogCompiledArtifact" (state)
  WHERE state!='bypass';

-- Preserve queue age for deliberate worker stage handoffs. API/manual rejudges
-- and ordinary recovery retain the original queue-entry trigger behavior.
CREATE OR REPLACE FUNCTION otog_record_queue_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='waiting' AND NOT (
    OLD.status='grading'
    AND COALESCE(current_setting('otog.internal_stage_handoff',true),'off')='on'
    AND pg_has_role(current_user,'otog_grader_runtime','USAGE')
  ) THEN
    NEW."queuedAt" := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
