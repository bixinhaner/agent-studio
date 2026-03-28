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
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "knowledge_set_items" (
  "id" TEXT PRIMARY KEY,
  "knowledge_set_id" TEXT NOT NULL REFERENCES "knowledge_sets"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "relative_path" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" BIGINT,
  "checksum" TEXT,
  "source_archive_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("knowledge_set_id", "relative_path")
);

-- CreateTable
CREATE TABLE "workspace_knowledge_sets" (
  "id" TEXT PRIMARY KEY,
  "workspace_id" TEXT NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "knowledge_set_id" TEXT NOT NULL REFERENCES "knowledge_sets"("id") ON DELETE CASCADE,
  "mount_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
