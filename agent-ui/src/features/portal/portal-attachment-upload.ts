import { type PendingAttachment } from "@assistant-ui/core";
import { apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";
import { uploadedAttachmentHint } from "./inline-attachments";
import { THREAD_ATTACHMENT_MAX_BYTES } from "./attachment-upload-messages";
import { asRecord } from "./portal-value-utils";

export const PROMPT_TEXT_MAX_CHARS = 200_000;

export const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/ecmascript",
  "application/x-javascript",
  "application/x-httpd-php",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/sql"
]);

export const TEXT_LIKE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "sh",
  "bash",
  "zsh",
  "py",
  "java",
  "kt",
  "kts",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sql",
  "env",
  "properties",
  "gradle",
  "dockerignore",
  "gitignore",
  "gitattributes"
]);

export const TEXT_LIKE_FILE_NAMES = new Set(["dockerfile", "makefile", "jenkinsfile", "readme", "license", "changelog"]);

export function truncateForPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... (content truncated)`;
}

export function fileNameFromUnknown(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

export function fileExtensionFromName(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function isLikelyTextFile(file: File): boolean {
  const mime = (file.type || "").trim().toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (TEXT_LIKE_MIME_TYPES.has(mime)) return true;

  const name = file.name.trim().toLowerCase();
  if (TEXT_LIKE_FILE_NAMES.has(name)) return true;

  const ext = fileExtensionFromName(name);
  if (!ext) return false;
  return TEXT_LIKE_EXTENSIONS.has(ext);
}

export function guessAttachmentType(file: File): "image" | "document" | "file" {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (isLikelyTextFile(file)) return "document";
  return "file";
}

export type UploadedAttachmentMeta = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  mimeType: string;
  size: number;
};

export type UploadedAttachmentDownloadMeta = Omit<UploadedAttachmentMeta, "path">;

export type UploadFailureCode =
  | "too-large"
  | "size-mismatch"
  | "network"
  | "timeout"
  | "cancelled"
  | "auth"
  | "server"
  | "request"
  | "session"
  | "invalid-response";

export type UploadFailure = Error & {
  uploadFailureCode: UploadFailureCode;
  status?: number;
};

export type WorkspacePendingAttachment = PendingAttachment & {
  uploadError?: string;
  uploadFailureCode?: UploadFailureCode;
  uploadedMeta?: UploadedAttachmentMeta;
};


export function createUploadFailure(code: UploadFailureCode, message: string, status?: number): UploadFailure {
  const failure = new Error(message) as UploadFailure;
  failure.uploadFailureCode = code;
  if (status !== undefined) failure.status = status;
  return failure;
}

export function uploadFailureFromUnknown(error: unknown, fallbackCode: UploadFailureCode = "request"): UploadFailure {
  if (error && typeof error === "object" && "uploadFailureCode" in error) {
    const candidate = error as Partial<UploadFailure>;
    if (candidate.uploadFailureCode) return error as UploadFailure;
  }
  return createUploadFailure(
    fallbackCode,
    error instanceof Error ? error.message : "Attachment upload failed"
  );
}

export function decodeMaybeUri(value: string): string {
  if (!value.trim()) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function uploadAttachmentIdFromRelativePath(value: string): string {
  const fileName = value.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  const match = fileName.match(/^\d+-([a-f0-9]{12})-/i);
  return match?.[1]?.toLowerCase() ?? "";
}

export function uploadedMetaFromUnknown(value: unknown): UploadedAttachmentMeta {
  const obj = asRecord(value);
  if (!obj) {
    throw new Error("Invalid upload response: missing attachment");
  }
  const name = fileNameFromUnknown(decodeMaybeUri(String(obj.name ?? "")), "Untitled file");
  const pathValue = String(obj.path ?? "").trim();
  if (!pathValue) {
    throw new Error("Invalid upload response: missing file path");
  }
  const relativePath = String(obj.relative_path ?? "").trim();
  const mimeType = fileNameFromUnknown(decodeMaybeUri(String(obj.mime_type ?? "")), "application/octet-stream");
  const sizeValue = Number(obj.bytes ?? 0);
  const id =
    String(obj.id ?? "").trim().toLowerCase() ||
    uploadAttachmentIdFromRelativePath(relativePath) ||
    uploadAttachmentIdFromRelativePath(pathValue);
  return {
    id,
    name,
    path: pathValue,
    relativePath: relativePath || pathValue,
    mimeType,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0
  };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function clampUploadProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function createUploadProgressQueue() {
  let closed = false;
  let latest: number | null = null;
  let resolveNext: ((value: number | null) => void) | null = null;

  return {
    push(value: number) {
      if (closed) return;
      const progress = clampUploadProgress(value);
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve(progress);
        return;
      }
      latest = progress;
    },
    close() {
      if (closed) return;
      closed = true;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve(null);
      }
    },
    next(): Promise<number | null> {
      if (latest !== null) {
        const progress = latest;
        latest = null;
        return Promise.resolve(progress);
      }
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
  };
}

export function parseUploadResponse(rawText: string): Record<string, unknown> {
  if (!rawText.trim()) return {};
  try {
    const parsed = JSON.parse(rawText);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export function uploadFailureFromResponse(status: number, rawText: string): UploadFailure {
  const data = parseUploadResponse(rawText);
  const detail = typeof data.detail === "string" ? data.detail.trim() : "";
  if (status === 413) {
    return createUploadFailure(
      "too-large",
      `File is larger than the ${formatFileSize(THREAD_ATTACHMENT_MAX_BYTES)} upload limit.`,
      status
    );
  }
  if (/size\s+does\s+not\s+match|大小.*一致|size.*mismatch/i.test(detail)) {
    return createUploadFailure("size-mismatch", detail || "Upload size does not match the original file.", status);
  }
  if (status === 401 || status === 403) {
    return createUploadFailure("auth", detail || "The upload session is no longer valid.", status);
  }
  if (status >= 500) {
    return createUploadFailure("server", detail || "The upload service is temporarily unavailable.", status);
  }
  return createUploadFailure("request", detail || `Upload failed (${status})`, status);
}

export function uploadThreadAttachment(
  threadId: string,
  file: File,
  options?: {
    onProgress?: (progress: number) => void;
    onRequestStart?: (request: XMLHttpRequest) => void;
  }
): Promise<UploadedAttachmentMeta> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    options?.onRequestStart?.(request);

    request.open("POST", `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/attachments`);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(fileNameFromUnknown(file.name, "upload.bin")));
    request.setRequestHeader("X-File-Type", encodeURIComponent(fileNameFromUnknown(file.type, "application/octet-stream")));
    request.setRequestHeader("X-File-Size", String(file.size));
    for (const [key, value] of Object.entries(authHeaders())) {
      request.setRequestHeader(key, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options?.onProgress?.(Math.min(event.loaded / event.total, 0.99));
      }
    };
    request.onerror = () =>
      reject(createUploadFailure("network", "Network error while uploading attachment."));
    request.ontimeout = () =>
      reject(createUploadFailure("timeout", "Attachment upload timed out."));
    request.onabort = () =>
      reject(createUploadFailure("cancelled", "Attachment upload was cancelled."));
    request.onload = () => {
      const rawText = typeof request.responseText === "string" ? request.responseText : "";
      if (request.status < 200 || request.status >= 300) {
        notifyAuthInvalidStatus(request.status);
        reject(uploadFailureFromResponse(request.status, rawText));
        return;
      }

      try {
        options?.onProgress?.(1);
        const data = parseUploadResponse(rawText);
        resolve(uploadedMetaFromUnknown(data.attachment));
      } catch (error) {
        reject(uploadFailureFromUnknown(error, "invalid-response"));
      }
    };

    request.send(file);
  });
}

export function buildUploadedAttachmentHint(meta: UploadedAttachmentMeta): string {
  return uploadedAttachmentHint(meta);
}

export const UPLOADED_FILE_ATTR_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)=("(?:\\.|[^"\\])*"|[^\s>]+)/g;

export function extractUploadedFileHintAttrs(text: string): string {
  const tagStart = text.search(/<uploaded_file\b/i);
  if (tagStart < 0) return "";
  const tagMatch = text.slice(tagStart).match(/^<uploaded_file\b/i);
  if (!tagMatch) return "";
  const attrsStart = tagStart + tagMatch[0].length;
  let inQuote = false;
  let escaped = false;
  for (let index = attrsStart; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inQuote) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (char === ">" && !inQuote) {
      return text.slice(attrsStart, index).trim();
    }
  }
  return "";
}

export function parseUploadedFileAttrValue(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : String(parsed ?? "");
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseUploadedFileHint(text: string): Record<string, string> | null {
  const rawAttrs = extractUploadedFileHintAttrs(text);
  if (!rawAttrs) return null;
  const attrs: Record<string, string> = {};
  for (const attrMatch of rawAttrs.matchAll(UPLOADED_FILE_ATTR_PATTERN)) {
    const key = attrMatch[1];
    const value = attrMatch[2];
    if (!key || value === undefined) continue;
    attrs[key] = parseUploadedFileAttrValue(value);
  }
  return attrs;
}

export function normalizeUploadedAttachmentDownloadMeta(
  value: unknown,
  fallback?: { name?: unknown; mimeType?: unknown }
): UploadedAttachmentDownloadMeta | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const relativePath = String(obj.relativePath ?? obj.relative_path ?? "").trim();
  if (!relativePath) return null;
  const id = String(obj.id ?? "").trim().toLowerCase() || uploadAttachmentIdFromRelativePath(relativePath);
  if (!id) return null;
  const name = fileNameFromUnknown(obj.name ?? fallback?.name, "Uploaded file");
  const mimeType = fileNameFromUnknown(obj.mimeType ?? obj.mime_type ?? fallback?.mimeType, "application/octet-stream");
  const sizeValue = Number(obj.size ?? obj.bytes ?? 0);
  return {
    id,
    name,
    relativePath,
    mimeType,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0
  };
}

export function uploadedAttachmentDownloadMetaFromAttachment(attachment: unknown): UploadedAttachmentDownloadMeta | null {
  const obj = asRecord(attachment);
  if (!obj) return null;

  const content = Array.isArray(obj.content) ? obj.content : [];
  for (const part of content) {
    const partObj = asRecord(part);
    if (!partObj || partObj.type !== "text" || typeof partObj.text !== "string") continue;
    const hint = parseUploadedFileHint(partObj.text);
    const parsed = normalizeUploadedAttachmentDownloadMeta(hint, {
      name: obj.name,
      mimeType: obj.contentType
    });
    if (parsed) return parsed;
  }

  return null;
}

export function buildUploadedAttachmentDownloadHref(threadId: string, meta: UploadedAttachmentDownloadMeta | null): string {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || !meta?.id || !meta.relativePath) return "";
  const query = new URLSearchParams({ relative_path: meta.relativePath });
  return `${apiBase()}/api/threads/${encodeURIComponent(normalizedThreadId)}/attachments/${encodeURIComponent(meta.id)}/content?${query.toString()}`;
}

export const COMPOSER_ATTACHMENT_SEND_FAILED_EVENT = "bailey-composer-attachment-send-failed";

export type ComposerAttachmentSendFailure = { attachmentId: string; reason: string; detail: string };

export function announceComposerAttachmentSendFailure(detail: ComposerAttachmentSendFailure) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ComposerAttachmentSendFailure>(COMPOSER_ATTACHMENT_SEND_FAILED_EVENT, { detail }));
}
