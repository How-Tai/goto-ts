CREATE TABLE "otogGradingSettings" (
  id integer PRIMARY KEY CHECK (id=1),
  "maxWorkersPerUser" integer NOT NULL DEFAULT 1 CHECK ("maxWorkersPerUser" BETWEEN 1 AND 6),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);
INSERT INTO "otogGradingSettings" (id) VALUES (1);
