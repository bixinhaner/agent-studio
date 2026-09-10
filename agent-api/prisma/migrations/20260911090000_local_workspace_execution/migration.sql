CREATE TABLE "local_bridge_connections" (
 "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "token_hash" TEXT NOT NULL UNIQUE,
 "expires_at" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
 "device_id" TEXT, "root_id" TEXT, "return_url" TEXT, "thread_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "local_bridge_connections_expires_at_idx" ON "local_bridge_connections"("expires_at");
CREATE TABLE "local_bridge_bindings" (
 "id" TEXT PRIMARY KEY, "thread_id" TEXT NOT NULL UNIQUE REFERENCES "threads"("id") ON DELETE CASCADE,
 "root_id" TEXT NOT NULL REFERENCES "local_bridge_roots"("id") ON DELETE CASCADE,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "local_bridge_commands" (
 "id" TEXT PRIMARY KEY, "device_id" TEXT NOT NULL REFERENCES "local_bridge_devices"("id") ON DELETE CASCADE,
 "thread_id" TEXT, "binding_id" TEXT, "root_id" TEXT, "op" TEXT NOT NULL, "args" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "lease" TEXT, "lease_until" TIMESTAMP(3), "result" JSONB,
 "deadline" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "local_bridge_commands_device_id_status_created_at_idx" ON "local_bridge_commands"("device_id", "status", "created_at");
CREATE INDEX "local_bridge_commands_deadline_idx" ON "local_bridge_commands"("deadline");
