-- CreateTable
CREATE TABLE "resource_access_logs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "user_id" TEXT,
  "department_id_snapshot" TEXT,
  "thread_id" TEXT,
  "session_id" TEXT,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "result_status" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "resource_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "user_id" TEXT,
  "department_id_snapshot" TEXT,
  "thread_id" TEXT,
  "session_id" TEXT,
  "model" TEXT NOT NULL,
  "feature_type" TEXT NOT NULL,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "internal_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "result_status" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_daily_rollups" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "rollup_date" DATE NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "model" TEXT NOT NULL DEFAULT '',
  "feature_type" TEXT NOT NULL DEFAULT '',
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "internal_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "usage_daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_profiles" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "model" TEXT NOT NULL,
  "input_token_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "cached_input_token_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "output_token_price" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "internal_cost_multiplier" DECIMAL(10,4) NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cost_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_policies" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "feature_type" TEXT,
  "model" TEXT,
  "metric_type" TEXT NOT NULL,
  "window_type" TEXT NOT NULL,
  "threshold_value" DECIMAL(18,6) NOT NULL,
  "enforcement_mode" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quota_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "rule_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "conditions" JSONB NOT NULL,
  "channels" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "alert_rule_id" TEXT,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_records" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "channel_type" TEXT NOT NULL,
  "target_ref" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payload" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_access_logs_user_id_created_at_idx" ON "resource_access_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "resource_access_logs_department_id_snapshot_created_at_idx" ON "resource_access_logs"("department_id_snapshot", "created_at");

-- CreateIndex
CREATE INDEX "resource_access_logs_thread_id_created_at_idx" ON "resource_access_logs"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "resource_access_logs_session_id_created_at_idx" ON "resource_access_logs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "resource_access_logs_resource_type_resource_id_created_at_idx" ON "resource_access_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "resource_access_logs_action_type_created_at_idx" ON "resource_access_logs"("action_type", "created_at");

-- CreateIndex
CREATE INDEX "resource_access_logs_result_status_created_at_idx" ON "resource_access_logs"("result_status", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_user_id_created_at_idx" ON "usage_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_department_id_snapshot_created_at_idx" ON "usage_events"("department_id_snapshot", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_thread_id_created_at_idx" ON "usage_events"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_session_id_created_at_idx" ON "usage_events"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_model_created_at_idx" ON "usage_events"("model", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_feature_type_created_at_idx" ON "usage_events"("feature_type", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_result_status_created_at_idx" ON "usage_events"("result_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_rollups_rollup_date_scope_type_scope_id_model_feature_type_key"
ON "usage_daily_rollups"("rollup_date", "scope_type", "scope_id", "model", "feature_type");

-- CreateIndex
CREATE INDEX "usage_daily_rollups_scope_type_scope_id_rollup_date_idx" ON "usage_daily_rollups"("scope_type", "scope_id", "rollup_date");

-- CreateIndex
CREATE INDEX "usage_daily_rollups_model_rollup_date_idx" ON "usage_daily_rollups"("model", "rollup_date");

-- CreateIndex
CREATE INDEX "usage_daily_rollups_feature_type_rollup_date_idx" ON "usage_daily_rollups"("feature_type", "rollup_date");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profiles_organization_id_model_key" ON "cost_profiles"("organization_id", "model");

-- CreateIndex
CREATE UNIQUE INDEX "cost_profiles_global_model_key" ON "cost_profiles"("model") WHERE "organization_id" IS NULL;

-- CreateIndex
CREATE INDEX "cost_profiles_is_active_model_idx" ON "cost_profiles"("is_active", "model");

-- CreateIndex
CREATE INDEX "quota_policies_scope_type_scope_id_is_active_idx" ON "quota_policies"("scope_type", "scope_id", "is_active");

-- CreateIndex
CREATE INDEX "quota_policies_metric_type_is_active_idx" ON "quota_policies"("metric_type", "is_active");

-- CreateIndex
CREATE INDEX "quota_policies_feature_type_model_is_active_idx" ON "quota_policies"("feature_type", "model", "is_active");

-- CreateIndex
CREATE INDEX "alert_rules_scope_type_scope_id_is_active_idx" ON "alert_rules"("scope_type", "scope_id", "is_active");

-- CreateIndex
CREATE INDEX "alert_rules_rule_type_is_active_idx" ON "alert_rules"("rule_type", "is_active");

-- CreateIndex
CREATE INDEX "alert_events_alert_rule_id_created_at_idx" ON "alert_events"("alert_rule_id", "created_at");

-- CreateIndex
CREATE INDEX "alert_events_scope_type_scope_id_created_at_idx" ON "alert_events"("scope_type", "scope_id", "created_at");

-- CreateIndex
CREATE INDEX "alert_events_status_severity_created_at_idx" ON "alert_events"("status", "severity", "created_at");

-- CreateIndex
CREATE INDEX "notification_records_channel_type_status_created_at_idx" ON "notification_records"("channel_type", "status", "created_at");

-- CreateIndex
CREATE INDEX "notification_records_event_type_created_at_idx" ON "notification_records"("event_type", "created_at");
