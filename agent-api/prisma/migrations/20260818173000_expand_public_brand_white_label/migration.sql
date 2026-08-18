ALTER TABLE "public_brands"
  ADD COLUMN "access_sales_contact_label" TEXT NOT NULL DEFAULT 'Sales Contact',
  ADD COLUMN "support_email" TEXT,
  ADD COLUMN "support_url" TEXT,
  ADD COLUMN "privacy_url" TEXT,
  ADD COLUMN "terms_url" TEXT,
  ADD COLUMN "email_from_name" TEXT NOT NULL DEFAULT 'AI Assistant',
  ADD COLUMN "email_from_address" TEXT,
  ADD COLUMN "email_reply_to" TEXT,
  ADD COLUMN "email_sender_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billing_merchant_name" TEXT,
  ADD COLUMN "billing_support_email" TEXT,
  ADD COLUMN "payment_account_mode" TEXT NOT NULL DEFAULT 'shared',
  ADD COLUMN "payment_stripe_account_id" TEXT,
  ADD COLUMN "payment_account_ready" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resource_binding_mode" TEXT NOT NULL DEFAULT 'brand_managed',
  ADD COLUMN "knowledge_isolation_mode" TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN "knowledge_replacement_rules" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "knowledge_projection_storage" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "knowledge_projection_status" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN "knowledge_projection_item_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "knowledge_projection_at" TIMESTAMP(3),
  ADD COLUMN "knowledge_projection_error" TEXT,
  ADD COLUMN "output_protection_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "output_forbidden_terms" JSONB NOT NULL DEFAULT '[]';

UPDATE "public_brands"
SET
  "access_sales_contact_label" = CASE WHEN "key" = 'ranley' THEN 'CloudRAN.AI Sales Contact' ELSE 'Sales Contact' END,
  "email_from_name" = "platform_name",
  "billing_merchant_name" = "platform_name",
  "resource_binding_mode" = CASE WHEN "key" = 'bailey' THEN 'organization_policy' ELSE 'brand_managed' END,
  "knowledge_isolation_mode" = CASE WHEN "key" = 'ranley' THEN 'brand_projection' ELSE 'direct' END,
  "knowledge_projection_status" = CASE WHEN "key" = 'ranley' THEN 'pending' ELSE 'not_required' END,
  "knowledge_replacement_rules" = CASE
    WHEN "key" = 'ranley' THEN '[{"source":"Baicells","target":"CloudRAN.AI","mode":"replace"},{"source":"Bailey","target":"Ranley","mode":"replace"},{"source":"Agent Studio","target":"Ranley","mode":"replace"}]'::jsonb
    ELSE '[]'::jsonb
  END,
  "output_protection_enabled" = CASE WHEN "key" = 'ranley' THEN true ELSE false END,
  "output_forbidden_terms" = CASE WHEN "key" = 'ranley' THEN '["Baicells","Bailey","Agent Studio"]'::jsonb ELSE '[]'::jsonb END;
