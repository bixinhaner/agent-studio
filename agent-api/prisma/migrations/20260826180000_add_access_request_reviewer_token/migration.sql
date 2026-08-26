ALTER TABLE "access_request_reviewers"
  ADD COLUMN "review_token_hash" TEXT,
  ADD COLUMN "review_token_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "access_request_reviewers_review_token_hash_key"
  ON "access_request_reviewers"("review_token_hash");
