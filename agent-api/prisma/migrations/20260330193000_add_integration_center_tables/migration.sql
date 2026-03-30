-- CreateTable
CREATE TABLE "integration_instances" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT,
  "type" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "is_system_singleton" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_instance_configs" (
  "id" TEXT NOT NULL,
  "integration_instance_id" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_instance_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_instance_secrets" (
  "id" TEXT NOT NULL,
  "integration_instance_id" TEXT NOT NULL,
  "has_secrets" BOOLEAN NOT NULL DEFAULT FALSE,
  "secret_state" JSONB NOT NULL,
  "rotated_at" TIMESTAMP(3),
  "rotated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_instance_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_validation_runs" (
  "id" TEXT NOT NULL,
  "integration_instance_id" TEXT NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" JSONB,
  "detail" JSONB,
  "triggered_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_binding_records" (
  "id" TEXT NOT NULL,
  "integration_instance_id" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "binding_type" TEXT NOT NULL,
  "binding_payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_binding_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_instances_type_slug_key" ON "integration_instances"("type", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "integration_instances_singleton_type_key"
  ON "integration_instances"("type")
  WHERE "type" IN ('dingtalk', 'openai_codex');

-- CreateIndex
CREATE INDEX "integration_instances_type_idx" ON "integration_instances"("type");

-- CreateIndex
CREATE INDEX "integration_instances_organization_id_type_idx" ON "integration_instances"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "integration_instance_configs_integration_instance_id_key" ON "integration_instance_configs"("integration_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_instance_secrets_integration_instance_id_key" ON "integration_instance_secrets"("integration_instance_id");

-- CreateIndex
CREATE INDEX "integration_validation_runs_integration_instance_id_created_at_idx" ON "integration_validation_runs"("integration_instance_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_binding_records_integration_instance_id_created_at_idx" ON "integration_binding_records"("integration_instance_id", "created_at");

-- AddForeignKey
ALTER TABLE "integration_instance_configs"
  ADD CONSTRAINT "integration_instance_configs_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_instance_secrets"
  ADD CONSTRAINT "integration_instance_secrets_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_validation_runs"
  ADD CONSTRAINT "integration_validation_runs_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_binding_records"
  ADD CONSTRAINT "integration_binding_records_integration_instance_id_fkey"
  FOREIGN KEY ("integration_instance_id") REFERENCES "integration_instances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
