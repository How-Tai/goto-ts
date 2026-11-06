CREATE TABLE IF NOT EXISTS "otogUserAvatar" (
  "userId" integer PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "publicId" text NOT NULL UNIQUE,
  "version" integer NOT NULL CHECK ("version" > 0),
  "cloudName" text NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
