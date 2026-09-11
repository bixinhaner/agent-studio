import type { Attachment, CreateAttachment } from "@assistant-ui/react";

export type InlinePart = { type: "text"; text: string } | { type: "attachment"; id: string; name: string };
const referencePattern = /\[((?:\\.|[^\]\\])*)\]\(attachment:([A-Za-z0-9%_.~-]+)\)/g;

export function attachmentReference(id: string, name: string): string {
  return `[${name.replace(/[\r\n]/g, " ").replace(/[\\[\]]/g, "\\$&")}](attachment:${encodeURIComponent(id)})`;
}

export function parseInlineAttachments(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let offset = 0;
  for (const match of text.matchAll(referencePattern)) {
    let id: string;
    try { id = decodeURIComponent(match[2]); } catch { continue; }
    if (!id || id.length > 200) continue;
    if (match.index! > offset) parts.push({ type: "text", text: text.slice(offset, match.index) });
    parts.push({ type: "attachment", id, name: match[1].replace(/\\(.)/g, "$1") });
    offset = match.index! + match[0].length;
  }
  if (offset < text.length) parts.push({ type: "text", text: text.slice(offset) });
  return parts;
}

export function inlineAttachmentIds(text: string): Set<string> {
  return new Set(parseInlineAttachments(text).flatMap(part => part.type === "attachment" ? [part.id] : []));
}

export function inlineAttachmentPlainText(text: string): string {
  return parseInlineAttachments(text).map(part => part.type === "text" ? part.text : part.name).join("");
}

export function missingInlineAttachments(text: string, attachments: readonly Attachment[]): boolean {
  const ids = new Set(attachments.map(item => item.id));
  return [...inlineAttachmentIds(text)].some(id => !ids.has(id));
}

export type UploadMeta = { id: string; name: string; path: string; relativePath: string; mimeType: string; size: number };
export type InlineAttachment = Attachment & { uploadedMeta?: UploadMeta; uploadError?: string; uploadFailureCode?: string };

export function uploadedAttachmentHint(meta: UploadMeta): string {
  return [
    `<uploaded_file id=${JSON.stringify(meta.id)} name=${JSON.stringify(meta.name)} path=${JSON.stringify(meta.path)} relativePath=${JSON.stringify(meta.relativePath)} mimeType=${JSON.stringify(meta.mimeType)} bytes=${meta.size}>`,
    "The file has been uploaded to the workspace. Use filesystem tools to read this path instead of assuming the content is already in context.",
    "</uploaded_file>"
  ].join("\n");
}

export function completedAttachment(attachment: InlineAttachment): CreateAttachment | null {
  const content = attachment.status.type === "complete" ? attachment.content
    : attachment.uploadedMeta ? [{ type: "text" as const, text: uploadedAttachmentHint(attachment.uploadedMeta) }] : null;
  if (!content) return null;
  return { id: attachment.id, name: attachment.name, type: attachment.type, contentType: attachment.contentType, content };
}

// Restored uploads keep their reference identity even when the File is cloned by IndexedDB.
const restoredFileIds = new WeakMap<File, string>();
export function reserveAttachmentId(file: File, id: string): void { restoredFileIds.set(file, id); }
export function takeAttachmentId(file: File): string | undefined {
  const id = restoredFileIds.get(file);
  restoredFileIds.delete(file);
  return id;
}

/** Each retry owns its cancellation state, even when undo reuses the same chip id. */
export class AttachmentUploadAttempts {
  private active = new Map<string, { cancelled: boolean; abort?(): void }>();
  start(id: string) {
    this.cancel(id);
    const attempt = { cancelled: false, abort: undefined as (() => void) | undefined };
    this.active.set(id, attempt);
    return {
      get cancelled() { return attempt.cancelled; },
      setAbort: (abort: () => void) => { attempt.abort = abort; if (attempt.cancelled) abort(); },
      finish: () => { if (this.active.get(id) === attempt) this.active.delete(id); }
    };
  }
  cancel(id: string) {
    const attempt = this.active.get(id);
    if (!attempt) return;
    attempt.cancelled = true;
    this.active.delete(id);
    attempt.abort?.();
  }
}

export type AttachmentDraft = { text: string; attachments: Array<{ attachment?: CreateAttachment; file?: File; id: string }>; updatedAt: number };
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("bailey-composer-attachments", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}
export async function readAttachmentDraft(key: string): Promise<AttachmentDraft | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function writeAttachmentDraft(key: string, draft: AttachmentDraft): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    const store = transaction.objectStore("drafts");
    if (!draft.text && !draft.attachments.length) store.delete(key);
    else store.put(draft, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export function makeAttachmentDraft(text: string, attachments: readonly InlineAttachment[]): AttachmentDraft {
  return {
    text, updatedAt: Date.now(),
    attachments: attachments.map(item => {
      const attachment = completedAttachment(item);
      return attachment ? { id: item.id, attachment } : { id: item.id, file: item.file };
    })
  };
}
