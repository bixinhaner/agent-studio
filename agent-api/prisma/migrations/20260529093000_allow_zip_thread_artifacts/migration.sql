UPDATE "system_settings_versions"
SET "payload" = jsonb_set(
  "payload",
  '{artifactAccess,allowedExtensions}',
  COALESCE("payload"->'artifactAccess'->'allowedExtensions', '[]'::jsonb) || '[".zip"]'::jsonb,
  true
)
WHERE "payload" ? 'artifactAccess'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE("payload"->'artifactAccess'->'allowedExtensions', '[]'::jsonb)) AS allowed(extension)
    WHERE allowed.extension = '.zip'
  );
