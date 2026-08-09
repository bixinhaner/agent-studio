CREATE TYPE "PortalSteerEventStatus" AS ENUM ('pending', 'accepted', 'failed');

CREATE TABLE "portal_steer_events" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "source_user_message_id" TEXT,
    "turn_id" TEXT,
    "message" TEXT NOT NULL,
    "status" "PortalSteerEventStatus" NOT NULL DEFAULT 'pending',
    "error_code" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_steer_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portal_steer_events_thread_id_created_at_idx"
ON "portal_steer_events"("thread_id", "created_at");

CREATE INDEX "portal_steer_events_user_id_created_at_idx"
ON "portal_steer_events"("user_id", "created_at");

ALTER TABLE "portal_steer_events"
ADD CONSTRAINT "portal_steer_events_thread_id_fkey"
FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
