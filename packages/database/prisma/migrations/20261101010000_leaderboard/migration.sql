ALTER TABLE "user" ADD COLUMN "showInLeaderboard" BOOLEAN NOT NULL DEFAULT true;
UPDATE "user" SET "showInLeaderboard" = false WHERE role = 'admin';
