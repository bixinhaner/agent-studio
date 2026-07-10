ALTER TABLE "usage_events"
  ADD COLUMN "cache_write_tokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "usage_daily_rollups"
  ADD COLUMN "cache_write_tokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "cost_profiles"
  ADD COLUMN "cache_write_token_price" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "long_context_threshold_tokens" INTEGER,
  ADD COLUMN "long_context_input_multiplier" DECIMAL(10, 4) NOT NULL DEFAULT 1,
  ADD COLUMN "long_context_output_multiplier" DECIMAL(10, 4) NOT NULL DEFAULT 1;

UPDATE "cost_profiles"
SET
  "long_context_threshold_tokens" = 272000,
  "long_context_input_multiplier" = 2,
  "long_context_output_multiplier" = 1.5
WHERE "model" IN (
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna'
);
