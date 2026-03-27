-- CreateTable
CREATE TABLE IF NOT EXISTS "integration_configs" (
    "key" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("key")
);
