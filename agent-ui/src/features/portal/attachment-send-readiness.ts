export type AttachmentNotReady = { code: "uploading" | "upload_failed" | "not_uploaded"; message: string };

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/**
 * Mirrors WorkspaceFileAttachmentAdapter.send. assistant-ui clears the composer before it
 * awaits that call and drops the whole message when it throws, so a non-null result means
 * sending now would silently lose the user's text and files.
 */
export function attachmentNotReadyReason(attachment: unknown, hasCachedUpload = false): AttachmentNotReady | null {
  const record = asObject(attachment);
  const status = asObject(record?.status)?.type;
  if (status === "complete") return null;
  if (status === "running") {
    return { code: "uploading", message: "Attachment is still uploading. Wait for it to finish before sending." };
  }
  if (status === "incomplete") {
    const uploadError = typeof record?.uploadError === "string" ? record.uploadError : "";
    return { code: "upload_failed", message: uploadError || "Attachment upload failed. Retry or remove the file before sending." };
  }
  if (!record?.uploadedMeta && !hasCachedUpload) {
    return { code: "not_uploaded", message: "Attachment is not ready. Retry or remove the file before sending." };
  }
  return null;
}
