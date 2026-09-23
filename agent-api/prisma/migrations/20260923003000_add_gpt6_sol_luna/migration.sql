-- OpenAI Standard pricing (USD / 1M tokens), verified 2026-09-23:
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
  'cost_profile_gpt_6_sol_global', NULL, 'gpt-6-sol', 2.000000, 0.200000,
  2.500000, 10.000000, 272000, 2.0000, 1.5000,
  COALESCE((SELECT "internal_cost_multiplier" FROM "cost_profiles"
    WHERE "organization_id" IS NULL AND "model" = 'gpt-5.6-sol' AND "is_active" = true
    LIMIT 1), 1.0000), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;

-- OpenAI Standard pricing (USD / 1M tokens), verified 2026-09-23:
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
  'cost_profile_gpt_6_luna_global', NULL, 'gpt-6-luna', 0.100000, 0.010000,
  0.125000, 0.500000, 272000, 2.0000, 1.5000,
  COALESCE((SELECT "internal_cost_multiplier" FROM "cost_profiles"
    WHERE "organization_id" IS NULL AND "model" = 'gpt-5.6-sol' AND "is_active" = true
    LIMIT 1), 1.0000), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;

-- Add optional choices only; preserve defaults and persisted conversation models.
UPDATE "run_profiles" p
SET "allowed_models" = p."allowed_models" || (
  SELECT jsonb_agg(m.model) FROM (VALUES ('gpt-6-sol'), ('gpt-6-luna')) AS m(model)
  WHERE NOT p."allowed_models" ? m.model
), "updated_at" = CURRENT_TIMESTAMP
WHERE p."status" = 'active'
  AND jsonb_typeof(p."allowed_models") = 'array'
  AND jsonb_array_length(p."allowed_models") > 0
  AND (NOT p."allowed_models" ? 'gpt-6-sol' OR NOT p."allowed_models" ? 'gpt-6-luna');
