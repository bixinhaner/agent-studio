CREATE TABLE "portal_training_configurations" (
    "organization_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source_email" TEXT NOT NULL,
    "root_folder_name" TEXT NOT NULL,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_training_configurations_pkey" PRIMARY KEY ("organization_id")
);

ALTER TABLE "portal_training_configurations"
ADD CONSTRAINT "portal_training_configurations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portal_training_configurations"
ADD CONSTRAINT "portal_training_configurations_updated_by_user_id_fkey"
FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
