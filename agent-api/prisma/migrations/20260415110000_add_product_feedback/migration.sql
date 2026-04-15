-- CreateTable
CREATE TABLE "product_feedback" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "user_id" TEXT,
  "thread_id" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT,
  "description" TEXT NOT NULL,
  "context" JSONB,
  "status" TEXT NOT NULL DEFAULT 'open',
  "assignee_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_feedback_organization_id_created_at_idx"
  ON "product_feedback"("organization_id", "created_at");

CREATE INDEX "product_feedback_status_created_at_idx"
  ON "product_feedback"("status", "created_at");

CREATE INDEX "product_feedback_type_created_at_idx"
  ON "product_feedback"("type", "created_at");

CREATE INDEX "product_feedback_thread_id_idx"
  ON "product_feedback"("thread_id");

CREATE INDEX "product_feedback_user_id_created_at_idx"
  ON "product_feedback"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_assignee_user_id_fkey"
  FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
