-- Customer org admins manage their own team. Additive only: older releases ignore these columns/tables.

ALTER TABLE "subscription_plans" ADD COLUMN "max_members" INTEGER;

ALTER TABLE "organizations" ADD COLUMN "team_invite_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "organization_team_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_email" TEXT,
    "target_email" TEXT,
    "target_user_id" TEXT,
    "detail" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_team_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_team_events_organization_id_created_at_idx" ON "organization_team_events"("organization_id", "created_at");
CREATE INDEX "organization_team_events_organization_id_event_type_created_at_idx" ON "organization_team_events"("organization_id", "event_type", "created_at");

ALTER TABLE "organization_team_events" ADD CONSTRAINT "organization_team_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_join_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "public_brand_id" TEXT,
    "email" TEXT NOT NULL,
    "contact_name" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invite_id" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_join_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_join_requests_organization_id_status_idx" ON "organization_join_requests"("organization_id", "status");
CREATE INDEX "organization_join_requests_email_status_idx" ON "organization_join_requests"("email", "status");
CREATE INDEX "organization_join_requests_status_created_at_idx" ON "organization_join_requests"("status", "created_at");

ALTER TABLE "organization_join_requests" ADD CONSTRAINT "organization_join_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
