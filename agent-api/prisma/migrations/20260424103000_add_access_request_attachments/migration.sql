-- CreateTable
CREATE TABLE "access_request_attachments" (
  "id" TEXT NOT NULL,
  "access_request_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'purchase_proof',
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "storage_path" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "access_request_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_request_attachments_access_request_id_kind_created_at_idx"
  ON "access_request_attachments"("access_request_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "access_request_attachments"
  ADD CONSTRAINT "access_request_attachments_access_request_id_fkey"
  FOREIGN KEY ("access_request_id") REFERENCES "access_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
