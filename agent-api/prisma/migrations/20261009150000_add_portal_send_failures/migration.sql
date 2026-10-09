-- Records portal sends that never produced a saved user message, so empty conversations
-- in the admin console show why they are empty. New table only: older releases ignore it.
CREATE TABLE "portal_send_failures" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT,
    "organization_id" TEXT,
    "user_id" TEXT,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "error_code" TEXT,
    "http_status" INTEGER,
    "detail" TEXT,
    "message_preview" TEXT,
    "attachments" JSONB,
    "client_run_id" TEXT,
    "build_id" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_send_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portal_send_failures_thread_id_created_at_idx" ON "portal_send_failures"("thread_id", "created_at");
CREATE INDEX "portal_send_failures_created_at_idx" ON "portal_send_failures"("created_at");
