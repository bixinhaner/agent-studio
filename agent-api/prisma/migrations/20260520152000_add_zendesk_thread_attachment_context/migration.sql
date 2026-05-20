ALTER TABLE "zendesk_ticket_bindings"
  ADD COLUMN "codex_thread_id" TEXT,
  ADD COLUMN "workspace_path" TEXT;

CREATE INDEX "zendesk_ticket_bindings_codex_thread_id_idx"
  ON "zendesk_ticket_bindings"("codex_thread_id");
