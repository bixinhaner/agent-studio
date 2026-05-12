CREATE TABLE "codex_managed_skills" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "skill_name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" TEXT NOT NULL DEFAULT '1.0.0',
  "published_path" TEXT NOT NULL,
  "source_draft_id" TEXT,
  "created_by_user_id" TEXT,
  "created_by_display_name" TEXT,
  "created_by_email" TEXT,
  "last_edited_by_user_id" TEXT,
  "reviewed_by_user_id" TEXT,
  "reviewed_by_display_name" TEXT,
  "published_by_user_id" TEXT,
  "published_by_display_name" TEXT,
  "metadata" JSONB,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "codex_managed_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "codex_skill_drafts" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "created_by_user_id" TEXT NOT NULL,
  "created_by_display_name" TEXT,
  "created_by_email" TEXT,
  "source_thread_id" TEXT,
  "source_managed_skill_id" TEXT,
  "requested_prompt" TEXT NOT NULL,
  "skill_name" TEXT,
  "slug" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "version" TEXT NOT NULL DEFAULT '1.0.0',
  "draft_path" TEXT NOT NULL,
  "published_path" TEXT,
  "validation" JSONB,
  "review_note" TEXT,
  "reviewed_by_user_id" TEXT,
  "reviewed_by_display_name" TEXT,
  "published_by_user_id" TEXT,
  "published_by_display_name" TEXT,
  "published_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "codex_skill_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "codex_managed_skills_org_skill_name_key" ON "codex_managed_skills" ("organization_id", "skill_name");
CREATE INDEX "codex_managed_skills_org_status_idx" ON "codex_managed_skills" ("organization_id", "status");
CREATE INDEX "codex_managed_skills_author_created_idx" ON "codex_managed_skills" ("created_by_user_id", "created_at");
CREATE INDEX "codex_skill_drafts_org_status_created_idx" ON "codex_skill_drafts" ("organization_id", "status", "created_at");
CREATE INDEX "codex_skill_drafts_author_created_idx" ON "codex_skill_drafts" ("created_by_user_id", "created_at");
CREATE INDEX "codex_skill_drafts_skill_name_idx" ON "codex_skill_drafts" ("skill_name");
