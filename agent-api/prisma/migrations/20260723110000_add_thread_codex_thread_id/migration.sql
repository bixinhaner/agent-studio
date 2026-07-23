ALTER TABLE "threads"
ADD COLUMN "codex_thread_id" TEXT;

WITH latest_per_thread AS (
  SELECT DISTINCT ON (session."thread_id")
    session."thread_id",
    NULLIF(session."metadata"->>'codexThreadId', '') AS "codex_thread_id",
    session."updated_at"
  FROM "runtime_sessions" AS session
  WHERE NULLIF(session."metadata"->>'codexThreadId', '') IS NOT NULL
  ORDER BY session."thread_id", session."updated_at" DESC
),
unique_bindings AS (
  SELECT
    latest."thread_id",
    latest."codex_thread_id",
    ROW_NUMBER() OVER (
      PARTITION BY latest."codex_thread_id"
      ORDER BY latest."updated_at" DESC, latest."thread_id"
    ) AS "binding_rank"
  FROM latest_per_thread AS latest
)
UPDATE "threads" AS thread
SET "codex_thread_id" = binding."codex_thread_id"
FROM unique_bindings AS binding
WHERE binding."thread_id" = thread."id"
  AND binding."binding_rank" = 1
  AND thread."codex_thread_id" IS NULL;

CREATE UNIQUE INDEX "threads_codex_thread_id_key"
ON "threads"("codex_thread_id");
