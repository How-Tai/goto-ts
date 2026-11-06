-- Preserve current admission behavior until an administrator changes it.
ALTER TABLE "otogGradingSettings" ADD COLUMN "memoryReservationsEnabled" BOOLEAN NOT NULL DEFAULT true;
GRANT SELECT ("memoryReservationsEnabled"), UPDATE ("memoryReservationsEnabled") ON "otogGradingSettings" TO otog_api_runtime;
GRANT SELECT ("memoryReservationsEnabled") ON "otogGradingSettings" TO otog_grader_runtime;
