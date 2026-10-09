-- Additive only: permanent local-computer operation log and workspace switch history.
CREATE TABLE "local_bridge_operation_logs" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT,
    "user_id" TEXT,
    "device_id" TEXT NOT NULL,
    "device_name" TEXT,
    "platform" TEXT,
    "binding_id" TEXT,
    "root_id" TEXT,
    "root_path" TEXT,
    "root_label" TEXT,
    "source" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "local_bridge_operation_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "local_bridge_operation_logs_thread_id_created_at_idx" ON "local_bridge_operation_logs"("thread_id", "created_at");

CREATE TABLE "local_bridge_binding_events" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "from_root_id" TEXT,
    "from_path" TEXT,
    "from_label" TEXT,
    "from_device_id" TEXT,
    "from_device_name" TEXT,
    "from_platform" TEXT,
    "to_root_id" TEXT,
    "to_path" TEXT,
    "to_label" TEXT,
    "to_device_id" TEXT,
    "to_device_name" TEXT,
    "to_platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "local_bridge_binding_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "local_bridge_binding_events_thread_id_created_at_idx" ON "local_bridge_binding_events"("thread_id", "created_at");

-- Current bindings become the first known event, dated when they were bound.
INSERT INTO "local_bridge_binding_events" ("id", "thread_id", "user_id", "kind", "to_root_id", "to_path", "to_label", "to_device_id", "to_device_name", "to_platform", "created_at")
SELECT 'backfill-' || b."id", b."thread_id", d."user_id", 'bound', r."id", r."path", r."label", d."id", d."name", d."platform", b."created_at"
FROM "local_bridge_bindings" b
JOIN "local_bridge_roots" r ON r."id" = b."root_id"
JOIN "local_bridge_devices" d ON d."id" = r."device_id";

-- Commands still in the 24h delivery queue (completed ones have empty args).
INSERT INTO "local_bridge_operation_logs" ("id", "thread_id", "user_id", "device_id", "device_name", "platform", "binding_id", "root_id", "root_path", "root_label", "source", "op", "args", "status", "result", "created_at")
SELECT c."id", c."thread_id", d."user_id", c."device_id", d."name", d."platform", c."binding_id", c."root_id", r."path", r."label", 'backfill', c."op", c."args",
       CASE WHEN c."status" IN ('pending', 'leased') THEN 'pending' ELSE c."status" END, c."result", c."created_at"
FROM "local_bridge_commands" c
JOIN "local_bridge_devices" d ON d."id" = c."device_id"
LEFT JOIN "local_bridge_roots" r ON r."id" = c."root_id"
WHERE c."op" <> 'cancel_task';
