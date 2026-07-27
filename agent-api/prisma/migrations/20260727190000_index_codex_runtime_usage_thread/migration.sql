CREATE INDEX "usage_events_codex_runtime_thread_feature_created_idx"
ON "usage_events" (
  COALESCE(
    "metadata" -> '_codexRuntimeUsage' ->> 'codexThreadId',
    "metadata" ->> 'codexThreadId'
  ),
  "feature_type",
  "created_at" DESC
)
WHERE "metadata" -> '_codexRuntimeUsage' IS NOT NULL;
