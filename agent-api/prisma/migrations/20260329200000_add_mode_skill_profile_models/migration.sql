-- CreateTable
CREATE TABLE "run_profiles" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "default_model" TEXT NOT NULL,
  "allowed_models" JSONB NOT NULL,
  "default_reasoning_effort" TEXT NOT NULL,
  "sandbox_mode" TEXT NOT NULL,
  "approval_policy" TEXT NOT NULL,
  "network_access_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "web_search_mode" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "skill_packages" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "visible_to_users" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "skill_package_items" (
  "id" TEXT PRIMARY KEY,
  "skill_package_id" TEXT NOT NULL,
  "capability_key" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "run_profiles_slug_key" ON "run_profiles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "skill_packages_slug_key" ON "skill_packages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "skill_package_items_skill_package_id_capability_key_key"
  ON "skill_package_items"("skill_package_id", "capability_key");

-- CreateTable
CREATE TABLE "skill_package_runtime_bindings" (
  "id" TEXT PRIMARY KEY,
  "skill_package_item_id" TEXT NOT NULL,
  "runtime_type" TEXT NOT NULL,
  "binding_type" TEXT NOT NULL,
  "binding_payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "skill_package_runtime_bindings_skill_package_item_id_idx" ON "skill_package_runtime_bindings"("skill_package_item_id");

-- CreateTable
CREATE TABLE "agent_modes" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "visible_to_users" BOOLEAN NOT NULL DEFAULT TRUE,
  "run_profile_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_modes_slug_key" ON "agent_modes"("slug");

-- CreateIndex
CREATE INDEX "agent_modes_run_profile_id_idx" ON "agent_modes"("run_profile_id");

-- CreateTable
CREATE TABLE "agent_mode_skill_packages" (
  "id" TEXT PRIMARY KEY,
  "agent_mode_id" TEXT NOT NULL,
  "skill_package_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_mode_skill_packages_agent_mode_id_skill_package_id_key"
  ON "agent_mode_skill_packages"("agent_mode_id", "skill_package_id");

-- CreateIndex
CREATE INDEX "agent_mode_skill_packages_skill_package_id_idx" ON "agent_mode_skill_packages"("skill_package_id");

-- CreateTable
CREATE TABLE "agent_mode_workspaces" (
  "id" TEXT PRIMARY KEY,
  "agent_mode_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "allow_directory_selection" BOOLEAN NOT NULL DEFAULT FALSE,
  "directory_scope" TEXT NOT NULL,
  "load_workspace_agents_md" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_mode_workspaces_agent_mode_id_workspace_id_key"
  ON "agent_mode_workspaces"("agent_mode_id", "workspace_id");

-- CreateIndex
CREATE INDEX "agent_mode_workspaces_workspace_id_idx" ON "agent_mode_workspaces"("workspace_id");

-- CreateTable
CREATE TABLE "agent_mode_instruction_sources" (
  "id" TEXT PRIMARY KEY,
  "agent_mode_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "agent_mode_instruction_sources_agent_mode_id_idx" ON "agent_mode_instruction_sources"("agent_mode_id");

-- AddForeignKey
ALTER TABLE "skill_package_items" ADD CONSTRAINT "skill_package_items_skill_package_id_fkey" FOREIGN KEY ("skill_package_id") REFERENCES "skill_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_package_runtime_bindings" ADD CONSTRAINT "skill_package_runtime_bindings_skill_package_item_id_fkey" FOREIGN KEY ("skill_package_item_id") REFERENCES "skill_package_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_modes" ADD CONSTRAINT "agent_modes_run_profile_id_fkey" FOREIGN KEY ("run_profile_id") REFERENCES "run_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mode_skill_packages" ADD CONSTRAINT "agent_mode_skill_packages_agent_mode_id_fkey" FOREIGN KEY ("agent_mode_id") REFERENCES "agent_modes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mode_skill_packages" ADD CONSTRAINT "agent_mode_skill_packages_skill_package_id_fkey" FOREIGN KEY ("skill_package_id") REFERENCES "skill_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mode_workspaces" ADD CONSTRAINT "agent_mode_workspaces_agent_mode_id_fkey" FOREIGN KEY ("agent_mode_id") REFERENCES "agent_modes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mode_workspaces" ADD CONSTRAINT "agent_mode_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mode_instruction_sources" ADD CONSTRAINT "agent_mode_instruction_sources_agent_mode_id_fkey" FOREIGN KEY ("agent_mode_id") REFERENCES "agent_modes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
