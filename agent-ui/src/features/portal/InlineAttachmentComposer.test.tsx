import { useCallback } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, ActionBarPrimitive, useAui, useAuiState, useLocalRuntime, type ChatModelAdapter, type CreateAttachment } from "@assistant-ui/react";
import { InlineAttachmentComposer, InlineAttachmentEditComposer, InlineFileChip } from "./InlineAttachmentComposer";
import { $getRoot, getNearestEditorFromDOMNode } from "lexical";
import { attachmentReference, makeAttachmentDraft, writeAttachmentDraft, missingInlineAttachments } from "./inline-attachments";
import { usePortalComposerDraftPersistence } from "./composer-workflow";
import { PortalI18nProvider } from "./i18n";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);
const file: CreateAttachment = { id: "real-file", name: "文档.md", type: "document", contentType: "text/markdown", content: [{ type: "text", text: '<uploaded_file id="server-file" path="/uploads/文档.md">real file</uploaded_file>' }] };
const sentence = "根据 " + attachmentReference(file.id!, file.name) + "，完成任务。\n保留原有换行";
const model: ChatModelAdapter = { async *run() { yield { content: [{ type: "text", text: "done" }] }; } };
const drafts: Record<string, string> = {};
const EmptyAssistantMessage = () => null;
const EditableUserMessage = () => <ActionBarPrimitive.Edit>Edit message</ActionBarPrimitive.Edit>;
const MessageEditComposer = () => <InlineAttachmentEditComposer draftKey="edit-message-fixture" threadId="edit-thread" />;
function Body({ scope }: { scope: string }) {
  const aui = useAui();
  const runtimeThreadId = useAuiState(s => s.threadListItem.id);
  const text = useAuiState(s => s.composer.text);
  const attachments = useAuiState(s => s.composer.attachments);
  const messages = useAuiState(s => s.thread.messages);
  const readDraft = useCallback(() => drafts[scope] ?? "", [scope]);
  const writeDraft = useCallback((value: string) => { drafts[scope] = value; }, [scope]);
  const restoreText = useCallback((value: string) => aui.composer().setText(value), [aui]);
  // LocalRuntime has no list item id; production's RemoteThreadList supplies this stable id.
  usePortalComposerDraftPersistence({ text, threadId: scope, runtimeThreadId: runtimeThreadId || "local-runtime-fixture", readDraft, writeDraft, restoreText });
  return <>
    <button onClick={() => { aui.composer().setText(sentence); void aui.composer().addAttachment(file); }}>sample</button>
    <button onClick={() => aui.composer().setText("newer draft")}>newer</button>
    <ComposerPrimitive.Root onSubmit={event => { if (missingInlineAttachments(text, attachments)) event.preventDefault(); }}>
      <InlineAttachmentComposer draftKey={scope} threadId={scope} />
      <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
    <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{ UserMessage: EditableUserMessage, AssistantMessage: EmptyAssistantMessage, EditComposer: MessageEditComposer }} /></ThreadPrimitive.Root>
    <output data-testid="state">{JSON.stringify({ text, attachments, messages })}</output>
  </>;
}
function Harness({ scope }: { scope: string }) {
  const runtime = useLocalRuntime(model);
  return <PortalI18nProvider defaultLocale="zh-CN"><AssistantRuntimeProvider runtime={runtime}><Body scope={scope} /></AssistantRuntimeProvider></PortalI18nProvider>;
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!);
const hydrated = () => waitFor(() => expect(document.querySelector('[data-draft-ready="true"]')).not.toBeNull());

describe("inline attachment editor with the existing composer runtime", () => {
  it("removes the actual attachment and undo restores its identity and file content", async () => {
    render(<Harness scope="editor-undo" />); await hydrated();
    fireEvent.click(screen.getByText("sample"));
    fireEvent.click(await screen.findByRole("button", { name: "文档.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "移除附件" }));
    await waitFor(() => expect(state().attachments).toHaveLength(0));
    const editor = screen.getByRole("textbox", { name: "消息" });
    fireEvent.keyDown(editor, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => expect(state().attachments).toHaveLength(1));
    expect(state().attachments[0].id).toBe(file.id);
    expect(state().attachments[0].content).toEqual(file.content);
    expect(state().text).toBe(sentence);
  });
  it("restores inline positions and actual files alongside legacy text draft hydration", async () => {
    drafts["editor-restore"] = sentence;
    await writeAttachmentDraft("editor-restore", makeAttachmentDraft(sentence, [{ ...file, id: file.id!, type: "document", status: { type: "complete" } }]));
    const view = render(<Harness scope="editor-restore" />); await hydrated();
    await screen.findByRole("button", { name: "文档.md" });
    expect(state().text).toBe(sentence);
    expect(state().attachments[0].id).toBe(file.id);
    view.unmount();
    render(<Harness scope="editor-other-thread" />); await hydrated();
    expect(state().text).toBe("");
    expect(state().attachments).toEqual([]);
  });
  it("first Backspace selects the chip and second Backspace removes the real file", async () => {
    render(<Harness scope="editor-backspace" />); await hydrated();
    fireEvent.click(screen.getByText("sample"));
    await screen.findByRole("button", { name: "文档.md" });
    const editable = screen.getByRole("textbox", { name: "消息" });
    const editor = getNearestEditorFromDOMNode(editable)!;
    await act(async () => editor.update(() => {
      const paragraph = $getRoot().getFirstChild();
      if (paragraph && "select" in paragraph) (paragraph as ReturnType<typeof $getRoot>).select(2, 2);
    }));
    fireEvent.keyDown(editable, { key: "Backspace", keyCode: 8 });
    await waitFor(() => expect(document.querySelector('.inline-file-selection.is-selected')).not.toBeNull());
    expect(state().attachments).toHaveLength(1);
    fireEvent.keyDown(editable, { key: "Backspace", keyCode: 8 });
    await waitFor(() => expect(state().attachments).toHaveLength(0));
    expect(state().text).not.toContain("attachment:");
  });
  it("sends with Enter and keeps real attachments; composition Enter does not submit", async () => {
    render(<Harness scope="editor-send" />); await hydrated();
    fireEvent.click(screen.getByText("sample"));
    await screen.findByRole("button", { name: "文档.md" });
    const editor = screen.getByRole("textbox", { name: "消息" });
    fireEvent.keyDown(editor, { key: "Enter", keyCode: 229, isComposing: true });
    expect(state().messages).toHaveLength(0);
    fireEvent.keyDown(editor, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(state().messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(1));
    expect(state().messages[0].attachments[0].content).toEqual(file.content);
    expect(state().text).toBe("");
    expect(state().attachments).toEqual([]);
    fireEvent.keyDown(editor, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(state().text).toBe("");
  });
  it("restores a rejected send only in its original empty composer", async () => {
    render(<Harness scope="editor-failure" />); await hydrated();
    const dispatch = (threadId: string) => act(() => window.dispatchEvent(new CustomEvent("bailey-restore-composer", { detail: { threadId, text: sentence, attachments: [{ ...file, status: { type: "complete" } }] } })));
    dispatch("another-thread"); expect(state().text).toBe("");
    dispatch("editor-failure");
    await waitFor(() => expect(state().attachments).toHaveLength(1));
    expect(state().text).toBe(sentence);
    fireEvent.click(screen.getByText("newer"));
    dispatch("editor-failure");
    await waitFor(() => expect(state().text).toContain("newer draft"));
  });
  it("keeps prose and file positions when the first upload creates a server task", async () => {
    const view = render(<Harness scope="new-local-task" />); await hydrated();
    fireEvent.click(screen.getByText("sample"));
    await screen.findByRole("button", { name: "文档.md" });
    view.rerender(<Harness scope="created-server-task" />); await hydrated();
    expect(state().text).toBe(sentence);
    expect(state().attachments[0].id).toBe(file.id);
    expect(drafts["new-local-task"]).toBe("");
    expect(drafts["created-server-task"]).toBe(sentence);
  });
  it("editing an already sent message retains real files and saves another revision", async () => {
    render(<Harness scope="edit-thread" />); await hydrated();
    fireEvent.click(screen.getByText("sample"));
    await screen.findByRole("button", { name: "文档.md" });
    fireEvent.click(screen.getByText("Send", { exact: true }));
    const edit = await screen.findByText("Edit message");
    await waitFor(() => expect(state().messages.some((m: { role: string }) => m.role === "assistant")).toBe(true));
    fireEvent.click(edit);
    await screen.findByRole("button", { name: "文档.md" });
    fireEvent.click(await screen.findByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "发送消息" })).toBeNull());
    const user = state().messages.find((m: { role: string }) => m.role === "user");
    expect(user.content[0].text).toBe(sentence);
    expect(user.attachments[0].content).toEqual(file.content);
  });
});


describe("inline attachment error translations", () => {
  it.each(["en", "zh-CN"] as const)("shows actionable upload errors in %s", async locale => {
    render(<PortalI18nProvider defaultLocale={locale} languageSwitcherEnabled={false}><InlineFileChip id="error-file" name="failed.md" attachment={{ id: "error-file", name: "failed.md", file: new File(["test"], "failed.md"), type: "document", contentType: "text/markdown", status: { type: "incomplete", reason: "error" }, uploadError: "Raw upload failure", uploadFailureCode: "network" }} /></PortalI18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: /failed.md/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(locale === "en" ? "Check your connection and try again." : "上传过程中连接中断，请检查网络后重试。");
    expect(alert.textContent).not.toContain("Raw upload failure");
  });
});
