ALTER TABLE "threads"
  ADD COLUMN "workspace_trash_batch_id" TEXT;

ALTER TABLE "workspace_nodes"
  ADD COLUMN "trash_batch_id" TEXT,
  ADD COLUMN "trash_root_id" TEXT,
  ADD COLUMN "purge_at" TIMESTAMP(3);

-- Existing trashed folders receive the same 30-day grace period as new ones.
-- Their descendants and conversations are folded into one recoverable batch so
-- deployment does not leave hidden orphan data behind.
WITH RECURSIVE "trashed_roots" AS (
  SELECT "id" AS "root_id", "workspace_id"
  FROM "workspace_nodes" AS "root"
  WHERE "state" = 'trashed'
    AND NOT EXISTS (
      SELECT 1
      FROM "workspace_nodes" AS "parent"
      WHERE "parent"."id" = "root"."parent_id"
        AND "parent"."state" = 'trashed'
    )
), "trash_tree" AS (
  SELECT "root_id", "workspace_id", "root_id" AS "node_id"
  FROM "trashed_roots"
  UNION ALL
  SELECT "tree"."root_id", "tree"."workspace_id", "child"."id"
  FROM "trash_tree" AS "tree"
  JOIN "workspace_nodes" AS "child"
    ON "child"."parent_id" = "tree"."node_id"
   AND "child"."workspace_id" = "tree"."workspace_id"
)
UPDATE "workspace_nodes" AS "node"
SET "state" = 'trashed',
    "trashed_at" = COALESCE("node"."trashed_at", CURRENT_TIMESTAMP),
    "trash_batch_id" = "tree"."root_id",
    "trash_root_id" = CASE WHEN "node"."id" = "tree"."root_id" THEN "tree"."root_id" ELSE NULL END,
    "purge_at" = CURRENT_TIMESTAMP + INTERVAL '30 days'
FROM "trash_tree" AS "tree"
WHERE "node"."id" = "tree"."node_id";

UPDATE "threads" AS "thread"
SET "workspace_trash_batch_id" = "node"."trash_batch_id"
FROM "workspace_nodes" AS "node"
WHERE "thread"."workspace_folder_id" = "node"."id"
  AND "node"."state" = 'trashed'
  AND "node"."trash_batch_id" IS NOT NULL;

CREATE INDEX "threads_workspace_trash_batch_id_idx"
  ON "threads"("workspace_trash_batch_id");

CREATE INDEX "workspace_nodes_workspace_id_trash_batch_id_idx"
  ON "workspace_nodes"("workspace_id", "trash_batch_id");

CREATE INDEX "workspace_nodes_state_purge_at_idx"
  ON "workspace_nodes"("state", "purge_at");
