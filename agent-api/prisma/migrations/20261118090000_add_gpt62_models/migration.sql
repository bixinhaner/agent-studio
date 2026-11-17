-- OpenAI Standard pricing (USD / 1M tokens), verified 2026-11-18:
-- https://developers.openai.com/api/docs/pricing
-- gpt-6.2-sol:   input 2.00, cached 0.10, cache write 2.50, output 10.00
-- gpt-6.2-astra: input 8.00, cached 0.40, cache write 10.00, output 40.00
-- Long context (>272K input): input x2, output x1.5 for both models.
-- Preserve existing customized profiles. Internal multiplier follows the matching
-- global predecessor profile, keeping the organization's accounting convention.
INSERT INTO "cost_profiles" (
  "id", "organization_id", "model", "input_token_price", "cached_input_token_price",
  "cache_write_token_price", "output_token_price", "long_context_threshold_tokens",
  "long_context_input_multiplier", "long_context_output_multiplier",
  "internal_cost_multiplier", "is_active", "created_at", "updated_at"
)
VALUES (
  'cost_profile_gpt_6_2_sol_global', NULL, 'gpt-6.2-sol', 2.000000, 0.100000,
  2.500000, 10.000000, 272000, 2.0000, 1.5000,
  COALESCE((SELECT "internal_cost_multiplier" FROM "cost_profiles"
    WHERE "organization_id" IS NULL AND "model" = 'gpt-6.1-sol' AND "is_active" = true
    LIMIT 1), 1.0000), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;

INSERT INTO "cost_profiles" (
  "id", "organization_id", "model", "input_token_price", "cached_input_token_price",
  "cache_write_token_price", "output_token_price", "long_context_threshold_tokens",
  "long_context_input_multiplier", "long_context_output_multiplier",
  "internal_cost_multiplier", "is_active", "created_at", "updated_at"
)
VALUES (
  'cost_profile_gpt_6_2_astra_global', NULL, 'gpt-6.2-astra', 8.000000, 0.400000,
  10.000000, 40.000000, 272000, 2.0000, 1.5000,
  COALESCE((SELECT "internal_cost_multiplier" FROM "cost_profiles"
    WHERE "organization_id" IS NULL AND "model" = 'gpt-6-astra' AND "is_active" = true
    LIMIT 1), 1.0000), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;

-- Additive only: allow gpt-6.2-sol wherever gpt-6.1-sol is allowed. The old
-- release (Codex 0.159.2) cannot run gpt-6.2-sol, so switching defaults and
-- existing threads happens after the new chat slot is live, not here.
UPDATE "run_profiles"
SET "allowed_models" = "allowed_models" || '["gpt-6.2-sol"]'::jsonb,
    "updated_at" = CURRENT_TIMESTAMP
WHERE jsonb_typeof("allowed_models") = 'array'
  AND "allowed_models" ? 'gpt-6.1-sol'
  AND NOT "allowed_models" ? 'gpt-6.2-sol';
