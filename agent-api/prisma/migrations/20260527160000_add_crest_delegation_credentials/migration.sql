CREATE TABLE "crest_delegation_credentials" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider_subject" TEXT,
  "delegation_token" TEXT NOT NULL,
  "delegation_expires_at" TIMESTAMP(3) NOT NULL,
  "delegation_refresh_token" TEXT,
  "delegation_refresh_expires_at" TIMESTAMP(3),
  "last_refreshed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "crest_delegation_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crest_delegation_credentials_user_id_key"
  ON "crest_delegation_credentials"("user_id");

CREATE INDEX "crest_delegation_credentials_delegation_expires_at_idx"
  ON "crest_delegation_credentials"("delegation_expires_at");

CREATE INDEX "crest_delegation_credentials_delegation_refresh_expires_at_idx"
  ON "crest_delegation_credentials"("delegation_refresh_expires_at");

ALTER TABLE "crest_delegation_credentials"
  ADD CONSTRAINT "crest_delegation_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
