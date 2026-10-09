import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type AssistantRuntime,
  type AttachmentAdapter,
  type ChatModelAdapter
} from "@assistant-ui/react";

import { attachmentNotReadyReason } from "./attachment-send-readiness";

describe("attachmentNotReadyReason", () => {
  it("lets uploaded and completed attachments through", () => {
    expect(attachmentNotReadyReason({ status: { type: "complete" } })).toBeNull();
    expect(attachmentNotReadyReason({ status: { type: "requires-action" }, uploadedMeta: { id: "f1" } })).toBeNull();
    expect(attachmentNotReadyReason({ status: { type: "requires-action" } }, true)).toBeNull();
  });

  it("blocks attachments that would make the send throw", () => {
    expect(attachmentNotReadyReason({ status: { type: "running" } })?.code).toBe("uploading");
    expect(attachmentNotReadyReason({ status: { type: "incomplete" }, uploadError: "Network error" })).toEqual({
      code: "upload_failed",
      message: "Network error"
    });
    expect(attachmentNotReadyReason({ status: { type: "requires-action" } })?.code).toBe("not_uploaded");
  });
});

// Why the composer checks readiness itself: assistant-ui empties the composer before it awaits
// the attachment adapter, and a throwing adapter drops the whole message without any error.
describe("assistant-ui composer send with an attachment that is not ready", () => {
  it("clears the user's text and sends nothing", async () => {
    const model: ChatModelAdapter = { async *run() { yield { content: [{ type: "text", text: "ok" }] }; } };
    const attachments: AttachmentAdapter = {
      accept: "*",
      async *add({ file }) {
        yield { id: "a1", type: "document", name: file.name, contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" } };
      },
      async send() {
        throw new Error("Attachment is not ready.");
      },
      async remove() {}
    };
    let runtime: AssistantRuntime | undefined;
    function Harness() {
      runtime = useLocalRuntime(model, { adapters: { attachments } });
      return <AssistantRuntimeProvider runtime={runtime}>{null}</AssistantRuntimeProvider>;
    }
    render(<Harness />);
    const composer = runtime!.thread.composer;
    await act(async () => {
      composer.setText("这个是烽火的OLT，帮我看看");
      await composer.addAttachment(new File(["x"], "image.png", { type: "image/png" }));
    });
    await act(async () => {
      // composer.send() calls this same core method and discards its promise, so the app
      // never sees the rejection; call the core directly to observe it here.
      const core = (composer as unknown as { _core: { getState(): { send(): Promise<void> } } })._core.getState();
      await core.send().catch((error: unknown) => {
        expect(String(error)).toMatch(/not ready/);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(composer.getState().text).toBe("");
    expect(composer.getState().attachments).toHaveLength(0);
    expect(runtime!.thread.getState().messages).toHaveLength(0);
  });
});
