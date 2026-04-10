-- CreateTable
CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'customer',
  "status" TEXT NOT NULL DEFAULT 'active',
  "owner_user_id" TEXT,
  "settings_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "membership_type" TEXT NOT NULL DEFAULT 'customer_member',
  "status" TEXT NOT NULL DEFAULT 'active',
  "display_name_override" TEXT,
  "title" TEXT,
  "invited_by_user_id" TEXT,
  "joined_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_subject" TEXT NOT NULL,
  "email" TEXT,
  "email_verified_at" TIMESTAMP(3),
  "profile_json" JSONB,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invites" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "invite_token_hash" TEXT NOT NULL,
  "intended_provider" TEXT NOT NULL DEFAULT 'email_magic_link',
  "role_template" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "invited_by_user_id" TEXT,
  "accepted_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_challenges" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "target_ref" TEXT NOT NULL,
  "challenge_hash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "organization_id" TEXT,
  "invite_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_role_assignments" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role_id" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "organization_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_type_status_idx" ON "organizations"("type", "status");

CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key"
  ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_status_idx"
  ON "organization_memberships"("user_id", "status");
CREATE INDEX "organization_memberships_organization_id_status_idx"
  ON "organization_memberships"("organization_id", "status");

CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key"
  ON "auth_identities"("provider", "provider_subject");
CREATE INDEX "auth_identities_user_id_provider_idx"
  ON "auth_identities"("user_id", "provider");
CREATE INDEX "auth_identities_email_idx"
  ON "auth_identities"("email");

CREATE INDEX "organization_invites_organization_id_status_idx"
  ON "organization_invites"("organization_id", "status");
CREATE INDEX "organization_invites_email_status_idx"
  ON "organization_invites"("email", "status");

CREATE INDEX "login_challenges_target_ref_purpose_expires_at_idx"
  ON "login_challenges"("target_ref", "purpose", "expires_at");
CREATE INDEX "login_challenges_organization_id_purpose_idx"
  ON "login_challenges"("organization_id", "purpose");

CREATE UNIQUE INDEX "organization_role_assignments_organization_id_user_id_role_id_key"
  ON "organization_role_assignments"("organization_id", "user_id", "role_id");
CREATE INDEX "organization_role_assignments_organization_id_user_id_is_primary_idx"
  ON "organization_role_assignments"("organization_id", "user_id", "is_primary");
CREATE INDEX "organization_role_assignments_role_id_idx"
  ON "organization_role_assignments"("role_id");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "user_type" TEXT NOT NULL DEFAULT 'internal_employee';
ALTER TABLE "users" ADD COLUMN "primary_organization_id" TEXT;

ALTER TABLE "threads" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "runtime_sessions" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "thread_shares" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "thread_comments" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "thread_public_shares" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "thread_assignments" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "thread_followers" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "inbox_items" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "knowledge_capture_marks" ADD COLUMN "organization_id" TEXT;

-- Seed internal organization and backfill ownership
INSERT INTO "organizations" (
  "id",
  "slug",
  "name",
  "type",
  "status",
  "created_at",
  "updated_at"
)
VALUES (
  'org_internal',
  'internal',
  'Internal Organization',
  'internal',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

UPDATE "users"
SET "primary_organization_id" = COALESCE("primary_organization_id", 'org_internal')
WHERE "primary_organization_id" IS NULL;

INSERT INTO "organization_memberships" (
  "id",
  "organization_id",
  "user_id",
  "membership_type",
  "status",
  "joined_at",
  "created_at",
  "updated_at"
)
SELECT
  'membership_' || "id",
  'org_internal',
  "id",
  'employee',
  'active',
  "created_at",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

INSERT INTO "auth_identities" (
  "id",
  "user_id",
  "provider",
  "provider_subject",
  "email",
  "email_verified_at",
  "profile_json",
  "last_login_at",
  "created_at",
  "updated_at"
)
SELECT
  'auth_identity_' || "id",
  "id",
  'dingtalk',
  COALESCE(NULLIF("external_id", ''), NULLIF("dingtalk_user_id", ''), NULLIF("dingtalk_open_id", '')),
  NULLIF(LOWER("email"), ''),
  CASE WHEN NULLIF("email", '') IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
  jsonb_strip_nulls(
    jsonb_build_object(
      'external_id', "external_id",
      'dingtalk_user_id', "dingtalk_user_id",
      'dingtalk_open_id', "dingtalk_open_id",
      'dingtalk_corp_id', "dingtalk_corp_id"
    )
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users"
WHERE COALESCE(NULLIF("external_id", ''), NULLIF("dingtalk_user_id", ''), NULLIF("dingtalk_open_id", '')) IS NOT NULL
ON CONFLICT ("provider", "provider_subject") DO NOTHING;

UPDATE "threads"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "runtime_sessions"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "thread_shares"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "thread_comments"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "thread_public_shares"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "thread_assignments"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "thread_followers"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "inbox_items"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

UPDATE "knowledge_capture_marks"
SET "organization_id" = COALESCE("organization_id", 'org_internal')
WHERE "organization_id" IS NULL;

-- CreateIndex
CREATE INDEX "users_primary_organization_id_idx" ON "users"("primary_organization_id");

CREATE INDEX "threads_organization_id_created_at_idx"
  ON "threads"("organization_id", "created_at");
CREATE INDEX "threads_organization_id_user_id_created_at_idx"
  ON "threads"("organization_id", "user_id", "created_at");

CREATE INDEX "runtime_sessions_organization_id_created_at_idx"
  ON "runtime_sessions"("organization_id", "created_at");
CREATE INDEX "runtime_sessions_organization_id_user_id_created_at_idx"
  ON "runtime_sessions"("organization_id", "user_id", "created_at");

CREATE INDEX "thread_shares_organization_id_created_at_idx"
  ON "thread_shares"("organization_id", "created_at");
CREATE INDEX "thread_comments_organization_id_created_at_idx"
  ON "thread_comments"("organization_id", "created_at");
CREATE INDEX "thread_public_shares_organization_id_created_at_idx"
  ON "thread_public_shares"("organization_id", "created_at");
CREATE INDEX "thread_assignments_organization_id_assigned_at_idx"
  ON "thread_assignments"("organization_id", "assigned_at");
CREATE INDEX "thread_followers_organization_id_created_at_idx"
  ON "thread_followers"("organization_id", "created_at");
CREATE INDEX "inbox_items_organization_id_user_id_status_created_at_idx"
  ON "inbox_items"("organization_id", "user_id", "status", "created_at");
CREATE INDEX "knowledge_capture_marks_organization_id_status_marked_at_idx"
  ON "knowledge_capture_marks"("organization_id", "status", "marked_at");

-- AddForeignKey
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_primary_organization_id_fkey"
  FOREIGN KEY ("primary_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_invited_by_user_id_fkey"
  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "auth_identities"
  ADD CONSTRAINT "auth_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invites"
  ADD CONSTRAINT "organization_invites_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_invites"
  ADD CONSTRAINT "organization_invites_invited_by_user_id_fkey"
  FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_invites"
  ADD CONSTRAINT "organization_invites_accepted_by_user_id_fkey"
  FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "login_challenges"
  ADD CONSTRAINT "login_challenges_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "login_challenges"
  ADD CONSTRAINT "login_challenges_invite_id_fkey"
  FOREIGN KEY ("invite_id") REFERENCES "organization_invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_role_assignments"
  ADD CONSTRAINT "organization_role_assignments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_role_assignments"
  ADD CONSTRAINT "organization_role_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_role_assignments"
  ADD CONSTRAINT "organization_role_assignments_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "threads"
  ADD CONSTRAINT "threads_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "runtime_sessions"
  ADD CONSTRAINT "runtime_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_shares"
  ADD CONSTRAINT "thread_shares_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_comments"
  ADD CONSTRAINT "thread_comments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_public_shares"
  ADD CONSTRAINT "thread_public_shares_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_assignments"
  ADD CONSTRAINT "thread_assignments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "thread_followers"
  ADD CONSTRAINT "thread_followers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inbox_items"
  ADD CONSTRAINT "inbox_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_capture_marks"
  ADD CONSTRAINT "knowledge_capture_marks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
