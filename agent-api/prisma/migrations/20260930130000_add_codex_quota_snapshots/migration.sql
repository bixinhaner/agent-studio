CREATE TABLE "codex_quota_snapshots" (
    "id" TEXT NOT NULL,
    "credential_hash" TEXT NOT NULL,
    "limit_id" TEXT NOT NULL DEFAULT 'codex',
    "reset_at" TIMESTAMP(3) NOT NULL,
    "window_duration_mins" INTEGER NOT NULL,
    "used_percent" INTEGER NOT NULL,
    "remaining_percent" INTEGER NOT NULL,
    "ordinary_usage_allowed" BOOLEAN NOT NULL,
    "plan_type" TEXT,
    "credits_available" BOOLEAN,
    "credits_balance" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sample_bucket" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codex_quota_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "codex_quota_snapshots_credential_hash_limit_id_reset_at_sample_bucket_key"
    ON "codex_quota_snapshots"("credential_hash", "limit_id", "reset_at", "sample_bucket");

CREATE INDEX "codex_quota_snapshots_reset_at_observed_at_idx"
    ON "codex_quota_snapshots"("reset_at", "observed_at");
