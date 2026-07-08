ALTER TABLE "broadcast_messages"
  ADD COLUMN "channel_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "channel_in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "content_json" JSONB,
  ADD COLUMN "audience_json" JSONB,
  ADD COLUMN "audience_snapshot_json" JSONB,
  ADD COLUMN "delivery_summary_json" JSONB,
  ADD COLUMN "last_tested_at" TIMESTAMP(3),
  ADD COLUMN "last_test_status" TEXT NOT NULL DEFAULT 'not_tested',
  ADD COLUMN "last_test_fingerprint" TEXT;

CREATE INDEX "broadcast_messages_last_test_status_idx"
  ON "broadcast_messages"("last_test_status");
