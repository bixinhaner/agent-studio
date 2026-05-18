CREATE TABLE "thread_artifacts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT,
  "source" TEXT NOT NULL,
  "relative_path" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" BIGINT,
  "checksum" TEXT,
  "preview_status" TEXT NOT NULL DEFAULT 'ready',
  "download_status" TEXT NOT NULL DEFAULT 'ready',
  "blocked_reason" TEXT,
  "metadata" JSONB,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "thread_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thread_artifacts_thread_id_relative_path_key"
  ON "thread_artifacts" ("thread_id", "relative_path");
CREATE INDEX "thread_artifacts_organization_id_thread_id_created_at_idx"
  ON "thread_artifacts" ("organization_id", "thread_id", "created_at");
CREATE INDEX "thread_artifacts_thread_id_created_at_idx"
  ON "thread_artifacts" ("thread_id", "created_at");
CREATE INDEX "thread_artifacts_user_id_created_at_idx"
  ON "thread_artifacts" ("user_id", "created_at");
CREATE INDEX "thread_artifacts_preview_status_download_status_idx"
  ON "thread_artifacts" ("preview_status", "download_status");

ALTER TABLE "thread_artifacts"
  ADD CONSTRAINT "thread_artifacts_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
