CREATE TABLE "cfContest" (
 "contestId" integer PRIMARY KEY REFERENCES contest(id) ON DELETE CASCADE,
 settings jsonb NOT NULL, phase text NOT NULL DEFAULT 'draft' CHECK (phase IN ('draft','scheduled','system_pending','system_testing','final','cancelled')),
 "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "cfProblem" (
 id serial PRIMARY KEY, "contestId" integer NOT NULL REFERENCES "cfContest"("contestId") ON DELETE CASCADE,
 "problemId" integer NOT NULL REFERENCES problem(id) ON DELETE RESTRICT,
 letter text NOT NULL, points integer NOT NULL CHECK(points>0), bundle text NOT NULL CHECK(bundle ~ '^[a-f0-9]{32}$'),
 config jsonb NOT NULL, validation text NOT NULL DEFAULT 'pending' CHECK(validation IN ('pending','valid','invalid')),
 UNIQUE("contestId","problemId"), UNIQUE("contestId",letter)
);
CREATE TABLE "cfRun" (
 "submissionId" integer PRIMARY KEY REFERENCES submission(id) ON DELETE CASCADE,
 "cfProblemId" integer NOT NULL REFERENCES "cfProblem"(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('contest','validator','reference','hack')),
 phase text NOT NULL CHECK(phase IN ('pretest','system','validation','hack')),
 plan jsonb NOT NULL, outcome jsonb, "preOutcome" jsonb, verified boolean NOT NULL DEFAULT false, "requestId" text NOT NULL UNIQUE
);
CREATE INDEX "cfRun_cfProblemId_kind_phase_idx" ON "cfRun"("cfProblemId",kind,phase);
CREATE TABLE "cfHack" (
 "submissionId" integer PRIMARY KEY REFERENCES "cfRun"("submissionId") ON DELETE CASCADE,
 "targetId" integer NOT NULL REFERENCES "cfRun"("submissionId") ON DELETE RESTRICT,
 input text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','successful','unsuccessful','invalid','ignored','judge_error')),
 answer text, "inputDigest" text NOT NULL
);
CREATE INDEX "cfHack_targetId_state_idx" ON "cfHack"("targetId",state);
CREATE TABLE "cfLock" (
 "cfProblemId" integer NOT NULL REFERENCES "cfProblem"(id) ON DELETE CASCADE,
 "userId" integer NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY("cfProblemId","userId")
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='otog_api_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON "cfContest","cfProblem","cfRun","cfHack","cfLock" TO otog_api_runtime;
  GRANT USAGE,SELECT ON SEQUENCE "cfProblem_id_seq" TO otog_api_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='otog_grader_runtime') THEN
  GRANT SELECT ON "cfContest","cfProblem","cfRun","cfHack","cfLock" TO otog_grader_runtime;
  GRANT UPDATE(outcome,"preOutcome",verified) ON "cfRun" TO otog_grader_runtime;
  GRANT UPDATE(state,answer) ON "cfHack" TO otog_grader_runtime;
  GRANT UPDATE(validation) ON "cfProblem" TO otog_grader_runtime;
 END IF;
END $$;
