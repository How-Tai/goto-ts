ALTER TABLE "otogGradingSettings" ADD COLUMN "maxCompilerJobs" INTEGER NOT NULL DEFAULT 10
 CHECK ("maxCompilerJobs" BETWEEN 1 AND 10);
GRANT SELECT ("maxCompilerJobs"), UPDATE ("maxCompilerJobs") ON "otogGradingSettings" TO otog_api_runtime;
GRANT SELECT ("maxCompilerJobs") ON "otogGradingSettings" TO otog_grader_runtime;
