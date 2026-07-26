CREATE TABLE "user_workspaces" (
  "id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "organization_id" TEXT,
  "security_domain_id" TEXT,
  "owner_user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '我的工作区',
  "status" TEXT NOT NULL DEFAULT 'active',
  "storage_root_key" TEXT NOT NULL,
  "quota_bytes" BIGINT NOT NULL DEFAULT 10737418240,
  "used_bytes" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_nodes" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "system_key" TEXT,
  "storage_key" TEXT,
  "mime_type" TEXT,
  "size_bytes" BIGINT,
  "checksum" TEXT,
  "state" TEXT NOT NULL DEFAULT 'active',
  "trashed_at" TIMESTAMP(3),
  "original_parent_id" TEXT,
  "created_by_type" TEXT NOT NULL DEFAULT 'user',
  "created_by_user_id" TEXT,
  "source_thread_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_file_versions" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "file_id" TEXT NOT NULL,
  "version_no" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" BIGINT NOT NULL,
  "checksum" TEXT NOT NULL,
  "created_by_type" TEXT NOT NULL DEFAULT 'user',
  "created_by_user_id" TEXT,
  "created_by_thread_id" TEXT,
  "change_type" TEXT NOT NULL DEFAULT 'create',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_file_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "thread_file_bindings" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "file_id" TEXT NOT NULL,
  "version_id" TEXT,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "thread_file_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_change_sets" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "thread_id" TEXT,
  "run_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "summary" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMP(3),
  "reverted_at" TIMESTAMP(3),
  CONSTRAINT "workspace_change_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_changes" (
  "id" TEXT NOT NULL,
  "change_set_id" TEXT NOT NULL,
  "file_id" TEXT,
  "kind" TEXT NOT NULL,
  "before_version_id" TEXT,
  "after_version_id" TEXT,
  "before_parent_id" TEXT,
  "after_parent_id" TEXT,
  "risk_level" TEXT NOT NULL DEFAULT 'low',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_changes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "threads" ADD COLUMN "user_workspace_id" TEXT;
ALTER TABLE "threads" ADD COLUMN "workspace_folder_id" TEXT;
ALTER TABLE "thread_artifacts" ADD COLUMN "workspace_file_id" TEXT;
ALTER TABLE "thread_artifacts" ADD COLUMN "workspace_file_version_id" TEXT;

CREATE UNIQUE INDEX "user_workspaces_scope_key_key" ON "user_workspaces"("scope_key");
CREATE INDEX "user_workspaces_organization_id_owner_user_id_idx" ON "user_workspaces"("organization_id", "owner_user_id");
CREATE INDEX "user_workspaces_security_domain_id_owner_user_id_idx" ON "user_workspaces"("security_domain_id", "owner_user_id");
CREATE INDEX "user_workspaces_owner_user_id_status_idx" ON "user_workspaces"("owner_user_id", "status");

CREATE UNIQUE INDEX "workspace_nodes_workspace_id_system_key_key" ON "workspace_nodes"("workspace_id", "system_key");
CREATE INDEX "workspace_nodes_workspace_id_parent_id_state_name_idx" ON "workspace_nodes"("workspace_id", "parent_id", "state", "name");
CREATE INDEX "workspace_nodes_workspace_id_kind_updated_at_idx" ON "workspace_nodes"("workspace_id", "kind", "updated_at");
CREATE INDEX "workspace_nodes_source_thread_id_idx" ON "workspace_nodes"("source_thread_id");

CREATE UNIQUE INDEX "workspace_file_versions_file_id_version_no_key" ON "workspace_file_versions"("file_id", "version_no");
CREATE INDEX "workspace_file_versions_workspace_id_created_at_idx" ON "workspace_file_versions"("workspace_id", "created_at");
CREATE INDEX "workspace_file_versions_created_by_thread_id_created_at_idx" ON "workspace_file_versions"("created_by_thread_id", "created_at");

CREATE UNIQUE INDEX "thread_file_bindings_thread_id_file_id_version_id_role_key" ON "thread_file_bindings"("thread_id", "file_id", "version_id", "role");
CREATE INDEX "thread_file_bindings_thread_id_role_created_at_idx" ON "thread_file_bindings"("thread_id", "role", "created_at");
CREATE INDEX "thread_file_bindings_file_id_created_at_idx" ON "thread_file_bindings"("file_id", "created_at");

CREATE INDEX "workspace_change_sets_workspace_id_created_at_idx" ON "workspace_change_sets"("workspace_id", "created_at");
CREATE INDEX "workspace_change_sets_thread_id_created_at_idx" ON "workspace_change_sets"("thread_id", "created_at");
CREATE INDEX "workspace_changes_change_set_id_created_at_idx" ON "workspace_changes"("change_set_id", "created_at");
CREATE INDEX "workspace_changes_file_id_created_at_idx" ON "workspace_changes"("file_id", "created_at");

CREATE INDEX "threads_user_workspace_id_workspace_folder_id_updated_at_idx" ON "threads"("user_workspace_id", "workspace_folder_id", "updated_at");
CREATE INDEX "threads_workspace_folder_id_status_updated_at_idx" ON "threads"("workspace_folder_id", "status", "updated_at");
CREATE INDEX "thread_artifacts_workspace_file_id_created_at_idx" ON "thread_artifacts"("workspace_file_id", "created_at");

ALTER TABLE "user_workspaces"
  ADD CONSTRAINT "user_workspaces_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_workspaces"
  ADD CONSTRAINT "user_workspaces_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_workspaces"
  ADD CONSTRAINT "user_workspaces_security_domain_id_fkey"
  FOREIGN KEY ("security_domain_id") REFERENCES "security_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_nodes"
  ADD CONSTRAINT "workspace_nodes_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "user_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_nodes"
  ADD CONSTRAINT "workspace_nodes_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_nodes"
  ADD CONSTRAINT "workspace_nodes_original_parent_id_fkey"
  FOREIGN KEY ("original_parent_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_nodes"
  ADD CONSTRAINT "workspace_nodes_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_nodes"
  ADD CONSTRAINT "workspace_nodes_source_thread_id_fkey"
  FOREIGN KEY ("source_thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_file_versions"
  ADD CONSTRAINT "workspace_file_versions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "user_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_file_versions"
  ADD CONSTRAINT "workspace_file_versions_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "workspace_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_file_versions"
  ADD CONSTRAINT "workspace_file_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_file_versions"
  ADD CONSTRAINT "workspace_file_versions_created_by_thread_id_fkey"
  FOREIGN KEY ("created_by_thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "threads"
  ADD CONSTRAINT "threads_user_workspace_id_fkey"
  FOREIGN KEY ("user_workspace_id") REFERENCES "user_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "threads"
  ADD CONSTRAINT "threads_workspace_folder_id_fkey"
  FOREIGN KEY ("workspace_folder_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "thread_file_bindings"
  ADD CONSTRAINT "thread_file_bindings_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_file_bindings"
  ADD CONSTRAINT "thread_file_bindings_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "workspace_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_file_bindings"
  ADD CONSTRAINT "thread_file_bindings_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "workspace_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "thread_artifacts"
  ADD CONSTRAINT "thread_artifacts_workspace_file_id_fkey"
  FOREIGN KEY ("workspace_file_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_artifacts"
  ADD CONSTRAINT "thread_artifacts_workspace_file_version_id_fkey"
  FOREIGN KEY ("workspace_file_version_id") REFERENCES "workspace_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_change_sets"
  ADD CONSTRAINT "workspace_change_sets_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "user_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_change_sets"
  ADD CONSTRAINT "workspace_change_sets_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workspace_changes"
  ADD CONSTRAINT "workspace_changes_change_set_id_fkey"
  FOREIGN KEY ("change_set_id") REFERENCES "workspace_change_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_changes"
  ADD CONSTRAINT "workspace_changes_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_changes"
  ADD CONSTRAINT "workspace_changes_before_version_id_fkey"
  FOREIGN KEY ("before_version_id") REFERENCES "workspace_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_changes"
  ADD CONSTRAINT "workspace_changes_after_version_id_fkey"
  FOREIGN KEY ("after_version_id") REFERENCES "workspace_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_changes"
  ADD CONSTRAINT "workspace_changes_before_parent_id_fkey"
  FOREIGN KEY ("before_parent_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_changes"
  ADD CONSTRAINT "workspace_changes_after_parent_id_fkey"
  FOREIGN KEY ("after_parent_id") REFERENCES "workspace_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "user_workspaces" (
  "id",
  "scope_key",
  "organization_id",
  "security_domain_id",
  "owner_user_id",
  "storage_root_key",
  "created_at",
  "updated_at"
)
SELECT
  'uw_' || md5(
    COALESCE(t."organization_id", '_') || ':' ||
    COALESCE(t."security_domain_id", '_') || ':' ||
    t."user_id"
  ),
  COALESCE(t."organization_id", '_') || ':' ||
    COALESCE(t."security_domain_id", '_') || ':' ||
    t."user_id",
  t."organization_id",
  t."security_domain_id",
  t."user_id",
  'user-workspaces/' || md5(
    COALESCE(t."organization_id", '_') || ':' ||
    COALESCE(t."security_domain_id", '_') || ':' ||
    t."user_id"
  ),
  MIN(t."created_at"),
  CURRENT_TIMESTAMP
FROM "threads" t
WHERE t."user_id" IS NOT NULL
GROUP BY t."organization_id", t."security_domain_id", t."user_id"
ON CONFLICT ("scope_key") DO NOTHING;

INSERT INTO "workspace_nodes" (
  "id",
  "workspace_id",
  "kind",
  "name",
  "normalized_name",
  "system_key",
  "created_by_type",
  "created_at",
  "updated_at"
)
SELECT
  'wn_' || md5(uw."id" || ':history_unfiled'),
  uw."id",
  'folder',
  '未整理的历史任务',
  '未整理的历史任务',
  'history_unfiled',
  'migration',
  uw."created_at",
  CURRENT_TIMESTAMP
FROM "user_workspaces" uw
ON CONFLICT ("workspace_id", "system_key") DO NOTHING;

UPDATE "threads" t
SET
  "user_workspace_id" = uw."id",
  "workspace_folder_id" = history."id"
FROM "user_workspaces" uw
JOIN "workspace_nodes" history
  ON history."workspace_id" = uw."id"
 AND history."system_key" = 'history_unfiled'
WHERE t."user_id" IS NOT NULL
  AND uw."scope_key" =
    COALESCE(t."organization_id", '_') || ':' ||
    COALESCE(t."security_domain_id", '_') || ':' ||
    t."user_id"
  AND t."user_workspace_id" IS NULL;
