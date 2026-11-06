-- A completed or failed smaller compile attempt can learn the original-memory
-- profile for this immutable submission. Metadata survives rejudges only.
CREATE TABLE "otogCompilationProfile" (
  "submissionId" INTEGER PRIMARY KEY REFERENCES submission(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
