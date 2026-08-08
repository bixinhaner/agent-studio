CREATE TABLE "portal_training_translations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "translated_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "portal_training_translations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_training_translations_organization_id_source_type_source_id_locale_key"
ON "portal_training_translations"("organization_id", "source_type", "source_id", "locale");

CREATE INDEX "portal_training_translations_organization_id_locale_updated_at_idx"
ON "portal_training_translations"("organization_id", "locale", "updated_at");

ALTER TABLE "portal_training_translations"
ADD CONSTRAINT "portal_training_translations_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
