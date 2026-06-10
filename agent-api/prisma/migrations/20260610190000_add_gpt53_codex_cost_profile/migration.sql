WITH source_profile AS (
  SELECT
    "input_token_price",
    "cached_input_token_price",
    "output_token_price",
    "internal_cost_multiplier"
  FROM "cost_profiles"
  WHERE "organization_id" IS NULL
    AND "model" = 'gpt-5.4'
    AND "is_active" = true
  ORDER BY "created_at" DESC
  LIMIT 1
),
fallback_profile AS (
  SELECT
    2.500000::numeric(18, 6) AS "input_token_price",
    0.250000::numeric(18, 6) AS "cached_input_token_price",
    15.000000::numeric(18, 6) AS "output_token_price",
    0.1000::numeric(10, 4) AS "internal_cost_multiplier"
),
selected_profile AS (
  SELECT * FROM source_profile
  UNION ALL
  SELECT * FROM fallback_profile
  LIMIT 1
)
INSERT INTO "cost_profiles" (
  "id",
  "organization_id",
  "model",
  "input_token_price",
  "cached_input_token_price",
  "output_token_price",
  "internal_cost_multiplier",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  'cost_profile_gpt_53_codex_global',
  NULL,
  'gpt-5.3-codex',
  "input_token_price",
  "cached_input_token_price",
  "output_token_price",
  "internal_cost_multiplier",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM selected_profile
ON CONFLICT ("model") WHERE "organization_id" IS NULL DO NOTHING;
