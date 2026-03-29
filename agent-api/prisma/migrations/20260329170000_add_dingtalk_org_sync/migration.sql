ALTER TABLE "users"
  ADD COLUMN "status_source" TEXT NOT NULL DEFAULT 'sync',
  ADD COLUMN "sync_state" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "manual_disabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "admin_note" TEXT,
  ADD COLUMN "last_synced_at" TIMESTAMP(3);

ALTER TABLE "department_memberships"
  ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'sync',
  ADD COLUMN "last_synced_at" TIMESTAMP(3);

CREATE TABLE "departments" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "external_id" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "parent_department_id" TEXT REFERENCES "departments"("id") ON DELETE SET NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_jobs" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'dingtalk',
  "scope_type" TEXT NOT NULL,
  "scope_external_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "trigger_type" TEXT NOT NULL,
  "triggered_by_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_job_events" (
  "id" TEXT PRIMARY KEY,
  "sync_job_id" TEXT NOT NULL REFERENCES "sync_jobs"("id") ON DELETE CASCADE,
  "level" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_snapshots" (
  "id" TEXT PRIMARY KEY,
  "sync_job_id" TEXT NOT NULL REFERENCES "sync_jobs"("id") ON DELETE CASCADE,
  "entity_type" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_external_id" TEXT,
  "snapshot_payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sync_diffs" (
  "id" TEXT PRIMARY KEY,
  "sync_job_id" TEXT NOT NULL REFERENCES "sync_jobs"("id") ON DELETE CASCADE,
  "entity_type" TEXT NOT NULL,
  "entity_external_id" TEXT,
  "change_type" TEXT NOT NULL,
  "before_payload" JSONB,
  "after_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "department_memberships_department_id_created_at_idx" ON "department_memberships"("department_id", "created_at");
CREATE INDEX "departments_parent_department_id_idx" ON "departments"("parent_department_id");
CREATE INDEX "sync_jobs_status_created_at_idx" ON "sync_jobs"("status", "created_at");
CREATE INDEX "sync_jobs_scope_type_scope_external_id_idx" ON "sync_jobs"("scope_type", "scope_external_id");
CREATE INDEX "sync_job_events_sync_job_id_created_at_idx" ON "sync_job_events"("sync_job_id", "created_at");
CREATE INDEX "sync_snapshots_sync_job_id_entity_type_idx" ON "sync_snapshots"("sync_job_id", "entity_type");
CREATE INDEX "sync_diffs_sync_job_id_entity_type_idx" ON "sync_diffs"("sync_job_id", "entity_type");

ALTER TABLE "department_memberships"
  ADD CONSTRAINT "department_memberships_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
