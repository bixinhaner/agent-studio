CREATE TABLE "public_brands" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'disabled',
  "primary_base_url" TEXT,
  "primary_color" TEXT NOT NULL DEFAULT '#0066FF',
  "accent_color" TEXT NOT NULL DEFAULT '#2CCFF0',
  "platform_name" TEXT NOT NULL,
  "header_subtitle" TEXT NOT NULL,
  "external_login_copy" TEXT NOT NULL,
  "logo_url" TEXT,
  "icon_url" TEXT,
  "login_background_url" TEXT,
  "portal_welcome_illustration_url" TEXT,
  "assistant_name" TEXT NOT NULL,
  "assistant_avatar_url" TEXT,
  "portal_welcome_message_desktop" TEXT NOT NULL,
  "portal_welcome_message_mobile" TEXT NOT NULL,
  "portal_welcome_suggestions" JSONB NOT NULL DEFAULT '[]',
  "answer_feedback_enabled" BOOLEAN NOT NULL DEFAULT true,
  "answer_feedback_prompt" TEXT NOT NULL DEFAULT 'Was this answer helpful?',
  "external_only" BOOLEAN NOT NULL DEFAULT true,
  "access_request_enabled" BOOLEAN NOT NULL DEFAULT true,
  "billing_enabled" BOOLEAN NOT NULL DEFAULT true,
  "billing_success_url" TEXT,
  "billing_cancel_url" TEXT,
  "billing_portal_url" TEXT,
  "agent_mode_id" TEXT,
  "knowledge_set_ids" JSONB NOT NULL DEFAULT '[]',
  "subscription_plan_ids" JSONB NOT NULL DEFAULT '[]',
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_brands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public_brand_domains" (
  "id" TEXT NOT NULL,
  "public_brand_id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_brand_domains_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "organizations" ADD COLUMN "public_brand_id" TEXT;
ALTER TABLE "access_requests" ADD COLUMN "public_brand_id" TEXT;
ALTER TABLE "login_challenges" ADD COLUMN "public_brand_id" TEXT;

CREATE UNIQUE INDEX "public_brands_key_key" ON "public_brands"("key");
CREATE INDEX "public_brands_status_name_idx" ON "public_brands"("status", "name");
CREATE UNIQUE INDEX "public_brand_domains_hostname_key" ON "public_brand_domains"("hostname");
CREATE INDEX "public_brand_domains_public_brand_id_status_idx" ON "public_brand_domains"("public_brand_id", "status");
CREATE INDEX "organizations_public_brand_id_type_status_idx" ON "organizations"("public_brand_id", "type", "status");
CREATE INDEX "access_requests_public_brand_id_status_created_at_idx" ON "access_requests"("public_brand_id", "status", "created_at");
CREATE INDEX "login_challenges_public_brand_id_target_ref_purpose_expires_at_idx" ON "login_challenges"("public_brand_id", "target_ref", "purpose", "expires_at");

ALTER TABLE "public_brand_domains" ADD CONSTRAINT "public_brand_domains_public_brand_id_fkey"
  FOREIGN KEY ("public_brand_id") REFERENCES "public_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_public_brand_id_fkey"
  FOREIGN KEY ("public_brand_id") REFERENCES "public_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_public_brand_id_fkey"
  FOREIGN KEY ("public_brand_id") REFERENCES "public_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_public_brand_id_fkey"
  FOREIGN KEY ("public_brand_id") REFERENCES "public_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
