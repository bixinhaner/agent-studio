import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import {
  AssistantRuntimeProvider, ComposerPrimitive, RuntimeAdapterProvider,
  unstable_useRemoteThreadListRuntime, useAui, useAuiState, useLocalRuntime,
  type AttachmentAdapter, type ChatModelAdapter
} from "@assistant-ui/react";
import { InlineAttachmentComposer } from "./InlineAttachmentComposer";
import { usePortalComposerDraftPersistence, usePortalComposerWorkflowController } from "./composer-workflow";
import { PortalI18nProvider } from "./i18n";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  })) });
});
afterEach(() => { cleanup(); window.localStorage.clear(); });
const model: ChatModelAdapter = { async *run() {} };
type Identity = { localId?: string; remoteId?: string };
type RemoteThreadListAdapter = Parameters<typeof unstable_useRemoteThreadListRuntime>[0]["adapter"];
type Workflow = ReturnType<typeof usePortalComposerWorkflowController>["contextValue"];

function UploadProvider({ children, onChange }: PropsWithChildren<{ onChange(identity: Identity): void }>) {
  const aui = useAui();
  const localId = useAuiState(s => s.threadListItem.id);
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  useEffect(() => onChange({ localId, remoteId }), [localId, remoteId, onChange]);
  const attachments = useMemo<AttachmentAdapter>(() => ({
    accept: "*",
    async *add({ file }) {
      const base = { id: "remote-file", name: file.name, type: "document" as const, contentType: "text/markdown", file };
      yield { ...base, status: { type: "running", reason: "uploading", progress: 0 } };
      await aui.threadListItem().initialize();
      yield { ...base, status: { type: "requires-action", reason: "composer-send" } };
    },
    async send(attachment) { return { ...attachment, status: { type: "complete" }, content: [] }; },
    async remove() {}
  }), [aui]);
  return <RuntimeAdapterProvider adapters={{ attachments }}>{children}</RuntimeAdapterProvider>;
}
function Body({ workflow }: { workflow: Workflow }) {
  const aui = useAui();
  const runtimeThreadId = useAuiState(s => s.threadListItem.id);
  const text = useAuiState(s => s.composer.text);
  const attachments = useAuiState(s => s.composer.attachments);
  const restoreText = useCallback((value: string) => aui.composer().setText(value), [aui]);
  usePortalComposerDraftPersistence({ text, threadId: workflow.threadId, runtimeThreadId,
    readDraft: workflow.readDraft, writeDraft: workflow.writeDraft, restoreText });
  return <ComposerPrimitive.Root>
    <button type="button" onClick={() => aui.composer().setText("请读取这个附件：")}>输入正文</button>
    <button type="button" onClick={() => void aui.composer().addAttachment(new File(["test content"], "sample.md"))}>上传</button>
    <InlineAttachmentComposer key={runtimeThreadId} draftKey={workflow.threadId} threadId={workflow.threadId} />
    <output data-testid="state">{JSON.stringify({ text, attachments })}</output>
  </ComposerPrimitive.Root>;
}
function IdentityBridge({ onChange }: { onChange(identity: Identity): void }) {
  const main = useAuiState(s => s.threads.mainThreadId);
  const items = useAuiState(s => s.threads.threadItems);
  const item = items.find(i => i.id === main);
  const localId = item?.id || main;
  const remoteId = item?.remoteId;
  useEffect(() => onChange({ localId, remoteId }), [localId, remoteId, onChange]);
  return null;
}
function Harness({ remount }: { remount: boolean }) {
  const [identity, setIdentity] = useState<Identity>({});
  const onChange = useCallback((next: Identity) => setIdentity(old =>
    old.localId === next.localId && old.remoteId === next.remoteId ? old : next), []);
  const workflow = usePortalComposerWorkflowController({
    userId: "remote-composer-test", activeThreadId: identity.remoteId || "__new_task__",
    onSteer: async () => { throw new Error("not used"); }
  });
  const adapter = useMemo<RemoteThreadListAdapter>(() => ({
    async list() { return { threads: [] }; },
    async initialize(localId) {
      await new Promise(resolve => setTimeout(resolve, 20));
      const remoteId = `created-${remount}`;
      onChange({ localId, remoteId });
      return { remoteId, externalId: localId };
    },
    async rename() {}, async archive() {}, async unarchive() {}, async delete() {},
    async fetch() { throw new Error("not used"); },
    async generateTitle() { throw new Error("not used"); },
    unstable_Provider: ({ children }: PropsWithChildren) => <UploadProvider onChange={onChange}>{children}</UploadProvider>
  }), [onChange, remount]);
  const runtime = unstable_useRemoteThreadListRuntime({ adapter, runtimeHook: () => useLocalRuntime(model) });
  const mountKey = (remount && identity.remoteId) || identity.localId || "empty";
  return <PortalI18nProvider defaultLocale="zh-CN"><AssistantRuntimeProvider runtime={runtime}>
    <IdentityBridge onChange={onChange} /><Body key={mountKey} workflow={workflow.contextValue} />
  </AssistantRuntimeProvider></PortalI18nProvider>;
}

describe("first upload with remote task initialization", () => {
  it.each([false, true])("preserves live prose and the real file when the composer remounts: %s", async remount => {
    render(<Harness remount={remount} />);
    await waitFor(() => expect(document.querySelector('[data-draft-ready="true"]')).not.toBeNull());
    fireEvent.click(screen.getByText("输入正文"));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("请读取这个附件："));
    fireEvent.click(screen.getByText("上传"));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toContain("requires-action"));
    const state = JSON.parse(screen.getByTestId("state").textContent!);
    expect(state.text).toBe("请读取这个附件：[sample.md](attachment:remote-file)");
    expect(state.attachments).toHaveLength(1);
    expect(state.attachments[0].id).toBe("remote-file");
    expect(state.attachments[0].name).toBe("sample.md");
  });
});
