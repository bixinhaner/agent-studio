CREATE TABLE "ai_response_reviews" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'zendesk',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "organization_id" TEXT,
  "integration_instance_id" TEXT,
  "thread_id" TEXT,
  "assistant_message_external_id" TEXT,
  "zendesk_run_id" TEXT,
  "ticket_id" TEXT,
  "ticket_subject" TEXT,
  "ticket_url" TEXT,
  "zendesk_comment_id" BIGINT,
  "zendesk_requester_comment_id" BIGINT,
  "reviewer_user_id" TEXT,
  "reviewer_dingtalk_user_id" TEXT,
  "reviewer_display_name" TEXT,
  "reviewer_email" TEXT,
  "score" INTEGER,
  "suggestion" TEXT,
  "submitted_by_user_id" TEXT,
  "submitted_at" TIMESTAMP(3),
  "due_at" TIMESTAMP(3),
  "notification_status" TEXT,
  "notification_error" TEXT,
  "notified_at" TIMESTAMP(3),
  "reminder_count" INTEGER NOT NULL DEFAULT 0,
  "last_reminded_at" TIMESTAMP(3),
  "review_url" TEXT,
  "snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_response_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_response_reviews_zendesk_run_id_reviewer_dingtalk_user_id_key"
  ON "ai_response_reviews"("zendesk_run_id", "reviewer_dingtalk_user_id");

CREATE INDEX "ai_response_reviews_source_status_created_at_idx"
  ON "ai_response_reviews"("source", "status", "created_at");

CREATE INDEX "ai_response_reviews_integration_instance_id_created_at_idx"
  ON "ai_response_reviews"("integration_instance_id", "created_at");

CREATE INDEX "ai_response_reviews_thread_id_created_at_idx"
  ON "ai_response_reviews"("thread_id", "created_at");

CREATE INDEX "ai_response_reviews_zendesk_run_id_idx"
  ON "ai_response_reviews"("zendesk_run_id");

CREATE INDEX "ai_response_reviews_ticket_id_created_at_idx"
  ON "ai_response_reviews"("ticket_id", "created_at");

CREATE INDEX "ai_response_reviews_reviewer_user_id_status_created_at_idx"
  ON "ai_response_reviews"("reviewer_user_id", "status", "created_at");

CREATE INDEX "ai_response_reviews_reviewer_dingtalk_user_id_status_created_at_idx"
  ON "ai_response_reviews"("reviewer_dingtalk_user_id", "status", "created_at");

CREATE INDEX "ai_response_reviews_due_at_idx"
  ON "ai_response_reviews"("due_at");
