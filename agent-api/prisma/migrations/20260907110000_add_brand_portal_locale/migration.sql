ALTER TABLE "public_brands"
ADD COLUMN "portal_default_locale" TEXT NOT NULL DEFAULT 'browser',
ADD COLUMN "portal_language_switcher_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "public_brands"
SET
  "portal_default_locale" = 'en',
  "portal_language_switcher_enabled" = false
WHERE "key" = 'ranley';
