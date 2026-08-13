-- Historical violations are repaired and backed up by recover-message-graphs
-- before deployment. These constraints make the same invariants durable for
-- every channel, including Portal, DingTalk, Zendesk, CREST, and connectors.
CREATE UNIQUE INDEX "messages_thread_id_position_key"
ON "messages"("thread_id", "position");

ALTER TABLE "messages"
ADD CONSTRAINT "messages_thread_id_parent_id_fkey"
FOREIGN KEY ("thread_id", "parent_id")
REFERENCES "messages"("thread_id", "external_id")
ON DELETE NO ACTION
ON UPDATE NO ACTION
DEFERRABLE INITIALLY DEFERRED;
