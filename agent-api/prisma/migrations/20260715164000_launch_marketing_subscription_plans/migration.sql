INSERT INTO "subscription_plans" (
  "id",
  "slug",
  "name",
  "description",
  "status",
  "feature_type",
  "monthly_completed_turn_limit",
  "monthly_token_limit",
  "billing_currency",
  "billing_interval",
  "billing_interval_count",
  "billing_price_cents",
  "billing_status",
  "updated_at"
) VALUES (
  'standard-primary-annual',
  'primary-annual',
  'Primary Edition Annual',
  'Primary Edition · 100 AI requests per month · annual prepaid access',
  'active',
  'chat',
  100,
  NULL,
  'usd',
  'year',
  1,
  59900,
  'active',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "status" = EXCLUDED."status",
  "feature_type" = EXCLUDED."feature_type",
  "monthly_completed_turn_limit" = EXCLUDED."monthly_completed_turn_limit",
  "monthly_token_limit" = EXCLUDED."monthly_token_limit",
  "billing_currency" = EXCLUDED."billing_currency",
  "billing_interval" = EXCLUDED."billing_interval",
  "billing_interval_count" = EXCLUDED."billing_interval_count",
  "billing_price_cents" = EXCLUDED."billing_price_cents",
  "billing_status" = EXCLUDED."billing_status",
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "subscription_plans"
SET
  "name" = 'Standard Edition Monthly',
  "description" = 'Standard Edition · 300 AI requests per month · monthly prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'plus-monthly';

UPDATE "subscription_plans"
SET
  "name" = 'Standard Edition Annual',
  "description" = 'Standard Edition · 300 AI requests per month · annual prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'plus-annual';

UPDATE "subscription_plans"
SET
  "name" = 'Premium Edition Monthly',
  "description" = 'Premium Edition · 1200 AI requests per month · monthly prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'pro-monthly';

UPDATE "subscription_plans"
SET
  "name" = 'Premium Edition Annual',
  "description" = 'Premium Edition · 1200 AI requests per month · annual prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'pro-annual';

UPDATE "subscription_plans"
SET
  "name" = 'Standard Edition Trial',
  "description" = 'Standard Edition · 300 AI requests per month · 60-day free trial',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'trial-for-plus';

UPDATE "access_request_policies"
SET
  "default_trial_days" = 60,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "policy_key" = 'global';

UPDATE "billing_orders"
SET
  "status" = 'expired',
  "metadata_json" = COALESCE("metadata_json", '{}'::jsonb) || jsonb_build_object(
    'reconciliation',
    jsonb_build_object(
      'reason', 'Checkout Session expired without payment before the 2026-07 package launch',
      'reconciledAt', CURRENT_TIMESTAMP
    )
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "order_number" IN ('AS-20260613-D4D1947A', 'AS-20260708-5A5AAFA9')
  AND "status" = 'pending_payment'
  AND "paid_at" IS NULL;
