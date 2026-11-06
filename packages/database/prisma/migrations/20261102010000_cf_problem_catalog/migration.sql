ALTER TABLE "problem" ADD COLUMN "area" VARCHAR(16) NOT NULL DEFAULT 'otog';
ALTER TABLE "problem" ADD CONSTRAINT "problem_area_check" CHECK ("area" IN ('otog', 'codeforces'));
CREATE INDEX "problem_area_show_id_idx" ON "problem" ("area", "show", "id");
ALTER TABLE "cfRun" DROP CONSTRAINT "cfRun_kind_check";
ALTER TABLE "cfRun" ADD CONSTRAINT "cfRun_kind_check" CHECK (kind IN ('contest','validator','reference','hack','practice'));
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='otog_api_runtime') THEN
  GRANT SELECT (area), INSERT (area), UPDATE (area) ON problem TO otog_api_runtime;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='otog_grader_runtime') THEN
  GRANT SELECT (area) ON problem TO otog_grader_runtime;
 END IF;
END $$;

-- Existing contest links are retained until the explicit copy migration has
-- copied their files. The admin catalog migration endpoint performs that step
-- under the same contest advisory locks used by submission/worker persistence.
