-- CreateTable
CREATE TABLE "workspaces" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source_type" TEXT NOT NULL,
  "root_path" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "knowledge_sets" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source_type" TEXT NOT NULL,
  "root_path" TEXT,
  "storage_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "knowledge_set_items" (
  "id" TEXT PRIMARY KEY,
  "knowledge_set_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "relative_path" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" BIGINT,
  "checksum" TEXT,
  "source_archive_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("knowledge_set_id", "relative_path")
);

-- CreateIndex
CREATE INDEX "knowledge_set_items_knowledge_set_id_relative_path_idx" ON "knowledge_set_items"("knowledge_set_id", "relative_path");

-- CreateTable
CREATE TABLE "workspace_knowledge_sets" (
  "id" TEXT PRIMARY KEY,
  "workspace_id" TEXT NOT NULL,
  "knowledge_set_id" TEXT NOT NULL,
  "mount_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("workspace_id", "knowledge_set_id")
);

-- CreateTable
CREATE TABLE "resource_policies" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "effect" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "resource_policies_subject_type_subject_id_idx" ON "resource_policies"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "resource_policies_resource_type_resource_id_idx" ON "resource_policies"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "knowledge_set_items" ADD CONSTRAINT "knowledge_set_items_knowledge_set_id_fkey" FOREIGN KEY ("knowledge_set_id") REFERENCES "knowledge_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_knowledge_sets" ADD CONSTRAINT "workspace_knowledge_sets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_knowledge_sets" ADD CONSTRAINT "workspace_knowledge_sets_knowledge_set_id_fkey" FOREIGN KEY ("knowledge_set_id") REFERENCES "knowledge_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
