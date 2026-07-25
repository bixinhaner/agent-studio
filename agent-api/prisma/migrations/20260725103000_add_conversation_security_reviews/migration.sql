CREATE TABLE "conversation_security_reviews" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "user_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_message_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'portal',
    "audience" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "reviewer_provider" TEXT,
    "reviewer_model" TEXT,
    "risk_level" TEXT,
    "risk_score" INTEGER,
    "confidence" DOUBLE PRECISION,
    "categories" JSONB,
    "evidence_message_ids" JSONB,
    "reason" TEXT,
    "assistant_exposure" TEXT,
    "recommended_action" TEXT,
    "context_snapshot" JSONB,
    "result_json" JSONB,
    "error_message" TEXT,
    "alert_event_id" TEXT,
    "notified_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_security_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_security_reviews_thread_id_user_message_id_key"
ON "conversation_security_reviews"("thread_id", "user_message_id");

CREATE INDEX "conversation_security_reviews_status_next_attempt_at_idx"
ON "conversation_security_reviews"("status", "next_attempt_at");

CREATE INDEX "conversation_security_reviews_user_id_created_at_idx"
ON "conversation_security_reviews"("user_id", "created_at");

CREATE INDEX "conversation_security_reviews_thread_id_created_at_idx"
ON "conversation_security_reviews"("thread_id", "created_at");

CREATE INDEX "conversation_security_reviews_organization_id_risk_score_created_at_idx"
ON "conversation_security_reviews"("organization_id", "risk_score", "created_at");

CREATE INDEX "conversation_security_reviews_alert_event_id_idx"
ON "conversation_security_reviews"("alert_event_id");
