-- CreateTable
CREATE TABLE "department_memberships" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "department_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("user_id", "department_id")
);

-- CreateIndex
CREATE INDEX "department_memberships_user_id_created_at_idx" ON "department_memberships"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
