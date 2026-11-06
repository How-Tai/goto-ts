-- Wake idle workers only when work or eligibility changes, never on testcase updates/heartbeats.
CREATE OR REPLACE FUNCTION otog_queue_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('otog_queue_wakeup', '');
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION otog_submission_queue_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'waiting' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pg_notify('otog_queue_wakeup', '');
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER otog_submission_queue_notify
AFTER INSERT OR UPDATE OF status ON submission
FOR EACH ROW EXECUTE FUNCTION otog_submission_queue_notify();

CREATE TRIGGER otog_worker_slot_notify
AFTER INSERT OR DELETE ON "otogWorkerJob"
FOR EACH STATEMENT EXECUTE FUNCTION otog_queue_notify();

CREATE TRIGGER otog_worker_enabled_notify
AFTER UPDATE OF enabled ON "otogWorkerState"
FOR EACH ROW WHEN (OLD.enabled IS DISTINCT FROM NEW.enabled)
EXECUTE FUNCTION otog_queue_notify();

CREATE TRIGGER otog_worker_limit_notify
AFTER UPDATE OF "maxWorkersPerUser" ON "otogGradingSettings"
FOR EACH ROW WHEN (OLD."maxWorkersPerUser" IS DISTINCT FROM NEW."maxWorkersPerUser")
EXECUTE FUNCTION otog_queue_notify();
