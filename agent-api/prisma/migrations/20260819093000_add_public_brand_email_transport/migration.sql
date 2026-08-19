CREATE TABLE "public_brand_email_transports" (
  "public_brand_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'shared',
  "smtp_host" TEXT,
  "smtp_port" INTEGER NOT NULL DEFAULT 587,
  "smtp_security" TEXT NOT NULL DEFAULT 'starttls',
  "smtp_username" TEXT,
  "smtp_password_encrypted" TEXT,
  "verification_status" TEXT NOT NULL DEFAULT 'pending',
  "smtp_connected" BOOLEAN NOT NULL DEFAULT false,
  "sender_accepted" BOOLEAN NOT NULL DEFAULT false,
  "delivery_accepted" BOOLEAN NOT NULL DEFAULT false,
  "last_tested_at" TIMESTAMP(3),
  "last_test_error" TEXT,
  "credentials_rotated_at" TIMESTAMP(3),
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_brand_email_transports_pkey" PRIMARY KEY ("public_brand_id")
);

CREATE INDEX "public_brand_email_transports_mode_verification_status_idx"
  ON "public_brand_email_transports"("mode", "verification_status");

ALTER TABLE "public_brand_email_transports"
  ADD CONSTRAINT "public_brand_email_transports_public_brand_id_fkey"
  FOREIGN KEY ("public_brand_id") REFERENCES "public_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
