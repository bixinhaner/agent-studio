ALTER TABLE "ai_response_reviews"
  ADD COLUMN "dingtalk_todo_status" TEXT,
  ADD COLUMN "dingtalk_todo_task_id" TEXT,
  ADD COLUMN "dingtalk_todo_union_id" TEXT,
  ADD COLUMN "dingtalk_todo_source_id" TEXT,
  ADD COLUMN "dingtalk_todo_error" TEXT,
  ADD COLUMN "dingtalk_todo_created_at" TIMESTAMP(3),
  ADD COLUMN "dingtalk_todo_completed_at" TIMESTAMP(3);

CREATE INDEX "ai_response_reviews_dingtalk_todo_status_created_at_idx"
  ON "ai_response_reviews"("dingtalk_todo_status", "created_at");

CREATE INDEX "ai_response_reviews_dingtalk_todo_source_id_idx"
  ON "ai_response_reviews"("dingtalk_todo_source_id");
