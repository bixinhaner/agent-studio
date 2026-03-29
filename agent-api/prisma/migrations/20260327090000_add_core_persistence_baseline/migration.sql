-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'ended', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "external_id" TEXT,
    "email" TEXT,
    "display_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'employee',
    "status" TEXT NOT NULL DEFAULT 'active',
    "dingtalk_open_id" TEXT,
    "dingtalk_user_id" TEXT,
    "dingtalk_corp_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "title" TEXT,
    "status" "ThreadStatus" NOT NULL DEFAULT 'active',
    "model" TEXT,
    "reasoning_effort" TEXT,
    "workspace" TEXT,
    "codex_run_config" JSONB,
    "head_id" TEXT,
    "feedback" JSONB DEFAULT '[]',
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "external_id" TEXT,
    "role" "MessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "parent_id" TEXT,
    "run_config" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_sessions" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT,
    "user_id" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "provider" TEXT DEFAULT 'codex',
    "external_id" TEXT,
    "metadata" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_dingtalk_user_id_key" ON "users"("dingtalk_user_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "threads_external_id_key" ON "threads"("external_id");

-- CreateIndex
CREATE INDEX "threads_user_id_idx" ON "threads"("user_id");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_thread_id_position_idx" ON "messages"("thread_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "messages_thread_id_external_id_key" ON "messages"("thread_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_sessions_external_id_key" ON "runtime_sessions"("external_id");

-- CreateIndex
CREATE INDEX "runtime_sessions_thread_id_idx" ON "runtime_sessions"("thread_id");

-- CreateIndex
CREATE INDEX "runtime_sessions_user_id_idx" ON "runtime_sessions"("user_id");

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_sessions" ADD CONSTRAINT "runtime_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
