import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ActionConnectorAttachmentStore } from "./attachment-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ActionConnectorAttachmentStore", () => {
  it("isolates an attachment by connector, external user, and conversation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "action-connector-attachments-"));
    roots.push(root);
    const store = new ActionConnectorAttachmentStore(root);
    const attachment = await store.upload({
      connectorId: "connector-1",
      externalUserId: "user-1",
      conversationId: "conversation-1",
      filename: "report 报告.txt",
      mimeType: "text/plain; charset=utf-8",
      content: Buffer.from("hello")
    });
    const workspace = path.join(root, "workspace");

    const files = await store.materialize({
      connectorId: "connector-1",
      externalUserId: "user-1",
      conversationId: "conversation-1",
      attachmentIds: [attachment.attachmentId],
      workspacePath: workspace
    });

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: "report 报告.txt", mimeType: "text/plain", sizeBytes: 5 });
    await expect(fs.readFile(files[0]!.absolutePath, "utf8")).resolves.toBe("hello");
    await expect(store.materialize({
      connectorId: "connector-1",
      externalUserId: "user-2",
      conversationId: "conversation-1",
      attachmentIds: [attachment.attachmentId],
      workspacePath: workspace
    })).rejects.toThrow();
  });
});
