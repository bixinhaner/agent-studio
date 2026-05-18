-- CreateTable
CREATE TABLE "zendesk_runs" (
  "id" TEXT NOT NULL,
  "integration_instance_id" TEXT,
  "scope_key" TEXT NOT NULL DEFAULT 'legacy',
  "ticket_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "decision" TEXT,
  "comment_id" INTEGER,
  "requester_comment_id" INTEGER,
  "ticket_subject" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zendesk_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zendesk_ticket_bindings" (
  "id" TEXT NOT NULL,
  "integration_instance_id" TEXT,
  "scope_key" TEXT NOT NULL DEFAULT 'legacy',
  "ticket_id" TEXT NOT NULL,
  "last_processed_requester_comment_id" INTEGER,
  "last_action" TEXT,
  "last_run_at" TIMESTAMP(3),
  "last_run_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "zendesk_ticket_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zendesk_runs_integration_instance_id_created_at_idx" ON "zendesk_runs"("integration_instance_id", "created_at");

-- CreateIndex
CREATE INDEX "zendesk_runs_scope_key_created_at_idx" ON "zendesk_runs"("scope_key", "created_at");

-- CreateIndex
CREATE INDEX "zendesk_runs_ticket_id_created_at_idx" ON "zendesk_runs"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "zendesk_runs_status_created_at_idx" ON "zendesk_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "zendesk_ticket_bindings_integration_instance_id_ticket_id_idx" ON "zendesk_ticket_bindings"("integration_instance_id", "ticket_id");

-- CreateIndex
CREATE INDEX "zendesk_ticket_bindings_ticket_id_idx" ON "zendesk_ticket_bindings"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "zendesk_ticket_bindings_scope_key_ticket_id_key" ON "zendesk_ticket_bindings"("scope_key", "ticket_id");

-- AddForeignKey
ALTER TABLE "zendesk_runs"
  ADD CONSTRAINT "zendesk_runs_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zendesk_ticket_bindings"
  ADD CONSTRAINT "zendesk_ticket_bindings_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
