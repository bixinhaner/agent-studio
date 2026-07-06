CREATE TABLE "conversation_recovery_cases" (
  "id" TEXT NOT NULL,
  "recovery_key" TEXT NOT NULL,
  "organization_id" TEXT,
  "user_id" TEXT,
  "thread_id" TEXT,
  "source" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "audience" TEXT NOT NULL DEFAULT 'unknown',
  "status" TEXT NOT NULL DEFAULT 'open',
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "reason_code" TEXT NOT NULL DEFAULT 'runtime_error',
  "title" TEXT NOT NULL,
  "question_preview" TEXT,
  "failure_detail" TEXT,
  "root_cause" TEXT,
  "resolution_summary" TEXT,
  "recipient_email" TEXT,
  "email_subject" TEXT,
  "email_body_text" TEXT,
  "email_notification_id" TEXT,
  "compensation_plan_id" TEXT,
  "compensation_days" INTEGER,
  "compensation_order_id" TEXT,
  "compensation_grant_id" TEXT,
  "failure_count" INTEGER NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notified_at" TIMESTAMP(3),
  "compensated_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "conversation_recovery_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_recovery_cases_recovery_key_key" ON "conversation_recovery_cases"("recovery_key");
CREATE INDEX "conversation_recovery_cases_organization_id_status_created_at_idx" ON "conversation_recovery_cases"("organization_id", "status", "created_at");
CREATE INDEX "conversation_recovery_cases_user_id_created_at_idx" ON "conversation_recovery_cases"("user_id", "created_at");
CREATE INDEX "conversation_recovery_cases_thread_id_idx" ON "conversation_recovery_cases"("thread_id");
CREATE INDEX "conversation_recovery_cases_source_status_created_at_idx" ON "conversation_recovery_cases"("source", "status", "created_at");
CREATE INDEX "conversation_recovery_cases_channel_last_occurred_at_idx" ON "conversation_recovery_cases"("channel", "last_occurred_at");
