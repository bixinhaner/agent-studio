-- Blue-green chat: record which chat instance processes a run so restart
-- recovery only reclaims runs whose instance is gone. Nullable: older
-- releases keep working without it.
ALTER TABLE "zendesk_runs" ADD COLUMN "owner_instance_id" TEXT;
