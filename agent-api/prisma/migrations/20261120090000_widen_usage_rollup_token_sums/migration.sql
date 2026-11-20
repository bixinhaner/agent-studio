-- Daily token sums outgrow int4 (max 2,147,483,647): on 2026-10-26 one model/feature
-- rollup reached 1,143,579,551 input tokens. A rebuild that overflows fails the whole day.
ALTER TABLE "usage_daily_rollups"
  ALTER COLUMN "input_tokens" SET DATA TYPE BIGINT,
  ALTER COLUMN "cached_input_tokens" SET DATA TYPE BIGINT,
  ALTER COLUMN "cache_write_tokens" SET DATA TYPE BIGINT,
  ALTER COLUMN "output_tokens" SET DATA TYPE BIGINT;
