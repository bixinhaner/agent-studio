ALTER TABLE "codex_managed_skills"
  ADD COLUMN "owner_user_id" TEXT,
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'agent_mode',
  ADD COLUMN "checksum" TEXT;

UPDATE "codex_managed_skills"
SET "owner_user_id" = COALESCE("created_by_user_id", "published_by_user_id")
WHERE "owner_user_id" IS NULL;

DROP INDEX IF EXISTS "codex_managed_skills_org_skill_name_key";
CREATE UNIQUE INDEX "codex_managed_skills_org_owner_scope_skill_name_key"
  ON "codex_managed_skills" ("organization_id", "owner_user_id", "scope", "skill_name");
CREATE INDEX "codex_managed_skills_org_scope_status_idx"
  ON "codex_managed_skills" ("organization_id", "scope", "status");
CREATE INDEX "codex_managed_skills_org_skill_name_idx"
  ON "codex_managed_skills" ("organization_id", "skill_name");
