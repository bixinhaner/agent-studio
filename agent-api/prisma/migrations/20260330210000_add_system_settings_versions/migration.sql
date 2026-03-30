-- CreateEnum
CREATE TYPE "SystemSettingsVersionStatus" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "system_settings_versions" (
  "id" TEXT PRIMARY KEY,
  "version_number" INTEGER NOT NULL,
  "status" "SystemSettingsVersionStatus" NOT NULL,
  "payload" JSONB NOT NULL,
  "published_at" TIMESTAMP(3),
  "published_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_versions_version_number_key" ON "system_settings_versions"("version_number");

-- CreateIndex
CREATE INDEX "system_settings_versions_status_version_number_idx" ON "system_settings_versions"("status", "version_number");

-- CreateIndex
CREATE INDEX "system_settings_versions_status_published_at_idx" ON "system_settings_versions"("status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_versions_single_draft_idx"
  ON "system_settings_versions"("status")
  WHERE "status" = 'draft';
