ALTER TABLE "thread_public_shares"
ADD COLUMN "expires_at" TIMESTAMP(3);

UPDATE "thread_public_shares"
SET "expires_at" = "created_at" + INTERVAL '7 days'
WHERE "expires_at" IS NULL;

ALTER TABLE "thread_public_shares"
ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX "thread_public_shares_expires_at_idx"
ON "thread_public_shares"("expires_at");
