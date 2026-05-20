ALTER TABLE "zendesk_runs"
  ALTER COLUMN "comment_id" TYPE BIGINT,
  ALTER COLUMN "requester_comment_id" TYPE BIGINT;

ALTER TABLE "zendesk_ticket_bindings"
  ALTER COLUMN "last_processed_requester_comment_id" TYPE BIGINT;
