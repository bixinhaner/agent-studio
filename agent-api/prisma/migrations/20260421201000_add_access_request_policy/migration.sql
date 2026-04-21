CREATE TABLE "access_request_policies" (
    "id" TEXT NOT NULL,
    "policy_key" TEXT NOT NULL DEFAULT 'global',
    "internal_email_domains" TEXT[] NOT NULL DEFAULT ARRAY['baicells.com']::TEXT[],
    "public_email_blocklist_extra" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "default_trial_days" INTEGER NOT NULL DEFAULT 14,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_request_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_request_policies_policy_key_key" ON "access_request_policies"("policy_key");
