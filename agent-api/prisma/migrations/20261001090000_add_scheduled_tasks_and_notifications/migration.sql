-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "mode_id" TEXT,
    "model" TEXT,
    "reasoning_effort" TEXT,
    "run_config" JSONB NOT NULL DEFAULT '{}',
    "skill_ids" JSONB NOT NULL DEFAULT '[]',
    "folder_id" TEXT,
    "source_thread_id" TEXT,
    "frequency" TEXT NOT NULL,
    "weekdays" JSONB NOT NULL DEFAULT '[]',
    "day_of_month" INTEGER,
    "time_of_day" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notify_dingtalk" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_run_status" TEXT,
    "last_thread_id" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_task_runs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "status" TEXT NOT NULL DEFAULT 'running',
    "thread_id" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "answer_preview" TEXT,
    "artifact_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notify_status" TEXT,
    "lease_expires_at" TIMESTAMP(3),

    CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "scenario_key" TEXT,
    "connector_id" TEXT,
    "min_severity" TEXT NOT NULL DEFAULT 'high',
    "delivery_mode" TEXT NOT NULL DEFAULT 'realtime',
    "digest_time" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "channel" TEXT NOT NULL DEFAULT 'dingtalk',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_digest_at" TIMESTAMP(3),
    "last_delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'dingtalk',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_tasks_user_id_created_at_idx" ON "scheduled_tasks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "scheduled_tasks_enabled_next_run_at_idx" ON "scheduled_tasks"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "scheduled_task_runs_task_id_started_at_idx" ON "scheduled_task_runs"("task_id", "started_at");

-- CreateIndex
CREATE INDEX "scheduled_task_runs_status_lease_expires_at_idx" ON "scheduled_task_runs"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "notification_subscriptions_target_type_target_id_idx" ON "notification_subscriptions"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "notification_subscriptions_enabled_source_type_idx" ON "notification_subscriptions"("enabled", "source_type");

-- CreateIndex
CREATE INDEX "notification_deliveries_created_at_idx" ON "notification_deliveries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_user_id_source_type_source_id_chann_key" ON "notification_deliveries"("user_id", "source_type", "source_id", "channel");

-- AddForeignKey
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

