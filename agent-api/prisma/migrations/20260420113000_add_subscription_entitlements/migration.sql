CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "feature_type" TEXT NOT NULL DEFAULT 'chat',
    "monthly_completed_turn_limit" INTEGER,
    "monthly_token_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_grants" (
    "id" TEXT NOT NULL,
    "principal_type" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "cycle_anchor_at" TIMESTAMP(3) NOT NULL,
    "completed_turn_limit_override" INTEGER,
    "token_limit_override" INTEGER,
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_denial_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "user_id" TEXT,
    "thread_id" TEXT,
    "session_id" TEXT,
    "principal_type" TEXT,
    "principal_id" TEXT,
    "reason_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "model" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_denial_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plans_slug_key" ON "subscription_plans"("slug");
CREATE INDEX "subscription_plans_status_feature_type_idx" ON "subscription_plans"("status", "feature_type");

CREATE UNIQUE INDEX "subscription_grants_principal_type_principal_id_key" ON "subscription_grants"("principal_type", "principal_id");
CREATE INDEX "subscription_grants_plan_id_idx" ON "subscription_grants"("plan_id");
CREATE INDEX "subscription_grants_status_expires_at_idx" ON "subscription_grants"("status", "expires_at");

CREATE INDEX "subscription_denial_logs_organization_id_created_at_idx" ON "subscription_denial_logs"("organization_id", "created_at");
CREATE INDEX "subscription_denial_logs_user_id_created_at_idx" ON "subscription_denial_logs"("user_id", "created_at");
CREATE INDEX "subscription_denial_logs_reason_code_created_at_idx" ON "subscription_denial_logs"("reason_code", "created_at");

ALTER TABLE "subscription_grants"
    ADD CONSTRAINT "subscription_grants_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
