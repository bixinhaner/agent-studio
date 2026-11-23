import type { CreateAttachment } from "@assistant-ui/react";

import { attachmentReference, completedAttachment, type InlineAttachment } from "./inline-attachments";
import { parseInlineReferences } from "./inline-references";
import { normalizeUploadedAttachmentDownloadMeta, parseUploadedFileHint } from "./portal-attachment-upload";

/**
 * Queued and steering instructions are plain text: the queue lives in localStorage and the
 * steer API takes one message. Their files are already uploaded to the workspace when they
 * are attached, so the message carries each file as the same `<uploaded_file>` block a
 * regular send gives the model, appended after the text. Views split the blocks off again
 * and show them as file chips; a re-send restores them as completed attachments, so nothing
 * is uploaded twice.
 */
const FILE_BLOCK_PATTERN = /<uploaded_file\b[\s\S]*?<\/uploaded_file>/g;
const ATTACHMENT_REFERENCE_PATTERN = /\[((?:\\.|[^\]\\])*)\]\(attachment:([A-Za-z0-9%_.~-]+)\)/g;

export type MessageWithFiles = { text: string; attachments: CreateAttachment[] };

function fileBlockOf(attachment: Pick<CreateAttachment, "content">): string {
  for (const part of attachment.content ?? []) {
    if (part.type !== "text") continue;
    const block = part.text.match(FILE_BLOCK_PATTERN)?.[0];
    if (block) return block;
  }
  return "";
}

function attachmentFromBlock(block: string): CreateAttachment | null {
  const meta = normalizeUploadedAttachmentDownloadMeta(parseUploadedFileHint(block));
  if (!meta) return null;
  return {
    id: meta.id,
    name: meta.name,
    type: meta.mimeType.toLowerCase().startsWith("image/") ? "image" : "document",
    contentType: meta.mimeType,
    content: [{ type: "text", text: block }]
  };
}

/** Splits a queued or steering message into its text and the uploaded files it carries. */
export function splitMessageFiles(message: string): MessageWithFiles {
  const attachments: CreateAttachment[] = [];
  const seen = new Set<string>();
  for (const block of message.match(FILE_BLOCK_PATTERN) ?? []) {
    const attachment = attachmentFromBlock(block);
    if (!attachment?.id || seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    attachments.push(attachment);
  }
  if (attachments.length === 0) return { text: message, attachments };
  return { text: message.replace(FILE_BLOCK_PATTERN, "").trim(), attachments };
}

/** Appends the files to the text; `splitMessageFiles` reverses it. */
export function joinMessageFiles(text: string, attachments: readonly Pick<CreateAttachment, "content">[]): string {
  const blocks = attachments.map(fileBlockOf).filter(Boolean);
  return [text.trim(), ...blocks].filter(Boolean).join("\n\n");
}

/** Makes every file visible inline: files whose reference was edited away lead the text. */
export function withAttachmentReferences(text: string, attachments: readonly CreateAttachment[]): string {
  const referenced = new Set(
    parseInlineReferences(text).flatMap((part) => (part.type === "attachment" ? [part.id] : []))
  );
  const leading = attachments
    .filter((attachment) => attachment.id && !referenced.has(attachment.id))
    .map((attachment) => attachmentReference(attachment.id!, attachment.name));
  if (leading.length === 0) return text;
  return [leading.join(" "), text].filter(Boolean).join(" ");
}

export type ComposerFilesMessage =
  | { ok: true; message: string }
  | { ok: false; reason: "not_uploaded" };

/**
 * The composer's text and files as one queued or steering message. Files are keyed by their
 * upload id so the restored chips and their references keep matching on any device.
 */
export function composerMessageWithFiles(text: string, attachments: readonly InlineAttachment[]): ComposerFilesMessage {
  if (attachments.length === 0) return { ok: true, message: text.trim() };
  const files: CreateAttachment[] = [];
  const ids = new Map<string, string>();
  for (const attachment of attachments) {
    const completed = completedAttachment(attachment);
    const file = completed ? attachmentFromBlock(fileBlockOf(completed)) : null;
    if (!file?.id) return { ok: false, reason: "not_uploaded" };
    ids.set(attachment.id, file.id);
    files.push({ ...file, name: attachment.name || file.name, type: attachment.type || file.type });
  }
  const rewritten = text.replace(ATTACHMENT_REFERENCE_PATTERN, (reference, escapedName: string, encodedId: string) => {
    let id: string | undefined;
    try { id = ids.get(decodeURIComponent(encodedId)); } catch { return reference; }
    return id ? `[${escapedName}](attachment:${encodeURIComponent(id)})` : reference;
  });
  return { ok: true, message: joinMessageFiles(rewritten, files) };
}

/**
 * The steer text sent to the model: skill chips become their names, while file references
 * stay so the model can tie each mention to its `<uploaded_file>` block (same upload id).
 */
export function steerMessageForServer(message: string): string {
  return parseInlineReferences(message)
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "skill") return part.name;
      return attachmentReference(part.id, part.name);
    })
    .join("");
}
