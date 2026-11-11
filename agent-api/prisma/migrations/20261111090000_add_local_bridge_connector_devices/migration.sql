-- Service devices: a Local Bridge client that belongs to an Action Connector
-- instead of a Portal user. Additive only; existing user devices are unchanged.
ALTER TABLE "local_bridge_devices" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "local_bridge_devices" ADD COLUMN "integration_instance_id" TEXT;
CREATE INDEX "local_bridge_devices_integration_instance_id_status_idx" ON "local_bridge_devices"("integration_instance_id", "status");
