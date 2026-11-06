-- Queue-entry time is independent of the original submission date and other edits.
ALTER TABLE submission ADD COLUMN "queuedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- For existing waiting jobs, the last update is the best available queue-entry time.
UPDATE submission SET "queuedAt"=CASE WHEN status='waiting' THEN "updateDate" ELSE "creationDate" END;

CREATE FUNCTION otog_record_queue_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='waiting' THEN
    NEW."queuedAt" := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Also catches repeated rejudge requests and worker recovery back to waiting.
CREATE TRIGGER otog_submission_queue_entry
BEFORE UPDATE OF status ON submission
FOR EACH ROW EXECUTE FUNCTION otog_record_queue_entry();
