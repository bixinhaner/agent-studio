import { describe, expect, it } from "vitest";

import { attachmentReference, uploadedAttachmentHint, type InlineAttachment } from "./inline-attachments";
import { skillReference } from "./inline-references";
import {
  composerMessageWithFiles,
  joinMessageFiles,
  splitMessageFiles,
  steerMessageForServer,
  withAttachmentReferences
} from "./message-file-blocks";

const meta = {
  id: "upl_abc123",
  name: "Arabian Gulf City - 25 site list.csv",
  path: "/workspace/uploads/upl_abc123/site-list.csv",
  relativePath: "uploads/upl_abc123/site-list.csv",
  mimeType: "text/csv",
  size: 2048
};

function pendingAttachment(overrides: Partial<InlineAttachment> = {}): InlineAttachment {
  return {
    id: "local-1",
    name: meta.name,
    type: "document",
    contentType: "text/csv",
    status: { type: "requires-action", reason: "composer-send" },
    uploadedMeta: meta,
    ...overrides
  } as InlineAttachment;
}

describe("message file blocks", () => {
  it("carries composer files as upload blocks keyed by upload id", () => {
    const text = `${attachmentReference("local-1", meta.name)} 另外生成新的站点信息`;
    const composed = composerMessageWithFiles(text, [pendingAttachment()]);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.message).toContain(`(attachment:${meta.id})`);
    expect(composed.message).not.toContain("attachment:local-1");
    expect(composed.message).toContain(`path=${JSON.stringify(meta.path)}`);

    const split = splitMessageFiles(composed.message);
    expect(split.text).toBe(`${attachmentReference(meta.id, meta.name)} 另外生成新的站点信息`);
    expect(split.attachments).toEqual([
      expect.objectContaining({ id: meta.id, name: meta.name, contentType: "text/csv", type: "document" })
    ]);
    expect(split.attachments[0].content).toEqual([{ type: "text", text: uploadedAttachmentHint(meta) }]);
  });

  it("refuses files that are not uploaded yet", () => {
    const uploading = pendingAttachment({ uploadedMeta: undefined, status: { type: "running", reason: "uploading", progress: 0.4 } });
    expect(composerMessageWithFiles("hello", [uploading])).toEqual({ ok: false, reason: "not_uploaded" });
  });

  it("keeps text-only messages unchanged", () => {
    expect(composerMessageWithFiles(" just text ", [])).toEqual({ ok: true, message: "just text" });
    expect(splitMessageFiles("just text")).toEqual({ text: "just text", attachments: [] });
  });

  it("keeps the files when only the text is edited", () => {
    const original = joinMessageFiles("old text", [{ content: [{ type: "text", text: uploadedAttachmentHint(meta) }] }]);
    const { attachments } = splitMessageFiles(original);
    const edited = joinMessageFiles("new text", attachments);
    expect(splitMessageFiles(edited)).toMatchObject({ text: "new text", attachments: [{ id: meta.id }] });
  });

  it("puts files whose reference was edited away in front of the text", () => {
    const { attachments } = splitMessageFiles(joinMessageFiles("", [{ content: [{ type: "text", text: uploadedAttachmentHint(meta) }] }]));
    expect(withAttachmentReferences("summarize", attachments)).toBe(`${attachmentReference(meta.id, meta.name)} summarize`);
    const referenced = `${attachmentReference(meta.id, meta.name)} summarize`;
    expect(withAttachmentReferences(referenced, attachments)).toBe(referenced);
  });

  it("sends skills as names but keeps file references for the model", () => {
    const message = `${skillReference("xlsx", "Excel")} ${attachmentReference(meta.id, meta.name)} go\n\n${uploadedAttachmentHint(meta)}`;
    const sent = steerMessageForServer(message);
    expect(sent.startsWith(`Excel ${attachmentReference(meta.id, meta.name)} go`)).toBe(true);
    expect(sent).toContain("<uploaded_file");
  });
});
