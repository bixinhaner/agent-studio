-- Desktop client version reported by the device; additive, older code ignores it.
ALTER TABLE "local_bridge_devices" ADD COLUMN "client_version" TEXT;
