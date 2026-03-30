-- CreateTable
CREATE TABLE "thread_shares" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "permission_level" TEXT NOT NULL DEFAULT 'read_comment',
  "shared_by_user_id" TEXT,
  "revoked_by_user_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "thread_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_comments" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "author_user_id" TEXT,
  "body_markdown" TEXT NOT NULL,
  "mentioned_user_ids" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "thread_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_assignments" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "assigned_by_user_id" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "thread_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_followers" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "added_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "thread_followers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_items" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unread',
  "thread_id" TEXT,
  "related_entity_type" TEXT,
  "related_entity_id" TEXT,
  "source_actor_user_id" TEXT,
  "payload" JSONB,
  "read_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_messages" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body_markdown" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by_user_id" TEXT,
  "published_at" TIMESTAMP(3),
  "published_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "broadcast_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_targets" (
  "id" TEXT NOT NULL,
  "broadcast_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "broadcast_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_capture_marks" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_capture',
  "marked_by_user_id" TEXT,
  "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "knowledge_capture_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thread_shares_thread_id_created_at_idx" ON "thread_shares"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_shares_thread_id_subject_type_subject_id_idx" ON "thread_shares"("thread_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "thread_shares_subject_type_subject_id_idx" ON "thread_shares"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "thread_shares_shared_by_user_id_created_at_idx" ON "thread_shares"("shared_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_shares_revoked_by_user_id_created_at_idx" ON "thread_shares"("revoked_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_comments_thread_id_created_at_idx" ON "thread_comments"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_comments_author_user_id_created_at_idx" ON "thread_comments"("author_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "thread_assignments_thread_id_key" ON "thread_assignments"("thread_id");

-- CreateIndex
CREATE INDEX "thread_assignments_owner_user_id_assigned_at_idx" ON "thread_assignments"("owner_user_id", "assigned_at");

-- CreateIndex
CREATE INDEX "thread_assignments_assigned_by_user_id_assigned_at_idx" ON "thread_assignments"("assigned_by_user_id", "assigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "thread_followers_thread_id_user_id_key" ON "thread_followers"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "thread_followers_thread_id_created_at_idx" ON "thread_followers"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_followers_user_id_created_at_idx" ON "thread_followers"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "thread_followers_added_by_user_id_created_at_idx" ON "thread_followers"("added_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "inbox_items_user_id_status_created_at_idx" ON "inbox_items"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "inbox_items_user_id_category_created_at_idx" ON "inbox_items"("user_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "inbox_items_thread_id_created_at_idx" ON "inbox_items"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "inbox_items_related_entity_type_related_entity_id_idx" ON "inbox_items"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "inbox_items_event_type_created_at_idx" ON "inbox_items"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "broadcast_messages_status_created_at_idx" ON "broadcast_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "broadcast_messages_published_at_idx" ON "broadcast_messages"("published_at");

-- CreateIndex
CREATE INDEX "broadcast_messages_created_by_user_id_created_at_idx" ON "broadcast_messages"("created_by_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_targets_broadcast_id_target_type_target_id_key" ON "broadcast_targets"("broadcast_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "broadcast_targets_broadcast_id_idx" ON "broadcast_targets"("broadcast_id");

-- CreateIndex
CREATE INDEX "broadcast_targets_target_type_target_id_idx" ON "broadcast_targets"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_capture_marks_thread_id_key" ON "knowledge_capture_marks"("thread_id");

-- CreateIndex
CREATE INDEX "knowledge_capture_marks_status_marked_at_idx" ON "knowledge_capture_marks"("status", "marked_at");

-- CreateIndex
CREATE INDEX "knowledge_capture_marks_marked_by_user_id_marked_at_idx" ON "knowledge_capture_marks"("marked_by_user_id", "marked_at");

-- CreateIndex
CREATE UNIQUE INDEX "thread_shares_thread_id_subject_type_subject_id_active_idx"
  ON "thread_shares"("thread_id", "subject_type", "subject_id")
  WHERE "revoked_at" IS NULL;

-- AddForeignKey
ALTER TABLE "thread_shares"
  ADD CONSTRAINT "thread_shares_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_shares"
  ADD CONSTRAINT "thread_shares_shared_by_user_id_fkey"
  FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_shares"
  ADD CONSTRAINT "thread_shares_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_comments"
  ADD CONSTRAINT "thread_comments_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_comments"
  ADD CONSTRAINT "thread_comments_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_assignments"
  ADD CONSTRAINT "thread_assignments_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_assignments"
  ADD CONSTRAINT "thread_assignments_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_assignments"
  ADD CONSTRAINT "thread_assignments_assigned_by_user_id_fkey"
  FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_followers"
  ADD CONSTRAINT "thread_followers_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_followers"
  ADD CONSTRAINT "thread_followers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_followers"
  ADD CONSTRAINT "thread_followers_added_by_user_id_fkey"
  FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items"
  ADD CONSTRAINT "inbox_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items"
  ADD CONSTRAINT "inbox_items_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items"
  ADD CONSTRAINT "inbox_items_source_actor_user_id_fkey"
  FOREIGN KEY ("source_actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_messages"
  ADD CONSTRAINT "broadcast_messages_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_messages"
  ADD CONSTRAINT "broadcast_messages_published_by_user_id_fkey"
  FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_targets"
  ADD CONSTRAINT "broadcast_targets_broadcast_id_fkey"
  FOREIGN KEY ("broadcast_id") REFERENCES "broadcast_messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_capture_marks"
  ADD CONSTRAINT "knowledge_capture_marks_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_capture_marks"
  ADD CONSTRAINT "knowledge_capture_marks_marked_by_user_id_fkey"
  FOREIGN KEY ("marked_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
