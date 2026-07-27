UPDATE "workspace_nodes"
SET
  "name" = 'History',
  "normalized_name" = 'history',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'history_unfiled';
