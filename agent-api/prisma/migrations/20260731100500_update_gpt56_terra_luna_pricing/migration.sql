-- OpenAI changed GPT-5.6 Terra and Luna prices on 2026-07-31.
-- Usage events persist their calculated costs, so this only affects events ingested after deployment.
UPDATE "cost_profiles"
SET
  "input_token_price" = CASE "model"
    WHEN 'gpt-5.6-terra' THEN 2.000000
    WHEN 'gpt-5.6-luna' THEN 0.200000
  END,
  "cached_input_token_price" = CASE "model"
    WHEN 'gpt-5.6-terra' THEN 0.200000
    WHEN 'gpt-5.6-luna' THEN 0.020000
  END,
  "cache_write_token_price" = CASE "model"
    WHEN 'gpt-5.6-terra' THEN 2.500000
    WHEN 'gpt-5.6-luna' THEN 0.250000
  END,
  "output_token_price" = CASE "model"
    WHEN 'gpt-5.6-terra' THEN 12.000000
    WHEN 'gpt-5.6-luna' THEN 1.200000
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "organization_id" IS NULL
  AND "model" IN ('gpt-5.6-terra', 'gpt-5.6-luna')
  AND (
    ("model" = 'gpt-5.6-terra' AND (
      "input_token_price" IS DISTINCT FROM 2.000000
      OR "cached_input_token_price" IS DISTINCT FROM 0.200000
      OR "cache_write_token_price" IS DISTINCT FROM 2.500000
      OR "output_token_price" IS DISTINCT FROM 12.000000
    ))
    OR
    ("model" = 'gpt-5.6-luna' AND (
      "input_token_price" IS DISTINCT FROM 0.200000
      OR "cached_input_token_price" IS DISTINCT FROM 0.020000
      OR "cache_write_token_price" IS DISTINCT FROM 0.250000
      OR "output_token_price" IS DISTINCT FROM 1.200000
    ))
  );
