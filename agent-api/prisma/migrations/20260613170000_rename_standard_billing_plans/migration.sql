UPDATE "subscription_plans"
SET
  "name" = 'Plus Monthly',
  "description" = 'Plus · 300 AI requests per month · monthly prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'plus-monthly';

UPDATE "subscription_plans"
SET
  "name" = 'Plus Annual',
  "description" = 'Plus · 300 AI requests per month · annual prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'plus-annual';

UPDATE "subscription_plans"
SET
  "name" = 'Pro Monthly',
  "description" = 'Pro · 1000 AI requests per month · monthly prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'pro-monthly';

UPDATE "subscription_plans"
SET
  "name" = 'Pro Annual',
  "description" = 'Pro · 1000 AI requests per month · annual prepaid access',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'pro-annual';
