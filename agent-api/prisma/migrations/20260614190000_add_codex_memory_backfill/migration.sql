CREATE TABLE IF NOT EXISTS "codex_memory_backfill_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "name" TEXT,
    "requested_by_user_id" TEXT,
    "filters" JSONB NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "processed_items" INTEGER NOT NULL DEFAULT 0,
    "written_items" INTEGER NOT NULL DEFAULT 0,
    "skipped_no_durable_items" INTEGER NOT NULL DEFAULT 0,
    "skipped_missing_input_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "already_processed_items" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codex_memory_backfill_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "codex_memory_backfill_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_message_id" TEXT NOT NULL,
    "assistant_message_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "user_id" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "codex_home" TEXT,
    "relative_home" TEXT,
    "codex_thread_id" TEXT,
    "session_id" TEXT,
    "model" TEXT,
    "prompt_chars" INTEGER NOT NULL DEFAULT 0,
    "answer_chars" INTEGER NOT NULL DEFAULT 0,
    "has_external_context" BOOLEAN NOT NULL DEFAULT false,
    "memory_run_log_id" TEXT,
    "error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codex_memory_backfill_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "codex_memory_backfill_runs_status_created_at_idx"
    ON "codex_memory_backfill_runs"("status", "created_at");

CREATE INDEX IF NOT EXISTS "codex_memory_backfill_runs_created_at_idx"
    ON "codex_memory_backfill_runs"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "codex_memory_backfill_items_user_message_id_assistant_message_id_key"
    ON "codex_memory_backfill_items"("user_message_id", "assistant_message_id");

CREATE INDEX IF NOT EXISTS "codex_memory_backfill_items_run_id_status_idx"
    ON "codex_memory_backfill_items"("run_id", "status");

CREATE INDEX IF NOT EXISTS "codex_memory_backfill_items_thread_id_idx"
    ON "codex_memory_backfill_items"("thread_id");

CREATE INDEX IF NOT EXISTS "codex_memory_backfill_items_channel_status_idx"
    ON "codex_memory_backfill_items"("channel", "status");

ALTER TABLE "codex_memory_backfill_items"
    ADD CONSTRAINT "codex_memory_backfill_items_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "codex_memory_backfill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
