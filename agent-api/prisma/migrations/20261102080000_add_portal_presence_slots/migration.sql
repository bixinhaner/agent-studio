-- Who had the portal open, in 10-minute slots (additive; old code ignores the table).
CREATE TABLE "portal_presence_slots" (
    "user_id" TEXT NOT NULL,
    "slot_start" TIMESTAMP(3) NOT NULL,
    "organization_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "build_id" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "portal_presence_slots_pkey" PRIMARY KEY ("user_id", "slot_start")
);

CREATE INDEX "portal_presence_slots_slot_start_idx" ON "portal_presence_slots"("slot_start");
