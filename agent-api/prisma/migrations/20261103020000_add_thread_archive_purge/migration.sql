-- When a thread was archived (moved to the portal trash) and when its disk data was purged.
-- Additive: older releases ignore both columns; the trigger keeps archived_at correct for every
-- code path that archives or restores a thread, including releases that do not know the column.
ALTER TABLE "threads" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "threads" ADD COLUMN "archived_data_purged_at" TIMESTAMP(3);

-- Existing archived threads: updated_at is the best available archive time.
UPDATE "threads" SET "archived_at" = "updated_at" WHERE "status" = 'archived';

CREATE INDEX "threads_status_archived_at_idx" ON "threads"("status", "archived_at");

CREATE OR REPLACE FUNCTION "threads_track_archived_at"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'archived' THEN
    IF TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'archived' OR NEW."archived_at" IS NULL THEN
      NEW."archived_at" := COALESCE(CASE WHEN TG_OP = 'UPDATE' AND OLD."status" = 'archived' THEN OLD."archived_at" END, CURRENT_TIMESTAMP);
    END IF;
  ELSE
    NEW."archived_at" := NULL;
    NEW."archived_data_purged_at" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "threads_track_archived_at"
  BEFORE INSERT OR UPDATE OF "status", "archived_at", "archived_data_purged_at" ON "threads"
  FOR EACH ROW EXECUTE FUNCTION "threads_track_archived_at"();
