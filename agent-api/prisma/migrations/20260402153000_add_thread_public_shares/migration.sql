-- CreateTable
CREATE TABLE "thread_public_shares" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "selected_turn_count" INTEGER NOT NULL DEFAULT 1,
  "snapshot_json" JSONB NOT NULL,
  "created_by_user_id" TEXT,
  "revoked_by_user_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "thread_public_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thread_public_shares_token_key" ON "thread_public_shares"("token");
CREATE UNIQUE INDEX "thread_public_shares_active_thread_idx" ON "thread_public_shares"("thread_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "thread_public_shares_thread_id_created_at_idx" ON "thread_public_shares"("thread_id", "created_at");
CREATE INDEX "thread_public_shares_created_by_user_id_created_at_idx" ON "thread_public_shares"("created_by_user_id", "created_at");
CREATE INDEX "thread_public_shares_revoked_by_user_id_created_at_idx" ON "thread_public_shares"("revoked_by_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "thread_public_shares" ADD CONSTRAINT "thread_public_shares_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_public_shares" ADD CONSTRAINT "thread_public_shares_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_public_shares" ADD CONSTRAINT "thread_public_shares_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
