-- CreateTable
CREATE TABLE "access_requests" (
  "id" TEXT NOT NULL,
  "request_type" TEXT NOT NULL DEFAULT 'trial',
  "commercial_intent" TEXT NOT NULL DEFAULT 'trial',
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "applicant_email" TEXT NOT NULL,
  "applicant_email_domain" TEXT NOT NULL,
  "contact_name" TEXT,
  "company_name" TEXT NOT NULL,
  "country_region" TEXT,
  "device_info_text" TEXT NOT NULL,
  "purchase_date" TIMESTAMP(3),
  "po_number" TEXT NOT NULL,
  "sales_contact_email" TEXT NOT NULL,
  "customer_note" TEXT,
  "admin_note" TEXT,
  "review_summary" TEXT,
  "rejection_reason" TEXT,
  "review_mode" TEXT NOT NULL DEFAULT 'any_to_approve',
  "minimum_approvals" INTEGER,
  "rejection_mode" TEXT NOT NULL DEFAULT 'any_to_reject',
  "owner_user_id" TEXT,
  "requested_plan_id" TEXT,
  "approved_plan_id" TEXT,
  "target_organization_id" TEXT,
  "target_user_id" TEXT,
  "organization_invite_id" TEXT,
  "public_token" TEXT NOT NULL,
  "last_submitted_at" TIMESTAMP(3),
  "review_requested_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "provisioned_at" TIMESTAMP(3),
  "invited_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_request_reviewers" (
  "id" TEXT NOT NULL,
  "access_request_id" TEXT NOT NULL,
  "reviewer_email" TEXT NOT NULL,
  "reviewer_user_id" TEXT,
  "delivery_type" TEXT NOT NULL DEFAULT 'to',
  "decision" TEXT NOT NULL DEFAULT 'pending',
  "comment" TEXT,
  "notified_at" TIMESTAMP(3),
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "access_request_reviewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_request_events" (
  "id" TEXT NOT NULL,
  "access_request_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_email" TEXT,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "access_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_requests_organization_invite_id_key"
  ON "access_requests"("organization_invite_id");
CREATE UNIQUE INDEX "access_requests_public_token_key"
  ON "access_requests"("public_token");
CREATE INDEX "access_requests_status_created_at_idx"
  ON "access_requests"("status", "created_at");
CREATE INDEX "access_requests_sales_contact_email_created_at_idx"
  ON "access_requests"("sales_contact_email", "created_at");
CREATE INDEX "access_requests_applicant_email_created_at_idx"
  ON "access_requests"("applicant_email", "created_at");
CREATE INDEX "access_requests_applicant_email_domain_created_at_idx"
  ON "access_requests"("applicant_email_domain", "created_at");
CREATE INDEX "access_requests_owner_user_id_status_idx"
  ON "access_requests"("owner_user_id", "status");
CREATE INDEX "access_requests_target_organization_id_status_idx"
  ON "access_requests"("target_organization_id", "status");

CREATE UNIQUE INDEX "access_request_reviewers_access_request_id_reviewer_email_key"
  ON "access_request_reviewers"("access_request_id", "reviewer_email");
CREATE INDEX "access_request_reviewers_reviewer_user_id_decision_idx"
  ON "access_request_reviewers"("reviewer_user_id", "decision");
CREATE INDEX "access_request_reviewers_reviewer_email_decision_idx"
  ON "access_request_reviewers"("reviewer_email", "decision");

CREATE INDEX "access_request_events_access_request_id_created_at_idx"
  ON "access_request_events"("access_request_id", "created_at");
CREATE INDEX "access_request_events_event_type_created_at_idx"
  ON "access_request_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_requested_plan_id_fkey"
  FOREIGN KEY ("requested_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_approved_plan_id_fkey"
  FOREIGN KEY ("approved_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_target_organization_id_fkey"
  FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_organization_invite_id_fkey"
  FOREIGN KEY ("organization_invite_id") REFERENCES "organization_invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "access_request_reviewers"
  ADD CONSTRAINT "access_request_reviewers_access_request_id_fkey"
  FOREIGN KEY ("access_request_id") REFERENCES "access_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_request_reviewers"
  ADD CONSTRAINT "access_request_reviewers_reviewer_user_id_fkey"
  FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "access_request_events"
  ADD CONSTRAINT "access_request_events_access_request_id_fkey"
  FOREIGN KEY ("access_request_id") REFERENCES "access_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_request_events"
  ADD CONSTRAINT "access_request_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
