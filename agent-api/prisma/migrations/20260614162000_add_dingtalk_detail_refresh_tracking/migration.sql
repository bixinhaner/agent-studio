ALTER TABLE "enterprise_user_profiles"
  ADD COLUMN "detail_attempted_at" TIMESTAMP(3),
  ADD COLUMN "detail_synced_at" TIMESTAMP(3),
  ADD COLUMN "detail_sync_status" TEXT;

CREATE INDEX "enterprise_user_profiles_detail_attempted_at_idx"
  ON "enterprise_user_profiles"("detail_attempted_at");
