CREATE TABLE "otogSubmissionRequest" (
  "userId" integer NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "requestId" varchar(64) NOT NULL,
  fingerprint char(64) NOT NULL,
  "submissionId" integer NOT NULL UNIQUE REFERENCES submission(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "requestId")
);

CREATE FUNCTION otog_submission_update_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('otog_submission_updates', NEW.id::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER otog_submission_update_notify
AFTER INSERT OR UPDATE OF status, "updateDate", public ON submission
FOR EACH ROW EXECUTE FUNCTION otog_submission_update_notify();
