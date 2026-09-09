-- OpenAI Standard pricing (USD / 1M tokens), verified 2026-09-08:
-- https://developers.openai.com/api/docs/pricing
-- Preserve existing customized profiles. Internal multiplier follows the current
-- global Sol profile, keeping the organization's accounting convention.
INSERT INTO "cost_profiles" (
  "id", "organization_id", "model", "input_token_price", "cached_input_token_price",
  "cache_write_token_price", "output_token_price", "long_context_threshold_tokens",
  "long_context_input_multiplier", "long_context_output_multiplier",
  "internal_cost_multiplier", "is_active", "created_at", "updated_at"
)
VALUES (
  'cost_profile_gpt_6_astra_global', NULL, 'gpt-6-astra', 10.000000, 1.000000,
  12.500000, 50.000000, 272000, 2.0000, 1.5000,
  COALESCE((SELECT "internal_cost_multiplier" FROM "cost_profiles"
    WHERE "organization_id" IS NULL AND "model" = 'gpt-5.6-sol' AND "is_active" = true
    LIMIT 1), 1.0000), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;
