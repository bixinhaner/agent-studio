import { type ThreadMessage } from "@assistant-ui/react";
import { parseInlineReferences } from "./inline-references";
import { orderAssistantContentParts } from "./assistant-content-order";
import { consolidateCodexFileChangeParts } from "./file-change-display";
import { asRecord } from "./portal-value-utils";
import {
  fileNameFromUnknown,
  PROMPT_TEXT_MAX_CHARS,
  truncateForPrompt,
  uploadedAttachmentDownloadMetaFromAttachment
} from "./portal-attachment-upload";
import { type ThreadFeedbackOut } from "./portal-api-types";
import { isLikelyHttpUrl } from "./assistant-preview-paths";
import { coerceDate } from "./portal-formatting";

export function extractSources(value: unknown): Array<{ id: string; url: string; title?: string }> {
  const results: Array<{ id: string; url: string; title?: string }> = [];
  const seen = new Set<string>();

  const push = (url: string, title?: string) => {
    const normalized = url.trim();
    if (!normalized || !isLikelyHttpUrl(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push({
      id: `src-${results.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      url: normalized,
      title: title?.trim() || undefined
    });
  };

  const walk = (input: unknown, depth = 0) => {
    if (depth > 4 || results.length >= 8) return;
    if (Array.isArray(input)) {
      for (const item of input) walk(item, depth + 1);
      return;
    }
    if (!input || typeof input !== "object") return;
    const obj = input as Record<string, unknown>;
    const url =
      (typeof obj.url === "string" && obj.url) ||
      (typeof obj.link === "string" && obj.link) ||
      (typeof obj.href === "string" && obj.href) ||
      "";
    const title = typeof obj.title === "string" ? obj.title : typeof obj.name === "string" ? obj.name : undefined;
    if (url) push(url, title);

    for (const key of ["results", "sources", "items", "references", "data", "content", "value"]) {
      if (key in obj) walk(obj[key], depth + 1);
    }
  };

  walk(value);
  return results;
}

export type PromptBucket = {
  textParts: string[];
  imageNames: Set<string>;
  fileNames: Set<string>;
};

export function pushPromptText(bucket: PromptBucket, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  bucket.textParts.push(truncateForPrompt(trimmed, PROMPT_TEXT_MAX_CHARS));
}

export function pushPromptImageName(bucket: PromptBucket, value: unknown, fallback = "Untitled image") {
  bucket.imageNames.add(fileNameFromUnknown(value, fallback));
}

export function pushPromptFileName(bucket: PromptBucket, value: unknown, fallback = "Untitled file") {
  bucket.fileNames.add(fileNameFromUnknown(value, fallback));
}

export function pushPromptFilePart(
  bucket: PromptBucket,
  filePart: { filename?: unknown; mimeType?: unknown; data?: unknown },
  fallbackName: string
) {
  const name = fileNameFromUnknown(filePart.filename, fallbackName);
  pushPromptFileName(bucket, name);
}

export function collectPromptPart(bucket: PromptBucket, part: unknown, fallbackName = "Untitled file") {
  if (!part || typeof part !== "object") return;
  const type = (part as { type?: unknown }).type;
  if (type === "text") {
    pushPromptText(bucket, (part as { text?: unknown }).text);
    return;
  }
  if (type === "image") {
    pushPromptImageName(bucket, (part as { filename?: unknown }).filename, fallbackName);
    return;
  }
  if (type === "file") {
    pushPromptFilePart(bucket, part as { filename?: unknown; mimeType?: unknown; data?: unknown }, fallbackName);
  }
}

export function collectPromptAttachment(bucket: PromptBucket, attachment: unknown) {
  if (!attachment || typeof attachment !== "object") return;
  const att = attachment as { type?: unknown; name?: unknown; content?: unknown };
  const attachmentName = fileNameFromUnknown(att.name, "Untitled file");
  if (att.type === "image") {
    pushPromptImageName(bucket, attachmentName, "Untitled image");
  } else {
    pushPromptFileName(bucket, attachmentName, "Untitled file");
  }

  if (!Array.isArray(att.content)) return;
  for (const part of att.content) {
    collectPromptPart(bucket, part, attachmentName);
  }
}

export function extractLatestPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const role = (msg as { role?: unknown }).role;
    if (role !== "user") continue;

    const bucket: PromptBucket = {
      textParts: [],
      imageNames: new Set<string>(),
      fileNames: new Set<string>()
    };

    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const partObject = asRecord(part);
        if (partObject?.type === "text" && typeof partObject.text === "string") {
          const attachments = sanitizeUserAttachments((msg as { attachments?: unknown }).attachments);
          const resolved = parseInlineReferences(partObject.text).map(piece => {
            if (piece.type === "text") return piece.text;
            if (piece.type === "skill") return piece.name;
            const attachment = attachments.find(item => item.id === piece.id);
            const meta = uploadedAttachmentDownloadMetaFromAttachment(attachment);
            return meta ? `${meta.name} (uploaded_file_id=${meta.id})` : piece.name;
          }).join("");
          collectPromptPart(bucket, { ...partObject, text: resolved });
        } else collectPromptPart(bucket, part);
      }
    }

    const attachments = (msg as { attachments?: unknown }).attachments;
    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        collectPromptAttachment(bucket, attachment);
      }
    }

    const mainText = bucket.textParts.join("\n").trim();
    const attachmentHints: string[] = [];
    if (bucket.imageNames.size > 0) {
      attachmentHints.push(`User uploaded images: ${Array.from(bucket.imageNames).join(", ")}`);
    }
    if (bucket.fileNames.size > 0) {
      attachmentHints.push(`User uploaded files: ${Array.from(bucket.fileNames).join(", ")}`);
    }
    const combined = [mainText, attachmentHints.join("\n")].filter(Boolean).join("\n\n").trim();
    if (combined) return combined;
  }
  return "";
}

export function isBlobFile(value: unknown): value is Blob {
  if (typeof Blob === "undefined") return false;
  return value instanceof Blob;
}

export function sanitizeUserAttachments(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((attachment) => {
      const obj = asRecord(attachment);
      if (!obj) return null;

      const cleaned: Record<string, unknown> = { ...obj };
      if (!isBlobFile(cleaned.file)) {
        delete cleaned.file;
      }

      if (!Array.isArray(cleaned.content)) {
        cleaned.content = [];
      }

      return cleaned;
    })
    .filter((attachment): attachment is Record<string, unknown> => !!attachment);
}

export function sanitizeMessageForPersistence(message: unknown): unknown {
  const obj = asRecord(message);
  if (!obj) return message;

  if (obj.role !== "user") {
    return message;
  }

  return {
    ...obj,
    attachments: sanitizeUserAttachments(obj.attachments)
  };
}

export function findLatestUserMessageForStream(messages: readonly ThreadMessage[]): {
  message: ThreadMessage;
  parentId: string | null;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const previousMessageId = index > 0 ? messages[index - 1]?.id : undefined;
    return {
      message,
      parentId: typeof previousMessageId === "string" && previousMessageId.trim() ? previousMessageId.trim() : null
    };
  }
  return null;
}

export function reviveMessage(message: unknown, persistedCreatedAt?: string | null): unknown {
  const obj = asRecord(message);
  if (!obj) return message;

  const role = typeof obj.role === "string" ? obj.role : "";
  const revived: Record<string, unknown> = { ...obj };

  revived.createdAt = coerceDate(persistedCreatedAt) ?? coerceDate(revived.createdAt) ?? new Date();

  if (!Array.isArray(revived.content)) {
    if (typeof revived.content === "string" && revived.content.trim()) {
      revived.content = [{ type: "text", text: revived.content }];
    } else {
      revived.content = [];
    }
  }

  const metadata = asRecord(revived.metadata) || {};
  const custom = asRecord(metadata.custom) || {};
  const fixedMetadata: Record<string, unknown> = {
    ...metadata,
    custom
  };

  if (role === "assistant") {
    revived.content = orderAssistantContentParts(
      consolidateCodexFileChangeParts(revived.content as unknown[])
    );
    if (!("unstable_state" in fixedMetadata)) fixedMetadata.unstable_state = {};
    if (!Array.isArray(fixedMetadata.unstable_annotations)) fixedMetadata.unstable_annotations = [];
    if (!Array.isArray(fixedMetadata.unstable_data)) fixedMetadata.unstable_data = [];
    if (!Array.isArray(fixedMetadata.steps)) fixedMetadata.steps = [];

    const status = asRecord(revived.status);
    if (!status || typeof status.type !== "string") {
      revived.status = { type: "complete", reason: "unknown" };
    }
  }

  if (role === "user") {
    revived.attachments = sanitizeUserAttachments(revived.attachments);
  }

  revived.metadata = fixedMetadata;
  return revived;
}

export function shouldHydratePortalThreadSkills(input: {
  threadId: string;
  isExternalPortalUser: boolean;
  trainingReadOnly: boolean;
}): boolean {
  return Boolean(input.threadId) && !input.isExternalPortalUser && !input.trainingReadOnly;
}

export function applyStoredFeedback(message: unknown, feedback: ThreadFeedbackOut | undefined): unknown {
  const obj = asRecord(message);
  if (!obj || obj.role !== "assistant" || !feedback) return message;

  const metadata = asRecord(obj.metadata) || {};
  return {
    ...obj,
    metadata: {
      ...metadata,
      submittedFeedback: { type: feedback.type },
      custom: {
        ...(asRecord(metadata.custom) || {}),
        feedback: {
          id: feedback.id,
          type: feedback.type,
          comment: feedback.comment,
          createdAt: feedback.created_at,
          updatedAt: feedback.updated_at
        }
      }
    }
  };
}
