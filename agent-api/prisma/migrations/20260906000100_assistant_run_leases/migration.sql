-- Existing queued jobs are preserved; only expired execution leases are reclaimed.
ALTER TABLE proactive_agent_runs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE proactive_agent_runs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS proactive_run_lease_idx ON proactive_agent_runs (status, lease_expires_at, queued_at);

ALTER TABLE "connector_tool_invocations" ADD COLUMN "run_attempt" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "connector_tool_invocations_run_attempt_idx" ON "connector_tool_invocations" ("run_id", "run_attempt");
