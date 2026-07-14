CREATE TABLE "security_domain_access_policies" (
    "organization_id" TEXT NOT NULL,
    "password_digest" TEXT NOT NULL,
    "password_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "security_domain_access_policies_pkey" PRIMARY KEY ("organization_id")
);

ALTER TABLE "security_domain_access_policies"
ADD CONSTRAINT "security_domain_access_policies_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
