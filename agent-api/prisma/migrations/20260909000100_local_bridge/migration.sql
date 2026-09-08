CREATE TABLE "local_bridge_devices" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" TEXT,
  "token_hash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "last_seen_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "local_bridge_devices_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "local_bridge_roots" (
  "id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "label" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "local_bridge_roots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "local_bridge_devices_token_hash_key" ON "local_bridge_devices"("token_hash");
CREATE INDEX "local_bridge_devices_user_id_status_idx" ON "local_bridge_devices"("user_id", "status");
CREATE UNIQUE INDEX "local_bridge_roots_device_id_path_key" ON "local_bridge_roots"("device_id", "path");
ALTER TABLE "local_bridge_devices" ADD CONSTRAINT "local_bridge_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "local_bridge_roots" ADD CONSTRAINT "local_bridge_roots_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "local_bridge_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
