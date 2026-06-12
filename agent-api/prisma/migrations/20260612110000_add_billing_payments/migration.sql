ALTER TABLE "subscription_plans"
  ADD COLUMN "billing_currency" TEXT NOT NULL DEFAULT 'usd',
  ADD COLUMN "billing_interval" TEXT NOT NULL DEFAULT 'month',
  ADD COLUMN "billing_interval_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "billing_price_cents" INTEGER,
  ADD COLUMN "billing_status" TEXT NOT NULL DEFAULT 'not_configured';

CREATE INDEX "subscription_plans_billing_status_billing_interval_idx"
  ON "subscription_plans"("billing_status", "billing_interval");

CREATE TABLE "billing_customers" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "business_email" TEXT,
  "company_name" TEXT,
  "contact_name" TEXT,
  "country_region" TEXT,
  "sn" TEXT,
  "sales_contact" TEXT,
  "billing_email" TEXT,
  "stripe_customer_id" TEXT,
  "default_auto_renew" BOOLEAN NOT NULL DEFAULT true,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_customers_organization_id_key" ON "billing_customers"("organization_id");
CREATE UNIQUE INDEX "billing_customers_stripe_customer_id_key" ON "billing_customers"("stripe_customer_id");
CREATE INDEX "billing_customers_business_email_idx" ON "billing_customers"("business_email");
CREATE INDEX "billing_customers_company_name_idx" ON "billing_customers"("company_name");

CREATE TABLE "billing_orders" (
  "id" TEXT NOT NULL,
  "order_number" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "billing_customer_id" TEXT,
  "plan_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "source" TEXT NOT NULL DEFAULT 'portal',
  "checkout_mode" TEXT NOT NULL DEFAULT 'payment',
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "amount_subtotal_cents" INTEGER NOT NULL DEFAULT 0,
  "discount_cents" INTEGER NOT NULL DEFAULT 0,
  "amount_total_cents" INTEGER NOT NULL DEFAULT 0,
  "duration_days" INTEGER NOT NULL DEFAULT 0,
  "gift_days" INTEGER NOT NULL DEFAULT 0,
  "auto_renew" BOOLEAN NOT NULL DEFAULT true,
  "promotion_code_id" TEXT,
  "stripe_checkout_session_id" TEXT,
  "stripe_payment_intent_id" TEXT,
  "stripe_invoice_id" TEXT,
  "stripe_subscription_id" TEXT,
  "entitlement_starts_at" TIMESTAMP(3),
  "entitlement_expires_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_orders_order_number_key" ON "billing_orders"("order_number");
CREATE UNIQUE INDEX "billing_orders_stripe_checkout_session_id_key" ON "billing_orders"("stripe_checkout_session_id");
CREATE INDEX "billing_orders_organization_id_created_at_idx" ON "billing_orders"("organization_id", "created_at");
CREATE INDEX "billing_orders_status_created_at_idx" ON "billing_orders"("status", "created_at");
CREATE INDEX "billing_orders_plan_id_idx" ON "billing_orders"("plan_id");
CREATE INDEX "billing_orders_stripe_subscription_id_idx" ON "billing_orders"("stripe_subscription_id");

CREATE TABLE "billing_auto_renewals" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "billing_customer_id" TEXT,
  "plan_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'enabled',
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "payment_method_status" TEXT NOT NULL DEFAULT 'unknown',
  "current_period_starts_at" TIMESTAMP(3),
  "current_period_ends_at" TIMESTAMP(3),
  "next_renewal_at" TIMESTAMP(3),
  "last_payment_failed_at" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_auto_renewals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_auto_renewals_organization_id_key" ON "billing_auto_renewals"("organization_id");
CREATE UNIQUE INDEX "billing_auto_renewals_stripe_subscription_id_key" ON "billing_auto_renewals"("stripe_subscription_id");
CREATE INDEX "billing_auto_renewals_status_next_renewal_at_idx" ON "billing_auto_renewals"("status", "next_renewal_at");
CREATE INDEX "billing_auto_renewals_plan_id_idx" ON "billing_auto_renewals"("plan_id");

CREATE TABLE "promotion_codes" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" TEXT NOT NULL DEFAULT 'active',
  "max_redemptions" INTEGER,
  "per_customer_limit" INTEGER NOT NULL DEFAULT 1,
  "starts_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "eligible_plan_ids" JSONB,
  "eligible_organization_ids" JSONB,
  "eligible_email_domains" JSONB,
  "eligible_sn_values" JSONB,
  "owner_user_id" TEXT,
  "created_by_user_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotion_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotion_codes_code_key" ON "promotion_codes"("code");
CREATE INDEX "promotion_codes_status_expires_at_idx" ON "promotion_codes"("status", "expires_at");
CREATE INDEX "promotion_codes_type_idx" ON "promotion_codes"("type");

CREATE TABLE "promotion_redemptions" (
  "id" TEXT NOT NULL,
  "promotion_code_id" TEXT NOT NULL,
  "order_id" TEXT,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT,
  "code" TEXT NOT NULL,
  "discount_cents" INTEGER NOT NULL DEFAULT 0,
  "gift_days" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'redeemed',
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotion_redemptions_promotion_code_id_order_id_key"
  ON "promotion_redemptions"("promotion_code_id", "order_id");
CREATE INDEX "promotion_redemptions_organization_id_created_at_idx"
  ON "promotion_redemptions"("organization_id", "created_at");
CREATE INDEX "promotion_redemptions_code_idx" ON "promotion_redemptions"("code");

CREATE TABLE "billing_email_rules" (
  "id" TEXT NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "offset_days" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'enabled',
  "audience_json" JSONB,
  "subject" TEXT NOT NULL,
  "body_text" TEXT NOT NULL,
  "body_html" TEXT,
  "last_run_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_email_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_email_rules_trigger_type_offset_days_key"
  ON "billing_email_rules"("trigger_type", "offset_days");
CREATE INDEX "billing_email_rules_status_trigger_type_idx"
  ON "billing_email_rules"("status", "trigger_type");

CREATE TABLE "billing_stripe_events" (
  "id" TEXT NOT NULL,
  "stripe_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "payload_json" JSONB,
  "error_message" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_stripe_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_stripe_events_stripe_event_id_key"
  ON "billing_stripe_events"("stripe_event_id");
CREATE INDEX "billing_stripe_events_event_type_created_at_idx"
  ON "billing_stripe_events"("event_type", "created_at");
CREATE INDEX "billing_stripe_events_status_created_at_idx"
  ON "billing_stripe_events"("status", "created_at");

INSERT INTO "billing_email_rules" (
  "id",
  "trigger_type",
  "offset_days",
  "status",
  "audience_json",
  "subject",
  "body_text",
  "body_html",
  "updated_at"
) VALUES
  ('billing-email-rule-expiring-14', 'expires_in_days', 14, 'enabled', '{"billingContacts":true,"organizationAdmins":true,"salesContact":true}'::jsonb, 'Agent Studio subscription expires in 14 days', 'Your Agent Studio subscription for {{company_name}} expires on {{expires_at_local}}. Renew here: {{renew_url}}', NULL, CURRENT_TIMESTAMP),
  ('billing-email-rule-expiring-7', 'expires_in_days', 7, 'enabled', '{"billingContacts":true,"organizationAdmins":true,"salesContact":true}'::jsonb, 'Agent Studio subscription expires in 7 days', 'Your Agent Studio subscription for {{company_name}} expires on {{expires_at_local}}. Renew here: {{renew_url}}', NULL, CURRENT_TIMESTAMP),
  ('billing-email-rule-expiring-1', 'expires_in_days', 1, 'enabled', '{"billingContacts":true,"organizationAdmins":true,"salesContact":true}'::jsonb, 'Agent Studio subscription expires tomorrow', 'Your Agent Studio subscription for {{company_name}} expires on {{expires_at_local}}. Renew here: {{renew_url}}', NULL, CURRENT_TIMESTAMP),
  ('billing-email-rule-expired-0', 'expired', 0, 'enabled', '{"billingContacts":true,"organizationAdmins":true,"salesContact":true}'::jsonb, 'Agent Studio subscription has expired', 'Your Agent Studio subscription for {{company_name}} expired on {{expires_at_local}}. Renew here: {{renew_url}}', NULL, CURRENT_TIMESTAMP),
  ('billing-email-rule-auto-renew-failed-0', 'auto_renew_failed', 0, 'enabled', '{"billingContacts":true,"organizationAdmins":true,"salesContact":true}'::jsonb, 'Agent Studio automatic renewal failed', 'Automatic renewal for {{company_name}} failed. Update payment and renew here: {{renew_url}}', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("trigger_type", "offset_days") DO NOTHING;
