-- DingTalk organization sync creates Agent Studio users before those users log in.
-- They still need the internal organization context for bot, policy, and portal flows.
INSERT INTO "organizations" (
  "id",
  "slug",
  "name",
  "type",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  'org_internal',
  'internal',
  'Internal Organization',
  'internal',
  'active',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "organizations"
  WHERE "id" = 'org_internal' OR "slug" = 'internal'
);

WITH target_org AS (
  SELECT "id"
  FROM "organizations"
  WHERE "id" = 'org_internal' OR "slug" = 'internal'
  ORDER BY CASE WHEN "id" = 'org_internal' THEN 0 ELSE 1 END
  LIMIT 1
)
UPDATE "users"
SET
  "primary_organization_id" = (SELECT "id" FROM target_org),
  "updated_at" = NOW()
WHERE "user_type" = 'internal_employee'
  AND "primary_organization_id" IS NULL
  AND (
    "dingtalk_user_id" IS NOT NULL
    OR "last_synced_at" IS NOT NULL
  )
  AND EXISTS (SELECT 1 FROM target_org);

WITH target_org AS (
  SELECT "id"
  FROM "organizations"
  WHERE "id" = 'org_internal' OR "slug" = 'internal'
  ORDER BY CASE WHEN "id" = 'org_internal' THEN 0 ELSE 1 END
  LIMIT 1
)
INSERT INTO "organization_memberships" (
  "id",
  "organization_id",
  "user_id",
  "membership_type",
  "status",
  "joined_at",
  "created_at",
  "updated_at"
)
SELECT
  'membership_' || users."id",
  target_org."id",
  users."id",
  'employee',
  CASE WHEN users."status" = 'active' THEN 'active' ELSE 'disabled' END,
  COALESCE(users."last_synced_at", users."created_at", NOW()),
  NOW(),
  NOW()
FROM "users"
CROSS JOIN target_org
WHERE users."user_type" = 'internal_employee'
  AND (
    users."dingtalk_user_id" IS NOT NULL
    OR users."last_synced_at" IS NOT NULL
  )
ON CONFLICT ("organization_id", "user_id") DO UPDATE
SET
  "membership_type" = CASE
    WHEN "organization_memberships"."membership_type" = 'customer_member' THEN 'employee'
    ELSE "organization_memberships"."membership_type"
  END,
  "status" = EXCLUDED."status",
  "updated_at" = NOW();
