CREATE TYPE "ProactivePackageStatus" AS ENUM ('VALIDATED', 'ACTIVE', 'RETIRED', 'REJECTED');
CREATE TYPE "ProactiveScenarioRolloutMode" AS ENUM ('DISABLED', 'SHADOW', 'ACTIVE');

CREATE TABLE "proactive_integration_packages" (
  "id" TEXT NOT NULL,
  "package_key" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "status" "ProactivePackageStatus" NOT NULL DEFAULT 'VALIDATED',
  "validated_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_integration_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_agent_scenarios" (
  "id" TEXT NOT NULL,
  "package_id" TEXT NOT NULL,
  "scenario_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "compiled_spec" JSONB NOT NULL,
  "default_mode" "ProactiveScenarioRolloutMode" NOT NULL DEFAULT 'DISABLED',
  "default_percentage" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_agent_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_connector_scenario_settings" (
  "id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "scenario_id" TEXT NOT NULL,
  "rollout_mode" "ProactiveScenarioRolloutMode" NOT NULL DEFAULT 'DISABLED',
  "rollout_percentage" INTEGER NOT NULL DEFAULT 0,
  "max_concurrent_runs" INTEGER NOT NULL,
  "max_runs_per_hour" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_connector_scenario_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_scenario_dedupe_locks" (
  "connector_id" TEXT NOT NULL,
  "scenario_key" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proactive_scenario_dedupe_locks_pkey" PRIMARY KEY ("connector_id", "scenario_key", "dedupe_key")
);

CREATE TABLE "proactive_connector_heartbeats" (
  "connector_id" TEXT NOT NULL,
  "worker_id" TEXT NOT NULL,
  "handbook_digest" TEXT NOT NULL,
  "queue_depth" INTEGER NOT NULL DEFAULT 0,
  "details" JSONB NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_connector_heartbeats_pkey" PRIMARY KEY ("connector_id")
);

DROP INDEX IF EXISTS "proactive_agent_runs_source_event_receipt_id_key";
ALTER TABLE "proactive_agent_runs"
  ADD COLUMN "scenario_snapshot" JSONB,
  ADD COLUMN "rollout_mode" TEXT,
  ADD COLUMN "rollout_percentage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "proactive_integration_packages_digest_key" ON "proactive_integration_packages"("digest");
CREATE UNIQUE INDEX "proactive_integration_packages_package_key_version_key" ON "proactive_integration_packages"("package_key", "version");
CREATE INDEX "proactive_integration_packages_package_key_status_idx" ON "proactive_integration_packages"("package_key", "status");
CREATE UNIQUE INDEX "proactive_agent_scenarios_package_id_scenario_key_key" ON "proactive_agent_scenarios"("package_id", "scenario_key");
CREATE INDEX "proactive_agent_scenarios_event_type_idx" ON "proactive_agent_scenarios"("event_type");
CREATE UNIQUE INDEX "proactive_connector_scenario_settings_connector_id_scenario_id_key" ON "proactive_connector_scenario_settings"("connector_id", "scenario_id");
CREATE INDEX "proactive_connector_scenario_settings_connector_id_rollout_mode_idx" ON "proactive_connector_scenario_settings"("connector_id", "rollout_mode");
CREATE INDEX "proactive_scenario_dedupe_locks_expires_at_idx" ON "proactive_scenario_dedupe_locks"("expires_at");
CREATE INDEX "proactive_connector_heartbeats_last_seen_at_idx" ON "proactive_connector_heartbeats"("last_seen_at");
CREATE UNIQUE INDEX "proactive_agent_runs_source_event_receipt_id_scenario_key_key" ON "proactive_agent_runs"("source_event_receipt_id", "scenario_key");

ALTER TABLE "proactive_agent_scenarios" ADD CONSTRAINT "proactive_agent_scenarios_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "proactive_integration_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_connector_scenario_settings" ADD CONSTRAINT "proactive_connector_scenario_settings_scenario_id_fkey"
  FOREIGN KEY ("scenario_id") REFERENCES "proactive_agent_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_connector_scenario_settings" ADD CONSTRAINT "proactive_connector_scenario_settings_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_connector_heartbeats" ADD CONSTRAINT "proactive_connector_heartbeats_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
