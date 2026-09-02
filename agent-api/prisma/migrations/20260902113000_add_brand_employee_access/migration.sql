ALTER TABLE "public_brands"
ADD COLUMN "employee_email_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "employee_organization_id" TEXT;

CREATE INDEX "public_brands_employee_organization_id_idx"
ON "public_brands"("employee_organization_id");
