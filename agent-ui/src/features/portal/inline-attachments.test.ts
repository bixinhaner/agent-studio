import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { attachmentReference, parseInlineAttachments, inlineAttachmentPlainText, missingInlineAttachments,
  completedAttachment, makeAttachmentDraft, writeAttachmentDraft, readAttachmentDraft, reserveAttachmentId, takeAttachmentId,
  AttachmentUploadAttempts, type InlineAttachment } from "./inline-attachments";

const ready: InlineAttachment = {
  id: "client-a", type: "document", name: "table.xlsx", contentType: "application/xlsx",
  file: new File(["sheet"], "table.xlsx", { type: "application/xlsx" }),
  status: { type: "requires-action", reason: "composer-send" },
  uploadedMeta: { id: "server-a", name: "table.xlsx", path: "/workspace/table.xlsx", relativePath: "uploads/table.xlsx", mimeType: "application/xlsx", size: 12 }
};
describe("inline attachment message contract", () => {
  it("round trips Chinese, brackets and backslashes without confusing surrounding prose", () => {
    const name = "测试[最终]\\台账.xlsx";
    const text = "根据 " + attachmentReference("a/b", name) + "，更新。\n保留换行";
    expect(parseInlineAttachments(text)).toEqual([
      { type: "text", text: "根据 " }, { type: "attachment", id: "a/b", name }, { type: "text", text: "，更新。\n保留换行" }
    ]);
    expect(inlineAttachmentPlainText(text)).toBe("根据 " + name + "，更新。\n保留换行");
  });
  it("keeps duplicate filenames distinguishable by attachment identity and preserves sentence order", () => {
    const text = attachmentReference("a", "test.csv") + " 与 " + attachmentReference("b", "test.csv");
    expect(parseInlineAttachments(text).filter(part => part.type === "attachment").map(part => part.id)).toEqual(["a", "b"]);
  });
  it("does not transform ordinary markdown links or malformed encoded ids", () => {
    const text = "[website](https://example.org) [file](attachment:%XX)";
    expect(parseInlineAttachments(text)).toEqual([{ type: "text", text }]);
  });
  it("blocks a visible reference with no corresponding actual attachment", () => {
    const text = attachmentReference("client-a", "table.xlsx");
    expect(missingInlineAttachments(text, [])).toBe(true);
    expect(missingInlineAttachments(text, [ready])).toBe(false);
  });
  it("restores a ready upload with the original server hint, not a filename-only placeholder", () => {
    const stored = completedAttachment(ready)!;
    expect(stored.id).toBe("client-a");
    expect(stored.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('id="server-a"') });
    expect(stored.content[0]).toMatchObject({ text: expect.stringContaining('path="/workspace/table.xlsx"') });
  });
  it("stores incomplete uploads as files and ready uploads as reusable descriptors", () => {
    const file = new File(["draft"], "draft.txt", { type: "text/plain" });
    const pending: InlineAttachment = { id: "pending", type: "document", name: file.name, contentType: file.type, file, status: { type: "running", reason: "uploading", progress: 0.3 } };
    const draft = makeAttachmentDraft("text", [pending, ready]);
    expect(draft.attachments[0].file).toBe(file);
    expect(draft.attachments[1].attachment?.id).toBe("client-a");
    expect(completedAttachment(pending)).toBeNull();
  });
  it("persists by user and thread, and clears an accepted message draft", async () => {
    const draft = makeAttachmentDraft(attachmentReference("client-a", "table.xlsx"), [ready]);
    await writeAttachmentDraft("user-a:thread-a", draft);
    expect((await readAttachmentDraft("user-a:thread-a"))?.text).toBe(draft.text);
    expect(await readAttachmentDraft("user-b:thread-a")).toBeUndefined();
    expect(await readAttachmentDraft("user-a:thread-b")).toBeUndefined();
    await writeAttachmentDraft("user-a:thread-a", makeAttachmentDraft("", []));
    expect(await readAttachmentDraft("user-a:thread-a")).toBeUndefined();
  });
  it("consumes a restored upload identity exactly once", () => {
    const file = new File(["x"], "x.txt");
    reserveAttachmentId(file, "pending-original");
    expect(takeAttachmentId(file)).toBe("pending-original");
    expect(takeAttachmentId(file)).toBeUndefined();
  });
  it("an old upload finishing cannot cancel or detach a replacement with the same id", () => {
    const uploads = new AttachmentUploadAttempts();
    const old = uploads.start("same-id");
    const abortOld = vi.fn(); old.setAbort(abortOld);
    uploads.cancel("same-id");
    const replacement = uploads.start("same-id");
    const abortReplacement = vi.fn(); replacement.setAbort(abortReplacement);
    old.finish();
    expect(old.cancelled).toBe(true);
    expect(replacement.cancelled).toBe(false);
    expect(abortOld).toHaveBeenCalledOnce();
    expect(abortReplacement).not.toHaveBeenCalled();
    uploads.cancel("same-id");
    expect(abortReplacement).toHaveBeenCalledOnce();
  });
  it("cancels an upload removed before its request is created", () => {
    const uploads = new AttachmentUploadAttempts();
    const attempt = uploads.start("waiting-for-thread");
    uploads.cancel("waiting-for-thread");
    const abort = vi.fn(); attempt.setAbort(abort);
    expect(abort).toHaveBeenCalledOnce();
    expect(attempt.cancelled).toBe(true);
  });
});
