CREATE TABLE "external_conversation_bindings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "integration_instance_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT,
  "channel" TEXT NOT NULL,
  "external_conversation_key" TEXT NOT NULL,
  "external_conversation_id" TEXT NOT NULL,
  "conversation_type" TEXT NOT NULL,
  "agent_mode_id" TEXT,
  "external_user_id" TEXT,
  "external_union_id" TEXT,
  "external_user_name" TEXT,
  "external_group_id" TEXT,
  "external_group_name" TEXT,
  "bot_id" TEXT,
  "bot_name" TEXT,
  "last_external_message_id" TEXT,
  "last_message_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "external_conversation_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_conversation_bindings_external_conversation_key_key"
  ON "external_conversation_bindings"("external_conversation_key");

CREATE INDEX "external_conversation_bindings_organization_id_channel_updated_at_idx"
  ON "external_conversation_bindings"("organization_id", "channel", "updated_at");

CREATE INDEX "external_conversation_bindings_integration_instance_id_updated_at_idx"
  ON "external_conversation_bindings"("integration_instance_id", "updated_at");

CREATE INDEX "external_conversation_bindings_thread_id_idx"
  ON "external_conversation_bindings"("thread_id");

CREATE INDEX "external_conversation_bindings_user_id_updated_at_idx"
  ON "external_conversation_bindings"("user_id", "updated_at");

CREATE INDEX "external_conversation_bindings_channel_external_conversation_id_idx"
  ON "external_conversation_bindings"("channel", "external_conversation_id");

ALTER TABLE "external_conversation_bindings"
  ADD CONSTRAINT "external_conversation_bindings_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_conversation_bindings"
  ADD CONSTRAINT "external_conversation_bindings_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_conversation_bindings"
  ADD CONSTRAINT "external_conversation_bindings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
