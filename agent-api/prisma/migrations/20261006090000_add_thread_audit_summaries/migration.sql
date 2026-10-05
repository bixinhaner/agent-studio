-- Precomputed admin conversation-audit summaries.
-- Rows are recomputed by the API (same JS logic as before) whenever dirty_seq > clean_seq;
-- triggers below bump dirty_seq when any source data of a thread summary changes.

CREATE SEQUENCE "thread_audit_summary_seq";

CREATE TABLE "thread_audit_summaries" (
  "thread_id" TEXT NOT NULL,
  "dirty_seq" BIGINT NOT NULL DEFAULT nextval('thread_audit_summary_seq'),
  "clean_seq" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT,
  "audience" TEXT,
  "has_channel" BOOLEAN NOT NULL DEFAULT false,
  "channel_type" TEXT,
  "user_id" TEXT,
  "feedback_total" INTEGER NOT NULL DEFAULT 0,
  "feedback_positive" INTEGER NOT NULL DEFAULT 0,
  "feedback_negative" INTEGER NOT NULL DEFAULT 0,
  "search_text" TEXT NOT NULL DEFAULT '',
  "summary" JSONB,
  "refreshed_at" TIMESTAMP(3),
  CONSTRAINT "thread_audit_summaries_pkey" PRIMARY KEY ("thread_id"),
  CONSTRAINT "thread_audit_summaries_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "thread_audit_summaries_stale_idx" ON "thread_audit_summaries"("thread_id") WHERE "dirty_seq" > "clean_seq";

-- Marks one thread stale. Selecting from threads skips threads deleted in the same statement
-- (e.g. message cascades during thread deletion), so the FK can never fail.
CREATE FUNCTION "thread_audit_mark_dirty"(target_thread_id TEXT) RETURNS void AS $$
BEGIN
  IF target_thread_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO "thread_audit_summaries" ("thread_id")
  SELECT "id" FROM "threads" WHERE "id" = target_thread_id
  ON CONFLICT ("thread_id") DO UPDATE SET "dirty_seq" = nextval('thread_audit_summary_seq');
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "thread_audit_mark_user_dirty"(target_user_id TEXT) RETURNS void AS $$
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO "thread_audit_summaries" ("thread_id")
  SELECT "id" FROM "threads" WHERE "user_id" = target_user_id
  ON CONFLICT ("thread_id") DO UPDATE SET "dirty_seq" = nextval('thread_audit_summary_seq');
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "thread_audit_mark_all_dirty"() RETURNS void AS $$
BEGIN
  UPDATE "thread_audit_summaries" SET "dirty_seq" = nextval('thread_audit_summary_seq');
END;
$$ LANGUAGE plpgsql;

-- threads: any change (title, status, feedback, run config, updated_at, owner).
CREATE FUNCTION "thread_audit_threads_trg"() RETURNS trigger AS $$
BEGIN
  PERFORM "thread_audit_mark_dirty"(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_threads" AFTER INSERT OR UPDATE ON "threads"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_threads_trg"();

-- messages: previews and counts.
CREATE FUNCTION "thread_audit_messages_trg"() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "thread_audit_mark_dirty"(OLD."thread_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id") THEN
    PERFORM "thread_audit_mark_dirty"(NEW."thread_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_messages" AFTER INSERT OR UPDATE OR DELETE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_messages_trg"();

-- external conversation bindings: channel summary and audience.
CREATE FUNCTION "thread_audit_bindings_trg"() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "thread_audit_mark_dirty"(OLD."thread_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM "thread_audit_mark_dirty"(NEW."thread_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_bindings" AFTER INSERT OR UPDATE OR DELETE ON "external_conversation_bindings"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_bindings_trg"();

-- users: only fields shown in or searched by the summary (not login timestamps).
CREATE FUNCTION "thread_audit_users_trg"() RETURNS trigger AS $$
BEGIN
  PERFORM "thread_audit_mark_user_dirty"(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_users" AFTER UPDATE OF "display_name", "email", "user_type", "role", "status" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_users_trg"();

-- organization memberships: brand-employee audience and organization name.
CREATE FUNCTION "thread_audit_memberships_trg"() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "thread_audit_mark_user_dirty"(OLD."user_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW."user_id" IS DISTINCT FROM OLD."user_id") THEN
    PERFORM "thread_audit_mark_user_dirty"(NEW."user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_memberships" AFTER INSERT OR UPDATE OR DELETE ON "organization_memberships"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_memberships_trg"();

-- organizations: name / brand shown for brand employees.
CREATE FUNCTION "thread_audit_organizations_trg"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "thread_audit_summaries" ("thread_id")
  SELECT t."id" FROM "threads" t
  JOIN "organization_memberships" m ON m."user_id" = t."user_id"
  WHERE m."organization_id" = NEW."id"
  ON CONFLICT ("thread_id") DO UPDATE SET "dirty_seq" = nextval('thread_audit_summary_seq');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_organizations" AFTER UPDATE OF "name", "public_brand_id" ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_organizations_trg"();

-- integration instances: channel integration name.
CREATE FUNCTION "thread_audit_integrations_trg"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "thread_audit_summaries" ("thread_id")
  SELECT b."thread_id" FROM "external_conversation_bindings" b
  JOIN "threads" t ON t."id" = b."thread_id"
  WHERE b."integration_instance_id" = NEW."id"
  ON CONFLICT ("thread_id") DO UPDATE SET "dirty_seq" = nextval('thread_audit_summary_seq');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_integrations" AFTER UPDATE OF "name", "type" ON "integration_instances"
  FOR EACH ROW EXECUTE FUNCTION "thread_audit_integrations_trg"();

-- Rare admin edits referenced through JSON run config: recompute everything.
CREATE FUNCTION "thread_audit_all_trg"() RETURNS trigger AS $$
BEGIN
  PERFORM "thread_audit_mark_all_dirty"();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "thread_audit_agent_modes" AFTER INSERT OR DELETE OR UPDATE OF "name", "slug" ON "agent_modes"
  FOR EACH STATEMENT EXECUTE FUNCTION "thread_audit_all_trg"();
CREATE TRIGGER "thread_audit_public_brands" AFTER UPDATE OF "key", "name" ON "public_brands"
  FOR EACH STATEMENT EXECUTE FUNCTION "thread_audit_all_trg"();

-- Seed one stale row per existing thread; the API backfills them on first use.
INSERT INTO "thread_audit_summaries" ("thread_id") SELECT "id" FROM "threads" ON CONFLICT DO NOTHING;
