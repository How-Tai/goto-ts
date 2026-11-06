CREATE TABLE "otogGraderAllocation" (
  id integer PRIMARY KEY CHECK (id=1),
  count integer NOT NULL CHECK (count BETWEEN 1 AND 7),
  revision integer NOT NULL DEFAULT 1,
  "appliedRevision" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO "otogGraderAllocation" (id,count)
SELECT 1,greatest(1,coalesce(max("workerId") FILTER (WHERE enabled),1)) FROM "otogWorkerState";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='otog_api_runtime') THEN
    GRANT SELECT,UPDATE ON "otogGraderAllocation" TO otog_api_runtime;
  END IF;
END $$;
