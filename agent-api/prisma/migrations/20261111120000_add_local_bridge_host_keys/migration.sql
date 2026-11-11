-- CreateTable
CREATE TABLE "local_bridge_host_keys" (
    "id" TEXT NOT NULL,
    "integration_instance_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_bridge_host_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_bridge_host_keys_key_hash_key" ON "local_bridge_host_keys"("key_hash");

-- CreateIndex
CREATE INDEX "local_bridge_host_keys_integration_instance_id_idx" ON "local_bridge_host_keys"("integration_instance_id");
