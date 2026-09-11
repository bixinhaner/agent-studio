import { useId } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { AssistantRuntimeProvider, ComposerPrimitive, useAuiState, useLocalRuntime, type AttachmentAdapter, type ChatModelAdapter } from "@assistant-ui/react";
import { InlineAttachmentComposer } from "./InlineAttachmentComposer";
import { PortalI18nProvider } from "./i18n";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
});
afterEach(cleanup);
const model: ChatModelAdapter = { async *run() {} };
function Composer() {
  const draftKey = useId();
  const ready = useAuiState(s => s.thread.capabilities.attachments);
  const files = useAuiState(s => s.composer.attachments);
  return <ComposerPrimitive.Root><InlineAttachmentComposer draftKey={draftKey} threadId={draftKey} /><output data-testid="files" data-ready={ready}>{JSON.stringify(files.map(f => ({ id: f.id, name: f.name })))}</output></ComposerPrimitive.Root>;
}
function Harness({ outer, upload }: { outer: boolean; upload(file: File): void }) {
  const adapter: AttachmentAdapter = {
    accept: "*", async *add({ file }) {
      upload(file);
      yield { id: crypto.randomUUID(), name: file.name, type: "document", contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" } };
    }, async send(a) { return { ...a, status: { type: "complete" }, content: [] }; }, async remove() {}
  };
  const runtime = useLocalRuntime(model, { adapters: { attachments: adapter } });
  return <PortalI18nProvider defaultLocale="en" languageSwitcherEnabled={false}><AssistantRuntimeProvider runtime={runtime}>
    {outer ? <ComposerPrimitive.AttachmentDropzone><Composer /></ComposerPrimitive.AttachmentDropzone> : <Composer />}
  </AssistantRuntimeProvider></PortalI18nProvider>;
}
const drop = (files: File[]) => fireEvent.drop(screen.getByRole("textbox", { name: "Message" }), { dataTransfer: { files, types: ["Files"], getData: () => "" } });

describe("inline attachment file drops", () => {
  it.each([false, true])("uploads each file once with outer capture dropzone: %s", async outer => {
    const upload = vi.fn(); render(<Harness outer={outer} upload={upload} />);
    await waitFor(() => expect(screen.getByTestId("files").getAttribute("data-ready")).toBe("true"));
    const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")];
    drop(files);
    await waitFor(() => expect(JSON.parse(screen.getByTestId("files").textContent!)).toHaveLength(2));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(call => call[0])).toEqual(files);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^(one|two)\.txt$/ })).toHaveLength(2));
  });
  it("allows intentionally dropping the same file again in another event", async () => {
    const upload = vi.fn(); render(<Harness outer upload={upload} />);
    await waitFor(() => expect(screen.getByTestId("files").getAttribute("data-ready")).toBe("true"));
    const file = new File(["same content"], "same.txt");
    drop([file]);
    await waitFor(() => expect(JSON.parse(screen.getByTestId("files").textContent!)).toHaveLength(1));
    drop([file]);
    await waitFor(() => expect(JSON.parse(screen.getByTestId("files").textContent!)).toHaveLength(2));
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
