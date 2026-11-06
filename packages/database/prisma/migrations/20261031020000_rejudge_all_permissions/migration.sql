-- The API bulk rejudge clears stale retry/artifact metadata for completed jobs.
-- Keep the runtime role separate from the owner and grader roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='otog_api_runtime') THEN
    IF to_regclass('"otogWorkerAttempt"') IS NOT NULL THEN
      GRANT SELECT ("submissionId"), DELETE ON "otogWorkerAttempt" TO otog_api_runtime;
    END IF;
    IF to_regclass('"otogCompiledArtifact"') IS NOT NULL THEN
      GRANT SELECT ("submissionId"), DELETE ON "otogCompiledArtifact" TO otog_api_runtime;
    END IF;
  END IF;
END;
$$;
