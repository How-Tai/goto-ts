-- Global per-problem concurrency caps; absent rows retain normal worker capacity.
CREATE TABLE "otogProblemGradingLimit" (
  "problemId" integer PRIMARY KEY REFERENCES problem(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "maxWorkers" integer NOT NULL CHECK ("maxWorkers" BETWEEN 1 AND 6),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER otog_problem_grading_limit_notify
AFTER INSERT OR UPDATE OR DELETE ON "otogProblemGradingLimit"
FOR EACH STATEMENT EXECUTE FUNCTION otog_queue_notify();
