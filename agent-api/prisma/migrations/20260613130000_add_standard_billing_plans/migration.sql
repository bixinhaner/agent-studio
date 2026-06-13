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
) VALUES
  (
    'standard-plus-monthly',
    'plus-monthly',
    'Plus Class Monthly',
    'Plus Class · 300 AI requests per month · monthly prepaid access',
    'active',
    'chat',
    300,
    NULL,
    'usd',
    'month',
    1,
    9900,
    'active',
    CURRENT_TIMESTAMP
  ),
  (
    'standard-plus-annual',
    'plus-annual',
    'Plus Class Annual',
    'Plus Class · 300 AI requests per month · annual prepaid access',
    'active',
    'chat',
    300,
    NULL,
    'usd',
    'year',
    1,
    99900,
    'active',
    CURRENT_TIMESTAMP
  ),
  (
    'standard-pro-monthly',
    'pro-monthly',
    'PRO Monthly',
    'PRO · 1000 AI requests per month · monthly prepaid access',
    'active',
    'chat',
    1000,
    NULL,
    'usd',
    'month',
    1,
    24900,
    'active',
    CURRENT_TIMESTAMP
  ),
  (
    'standard-pro-annual',
    'pro-annual',
    'PRO Annual',
    'PRO · 1000 AI requests per month · annual prepaid access',
    'active',
    'chat',
    1000,
    NULL,
    'usd',
    'year',
    1,
    249900,
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
SET "billing_status" = 'disabled',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" IN ('test', 'stripe-test', 'billing-test')
  AND "billing_status" = 'active';
