-- Build online so submissions and grader result writes can continue.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "otog_submission_status_problem_user_idx"
ON "submission" ("status", "problemId", "userId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "otog_submission_user_problem_latest_idx"
ON "submission" ("userId", "problemId", "creationDate" DESC);
