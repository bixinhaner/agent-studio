import { type FC, type MouseEvent as ReactMouseEvent, useContext, useEffect, useMemo, useState } from "react";
import { AttachmentPrimitive, useAttachment, useAui } from "@assistant-ui/react";
import { AlertCircleIcon, DownloadIcon, EyeIcon, FileIcon, ImageIcon, Loader2Icon, XIcon } from "lucide-react";
import {
  type Attachment,
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
  type ThreadUserMessagePart
} from "@assistant-ui/core";
import { apiBase } from "../../lib/api";
import { reportSendFailure } from "../../lib/send-failure-report";
import { attachmentNotReadyReason } from "./attachment-send-readiness";
import { usePortalI18n } from "./i18n";
import { AttachmentUploadAttempts, takeAttachmentId } from "./inline-attachments";
import { localizedUploadFailureMessage, THREAD_ATTACHMENT_MAX_BYTES } from "./attachment-upload-messages";
import { asRecord } from "./portal-value-utils";
import {
  announceComposerAttachmentSendFailure,
  buildUploadedAttachmentDownloadHref,
  buildUploadedAttachmentHint,
  clampUploadProgress,
  createUploadFailure,
  createUploadProgressQueue,
  fileNameFromUnknown,
  formatFileSize,
  guessAttachmentType,
  uploadedAttachmentDownloadMetaFromAttachment,
  type UploadedAttachmentMeta,
  type UploadFailureCode,
  uploadFailureFromUnknown,
  uploadThreadAttachment,
  type WorkspacePendingAttachment
} from "./portal-attachment-upload";
import {
  ActiveThreadIdContext,
  AttachmentWorkspaceFilesContext,
  ExternalPortalUserContext,
  PreviewRequestContext
} from "./portal-contexts";

export class WorkspaceFileAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  private readonly uploadedByAttachmentId = new Map<string, UploadedAttachmentMeta>();
  private readonly uploadAttempts = new AttachmentUploadAttempts();

  constructor(private readonly resolveThreadId: () => Promise<string>) {}

  public async *add(state: { file: File }): AsyncGenerator<PendingAttachment, void> {
    const name = fileNameFromUnknown(state.file.name, "Untitled file");
    const id = takeAttachmentId(state.file) ?? (
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${name}-${Date.now()}`);
    const baseAttachment: WorkspacePendingAttachment = {
      id,
      type: guessAttachmentType(state.file),
      name,
      contentType: state.file.type || "application/octet-stream",
      file: state.file,
      status: { type: "running", reason: "uploading", progress: 0 }
    };

    if (state.file.size > THREAD_ATTACHMENT_MAX_BYTES) {
      yield {
        ...baseAttachment,
        uploadError: "File exceeds the upload limit.",
        uploadFailureCode: "too-large",
        status: { type: "incomplete", reason: "error" }
      } as WorkspacePendingAttachment;
      return;
    }

    const attempt = this.uploadAttempts.start(id);
    yield baseAttachment;

    const progressQueue = createUploadProgressQueue();
    let uploadThreadId = "";
    const uploadPromise = (async () => {
      const threadId = await this.resolveThreadId();
      uploadThreadId = threadId;
      if (!threadId) {
        throw createUploadFailure("session", "Failed to initialize the current session.");
      }
      if (attempt.cancelled) {
        throw createUploadFailure("cancelled", "Attachment upload was cancelled.");
      }
      return uploadThreadAttachment(threadId, state.file, {
        onProgress: (progress) => progressQueue.push(progress),
        onRequestStart: (request) => {
          attempt.setAbort(() => request.abort());
        }
      });
    })().finally(() => {
      progressQueue.close();
    });

    let lastProgress = 0;
    while (true) {
      const progress = await progressQueue.next();
      if (progress === null) break;
      if (attempt.cancelled) {
        await uploadPromise.catch(() => undefined);
        attempt.finish();
        return;
      }
      if (progress < 1 && progress - lastProgress < 0.01) continue;
      lastProgress = progress;
      yield {
        ...baseAttachment,
        status: { type: "running", reason: "uploading", progress }
      };
    }

    try {
      const uploaded = await uploadPromise;
      if (attempt.cancelled) return;
      this.uploadedByAttachmentId.set(id, uploaded);
      yield {
        ...baseAttachment,
        uploadedMeta: uploaded,
        contentType: uploaded.mimeType,
        status: { type: "requires-action", reason: "composer-send" }
      } as WorkspacePendingAttachment;
    } catch (error) {
      if (attempt.cancelled) return;
      const failure = uploadFailureFromUnknown(error);
      if (failure.uploadFailureCode !== "cancelled") {
        reportSendFailure({
          stage: "attachment_upload",
          threadId: uploadThreadId,
          error,
          errorCode: failure.uploadFailureCode,
          attachments: [{ name, status: "incomplete", failureCode: failure.uploadFailureCode, sizeBytes: state.file.size }]
        });
      }
      yield {
        ...baseAttachment,
        uploadError: failure.message,
        uploadFailureCode: failure.uploadFailureCode,
        status: { type: "incomplete", reason: "error" }
      } as WorkspacePendingAttachment;
    } finally {
      attempt.finish();
    }
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const workspaceAttachment = attachment as WorkspacePendingAttachment;
    // assistant-ui clears the composer before awaiting this call and drops the whole message
    // when it throws, without surfacing the error. The composer checks readiness first
    // (attachmentNotReadyReason); this path announces the loss so the composer can restore it.
    const notReady = attachmentNotReadyReason(workspaceAttachment, this.uploadedByAttachmentId.has(attachment.id));
    if (notReady) {
      announceComposerAttachmentSendFailure({ attachmentId: attachment.id, reason: notReady.code, detail: notReady.message });
      throw new Error(notReady.message);
    }

    const uploaded = workspaceAttachment.uploadedMeta ?? this.uploadedByAttachmentId.get(attachment.id);
    if (!uploaded) {
      throw new Error("Attachment is not ready. Retry or remove the file before sending.");
    }
    this.uploadedByAttachmentId.delete(attachment.id);

    const content: ThreadUserMessagePart[] = [{ type: "text", text: buildUploadedAttachmentHint(uploaded) }];
    const cleanAttachment = { ...workspaceAttachment };
    delete cleanAttachment.uploadError;
    delete cleanAttachment.uploadedMeta;

    return {
      ...cleanAttachment,
      contentType: uploaded.mimeType,
      status: { type: "complete" },
      content
    };
  }

  public async remove(attachment: Attachment) {
    this.uploadAttempts.cancel(attachment.id);
    this.uploadedByAttachmentId.delete(attachment.id);
  }
}

export function attachmentTypeLabel(type: string): string {
  if (type === "image") return "Image";
  if (type === "document") return "Document";
  return "File";
}

export function uploadStatusLabel(attachment: Attachment & { uploadError?: string }): string {
  const status = attachment.status;
  if (status.type === "running") {
    const percent = Math.round(clampUploadProgress(status.progress) * 100);
    return percent >= 100 ? "Finalizing upload..." : `Uploading ${percent}%`;
  }
  if (status.type === "incomplete") {
    return attachment.uploadError || "Upload failed. Retry or remove this file.";
  }
  if (status.type === "requires-action") return "Ready to send";
  return "Uploaded";
}


export const UploadAwareAttachment: FC = () => {
  const aui = useAui();
  const { t } = usePortalI18n();
  const activeThreadId = useContext(ActiveThreadIdContext);
  const isExternalPortalUser = useContext(ExternalPortalUserContext);
  const requestPreview = useContext(PreviewRequestContext);
  const attachmentWorkspaceFiles = useContext(AttachmentWorkspaceFilesContext);
  const attachment = useAttachment(
    (item) => item as Attachment & { source?: string; uploadError?: string; uploadFailureCode?: UploadFailureCode }
  );
  const status = attachment.status;
  const progress = status.type === "running" ? clampUploadProgress(status.progress) : 0;
  const isUploading = status.type === "running";
  const isFailed = status.type === "incomplete";
  const uploadFailureMessage = isFailed
    ? localizedUploadFailureMessage(attachment, t)
    : "";
  const isImage = attachment.type === "image";
  const canRetry = isFailed && attachment.source !== "message" && attachment.file instanceof File;
  const downloadMeta = useMemo(() => uploadedAttachmentDownloadMetaFromAttachment(attachment), [attachment]);
  const workspaceFile = useMemo(
    () => attachmentWorkspaceFiles?.files.find((file) => file.name === downloadMeta?.name) || null,
    [attachmentWorkspaceFiles, downloadMeta?.name]
  );
  const workspaceContentHref = workspaceFile && attachmentWorkspaceFiles
    ? `${apiBase()}${attachmentWorkspaceFiles.apiBasePath}/files/${encodeURIComponent(workspaceFile.id)}/content`
    : "";
  const downloadHref =
    attachment.source === "message" && !isExternalPortalUser
      ? workspaceContentHref
        ? `${workspaceContentHref}?disposition=attachment`
        : buildUploadedAttachmentDownloadHref(activeThreadId, downloadMeta)
      : "";
  const previewPath =
    attachment.source === "message" && !isExternalPortalUser
      ? String(downloadMeta?.relativePath || "").trim()
      : "";

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [remoteThumbnailFailed, setRemoteThumbnailFailed] = useState(false);
  const contentImageUrl = useMemo(() => {
    if (!isImage) return "";
    const parts = Array.isArray((attachment as { content?: unknown }).content)
      ? ((attachment as { content?: unknown[] }).content as unknown[])
      : [];
    for (const part of parts) {
      const item = asRecord(part);
      if (item?.type === "image" && typeof item.image === "string" && item.image.trim()) return item.image.trim();
    }
    return "";
  }, [attachment, isImage]);
  // Sent image attachments show a real thumbnail instead of a generic file icon.
  const remoteThumbnailUrl =
    isImage && attachment.source === "message" && !isExternalPortalUser && !remoteThumbnailFailed
      ? contentImageUrl || workspaceContentHref || buildUploadedAttachmentDownloadHref(activeThreadId, downloadMeta)
      : "";
  const thumbnailUrl = previewUrl || remoteThumbnailUrl;
  useEffect(() => {
    setRemoteThumbnailFailed(false);
  }, [attachment.id]);
  useEffect(() => {
    if (!isImage || !(attachment.file instanceof File)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(attachment.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isImage, attachment.file]);

  const retryUpload = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = attachment.file;
    if (!(file instanceof File)) return;
    void aui
      .composer()
      .attachment({ id: attachment.id })
      .remove()
      .then(() => aui.composer().addAttachment(file))
      .catch(() => {
        // The failed attachment remains visible; the user can remove it manually.
      });
  };

  return (
    <div
      className={`portal-upload-attachment${isImage && thumbnailUrl ? " has-thumbnail" : ""}`}
      data-upload-status={status.type}
      title={isImage && thumbnailUrl ? attachment.name : undefined}
    >
      <div className="portal-upload-card-preview">
        {isImage && thumbnailUrl ? (
          <>
            <img
              className="portal-upload-card-img"
              src={thumbnailUrl}
              alt={attachment.name}
              loading="lazy"
              decoding="async"
              onError={previewUrl ? undefined : () => setRemoteThumbnailFailed(true)}
            />
            {isUploading ? (
              <div className="portal-upload-card-loading">
                <Loader2Icon className="portal-upload-spinner" size={16} />
              </div>
            ) : null}
          </>
        ) : (
          <div className="portal-upload-card-icon">
            {isUploading ? (
              <Loader2Icon className="portal-upload-spinner" size={20} />
            ) : isFailed ? (
              <AlertCircleIcon size={20} />
            ) : isImage ? (
              <ImageIcon size={20} />
            ) : (
              <FileIcon size={20} />
            )}
          </div>
        )}
      </div>
      <div className="portal-upload-card-info">
        <p className="portal-upload-attachment-name">
          <AttachmentPrimitive.Name />
        </p>
        {isUploading ? (
          <div className="portal-upload-progress">
            <span style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
          </div>
        ) : (
          <span className={`portal-upload-status-badge${isFailed ? " portal-upload-status-error" : ""}`}>
            {isFailed ? t("thread.uploadFailedShort") : attachmentTypeLabel(attachment.type)}
          </span>
        )}
      </div>
      {canRetry ? (
        <button
          type="button"
          className="portal-upload-retry-overlay"
          onClick={retryUpload}
          title={uploadFailureMessage}
          aria-label={`${t("common.retry")}: ${uploadFailureMessage}`}
        >
          {t("common.retry")}
        </button>
      ) : null}
      {previewPath && downloadMeta ? (
        <button
          type="button"
          className="portal-upload-preview"
          title={t("files.previewNamed", { name: downloadMeta.name })}
          aria-label={t("files.previewNamed", { name: downloadMeta.name })}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            requestPreview(previewPath, {
              contentUrl: workspaceContentHref || downloadHref,
              downloadUrl: downloadHref,
              displayName: downloadMeta.name,
              mimeType: downloadMeta.mimeType
            });
          }}
        >
          <EyeIcon size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      {downloadHref && downloadMeta ? (
        <a
          className="portal-upload-download"
          href={downloadHref}
          download={downloadMeta.name}
          title={`Download ${downloadMeta.name}${downloadMeta.size ? ` (${formatFileSize(downloadMeta.size)})` : ""}`}
          aria-label={`Download ${downloadMeta.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <DownloadIcon size={12} strokeWidth={2.2} />
        </a>
      ) : null}
      {attachment.source !== "message" ? (
        <AttachmentPrimitive.Remove asChild>
          <button type="button" className="portal-upload-remove" aria-label={`Remove ${attachment.name}`}>
            <XIcon size={11} />
          </button>
        </AttachmentPrimitive.Remove>
      ) : null}
    </div>
  );
};

export const UPLOAD_AWARE_ATTACHMENT_COMPONENTS = { Attachment: UploadAwareAttachment };

export function composerUploadBlockReason(attachments: readonly Attachment[]): "uploading" | "failed" | "" {
  let hasUploading = false;
  for (const attachment of attachments) {
    if (attachment.status.type === "incomplete") return "failed";
    if (attachment.status.type === "running") hasUploading = true;
  }
  return hasUploading ? "uploading" : "";
}
