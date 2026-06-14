ALTER TABLE "department_memberships"
  ADD COLUMN "position" TEXT,
  ADD COLUMN "sort_order" INTEGER,
  ADD COLUMN "is_leader" BOOLEAN;

CREATE TABLE "enterprise_user_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "employee_no" TEXT,
  "title" TEXT,
  "mobile" TEXT,
  "telephone" TEXT,
  "avatar_url" TEXT,
  "work_place" TEXT,
  "hired_at" TIMESTAMP(3),
  "manager_dingtalk_user_id" TEXT,
  "manager_user_id" TEXT,
  "is_admin" BOOLEAN,
  "is_boss" BOOLEAN,
  "is_leader" BOOLEAN,
  "extension_json" JSONB,
  "department_positions_json" JSONB,
  "source" TEXT NOT NULL DEFAULT 'dingtalk',
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "enterprise_user_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enterprise_user_profiles_user_id_key" ON "enterprise_user_profiles"("user_id");
CREATE INDEX "enterprise_user_profiles_manager_dingtalk_user_id_idx" ON "enterprise_user_profiles"("manager_dingtalk_user_id");
CREATE INDEX "enterprise_user_profiles_title_idx" ON "enterprise_user_profiles"("title");

ALTER TABLE "enterprise_user_profiles"
  ADD CONSTRAINT "enterprise_user_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
