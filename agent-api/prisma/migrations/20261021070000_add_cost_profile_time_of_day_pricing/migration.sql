-- Optional peak/off-peak pricing per cost profile (additive; old code ignores the column).
ALTER TABLE "cost_profiles" ADD COLUMN "time_of_day_pricing" JSONB;
