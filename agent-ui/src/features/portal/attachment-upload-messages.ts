import type { usePortalI18n } from "./i18n";

export const THREAD_ATTACHMENT_MAX_BYTES = 512 * 1024 * 1024;

export function localizedUploadFailureMessage(
  attachment: { uploadFailureCode?: string },
  t: ReturnType<typeof usePortalI18n>["t"]
): string {
  switch (attachment.uploadFailureCode) {
    case "too-large":
      return t("thread.uploadTooLarge", { limit: `${THREAD_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB` });
    case "size-mismatch":
      return t("thread.uploadSizeMismatch");
    case "network":
      return t("thread.uploadNetworkError");
    case "timeout":
      return t("thread.uploadTimeout");
    case "cancelled":
      return t("thread.uploadCancelled");
    case "auth":
      return t("thread.uploadAuthError");
    case "server":
      return t("thread.uploadServerError");
    case "session":
      return t("thread.uploadSessionError");
    case "invalid-response":
      return t("thread.uploadResponseError");
    case "request":
      return t("thread.uploadRequestError");
    default:
      return t("thread.uploadFailedHelp");
  }
}

