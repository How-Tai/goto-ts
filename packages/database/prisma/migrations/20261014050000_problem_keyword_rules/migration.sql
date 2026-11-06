CREATE TABLE IF NOT EXISTS "otogProblemKeywordRules" (
  "problemId" integer PRIMARY KEY REFERENCES "problem"("id") ON DELETE CASCADE,
  "requiredKeywords" text[] NOT NULL DEFAULT '{}',
  "bannedKeywords" text[] NOT NULL DEFAULT '{}',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
