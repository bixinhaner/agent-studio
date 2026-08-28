CREATE TYPE "ProactiveRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_TOOL', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SUPPRESSED');
CREATE TYPE "ConnectorToolInvocationStatus" AS ENUM ('PENDING', 'LEASED', 'SUCCEEDED', 'FAILED', 'EXPIRED');
CREATE TYPE "ProactiveFindingDeliveryStatus" AS ENUM ('PENDING', 'LEASED', 'DELIVERED', 'FAILED', 'REJECTED', 'EXPIRED');

CREATE TABLE "connector_event_receipts" (
  "id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "trace_id" TEXT NOT NULL,
  "package_key" TEXT NOT NULL,
  "package_version" TEXT NOT NULL,
  "package_digest" TEXT NOT NULL,
  "handbook_digest" TEXT NOT NULL,
  "envelope" JSONB NOT NULL,
  "outcome" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "connector_event_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_agent_runs" (
  "id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "source_event_receipt_id" TEXT,
  "scenario_key" TEXT NOT NULL,
  "scenario_version" INTEGER NOT NULL DEFAULT 1,
  "status" "ProactiveRunStatus" NOT NULL DEFAULT 'QUEUED',
  "package_digest" TEXT NOT NULL,
  "handbook_digest" TEXT NOT NULL,
  "resource_scope" JSONB NOT NULL,
  "input" JSONB NOT NULL,
  "output" JSONB,
  "error" JSONB,
  "trace_id" TEXT NOT NULL,
  "run_attempt" INTEGER NOT NULL DEFAULT 0,
  "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "connector_tool_invocations" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "scenario_key" TEXT NOT NULL,
  "package_digest" TEXT NOT NULL,
  "handbook_digest" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "arguments" JSONB NOT NULL,
  "resource_scope" JSONB NOT NULL,
  "status" "ConnectorToolInvocationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "lease_token_hash" TEXT,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "deadline_at" TIMESTAMP(3) NOT NULL,
  "result" JSONB,
  "error" JSONB,
  "trace_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "connector_tool_invocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_agent_findings" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "scenario_key" TEXT NOT NULL,
  "scenario_version" INTEGER NOT NULL,
  "package_digest" TEXT NOT NULL,
  "handbook_digest" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "resource_refs" JSONB NOT NULL,
  "facts" JSONB NOT NULL,
  "hypotheses" JSONB NOT NULL,
  "details" JSONB NOT NULL,
  "suggested_actions" JSONB NOT NULL,
  "presentation" JSONB NOT NULL,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_agent_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proactive_finding_deliveries" (
  "id" TEXT NOT NULL,
  "finding_id" TEXT NOT NULL,
  "connector_id" TEXT NOT NULL,
  "status" "ProactiveFindingDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "lease_token_hash" TEXT,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "local_finding_id" TEXT,
  "error" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proactive_finding_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_event_receipts_connector_id_event_id_key" ON "connector_event_receipts"("connector_id", "event_id");
CREATE INDEX "connector_event_receipts_connector_id_event_type_occurred_at_idx" ON "connector_event_receipts"("connector_id", "event_type", "occurred_at");
CREATE UNIQUE INDEX "proactive_agent_runs_source_event_receipt_id_key" ON "proactive_agent_runs"("source_event_receipt_id");
CREATE INDEX "proactive_agent_runs_status_queued_at_idx" ON "proactive_agent_runs"("status", "queued_at");
CREATE INDEX "proactive_agent_runs_connector_id_scenario_key_created_at_idx" ON "proactive_agent_runs"("connector_id", "scenario_key", "created_at");
CREATE UNIQUE INDEX "connector_tool_invocations_run_id_id_key" ON "connector_tool_invocations"("run_id", "id");
CREATE INDEX "connector_tool_invocations_connector_id_status_created_at_idx" ON "connector_tool_invocations"("connector_id", "status", "created_at");
CREATE INDEX "connector_tool_invocations_run_id_status_idx" ON "connector_tool_invocations"("run_id", "status");
CREATE INDEX "proactive_agent_findings_connector_id_created_at_idx" ON "proactive_agent_findings"("connector_id", "created_at");
CREATE INDEX "proactive_agent_findings_run_id_idx" ON "proactive_agent_findings"("run_id");
CREATE INDEX "proactive_finding_deliveries_connector_id_status_created_at_idx" ON "proactive_finding_deliveries"("connector_id", "status", "created_at");
CREATE UNIQUE INDEX "proactive_finding_deliveries_connector_id_finding_id_key" ON "proactive_finding_deliveries"("connector_id", "finding_id");

ALTER TABLE "connector_event_receipts" ADD CONSTRAINT "connector_event_receipts_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_agent_runs" ADD CONSTRAINT "proactive_agent_runs_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_agent_runs" ADD CONSTRAINT "proactive_agent_runs_source_event_receipt_id_fkey" FOREIGN KEY ("source_event_receipt_id") REFERENCES "connector_event_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "connector_tool_invocations" ADD CONSTRAINT "connector_tool_invocations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "proactive_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connector_tool_invocations" ADD CONSTRAINT "connector_tool_invocations_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_agent_findings" ADD CONSTRAINT "proactive_agent_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "proactive_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_agent_findings" ADD CONSTRAINT "proactive_agent_findings_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_finding_deliveries" ADD CONSTRAINT "proactive_finding_deliveries_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "proactive_agent_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proactive_finding_deliveries" ADD CONSTRAINT "proactive_finding_deliveries_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
