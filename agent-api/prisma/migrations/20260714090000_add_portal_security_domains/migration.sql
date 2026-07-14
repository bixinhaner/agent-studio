CREATE TABLE "security_domains" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "security_domains_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_domain_rules" (
    "id" TEXT NOT NULL,
    "security_domain_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "include_children" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "security_domain_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_domain_members" (
    "id" TEXT NOT NULL,
    "security_domain_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "security_domain_members_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "threads" ADD COLUMN "security_domain_id" TEXT;
ALTER TABLE "threads" ADD COLUMN "channel" TEXT;

UPDATE "threads" AS thread
SET "channel" = 'portal'
WHERE EXISTS (
    SELECT 1
    FROM "messages" AS message
    WHERE message."thread_id" = thread."id"
      AND message."run_config"->>'channel' = 'portal'
);

CREATE UNIQUE INDEX "security_domains_organization_id_name_key" ON "security_domains"("organization_id", "name");
CREATE INDEX "security_domains_organization_id_status_idx" ON "security_domains"("organization_id", "status");
CREATE UNIQUE INDEX "security_domain_rules_security_domain_id_subject_type_subject_id_key" ON "security_domain_rules"("security_domain_id", "subject_type", "subject_id");
CREATE INDEX "security_domain_rules_subject_type_subject_id_idx" ON "security_domain_rules"("subject_type", "subject_id");
CREATE UNIQUE INDEX "security_domain_members_user_id_key" ON "security_domain_members"("user_id");
CREATE INDEX "security_domain_members_security_domain_id_created_at_idx" ON "security_domain_members"("security_domain_id", "created_at");
CREATE INDEX "threads_security_domain_id_created_at_idx" ON "threads"("security_domain_id", "created_at");
CREATE INDEX "threads_channel_created_at_idx" ON "threads"("channel", "created_at");

ALTER TABLE "security_domains" ADD CONSTRAINT "security_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_domain_rules" ADD CONSTRAINT "security_domain_rules_security_domain_id_fkey" FOREIGN KEY ("security_domain_id") REFERENCES "security_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_domain_members" ADD CONSTRAINT "security_domain_members_security_domain_id_fkey" FOREIGN KEY ("security_domain_id") REFERENCES "security_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_domain_members" ADD CONSTRAINT "security_domain_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "threads" ADD CONSTRAINT "threads_security_domain_id_fkey" FOREIGN KEY ("security_domain_id") REFERENCES "security_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
