import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { AssistantRuntimeProvider, ComposerPrimitive, useAui, useAuiState, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { $getRoot, $createParagraphNode, $createTextNode, getNearestEditorFromDOMNode } from "lexical";
import { InlineAttachmentComposer } from "./InlineAttachmentComposer";
import { InlineSkillChip } from "./InlineSkillChip";
import { inlineSkillIds, skillReference, hasInlineComposerRequest, inlineReferencePlainText } from "./inline-references";
import { PortalSkillPicker } from "./workbench/SkillPicker";
import { PortalI18nProvider } from "./i18n";
import { makeAttachmentDraft, writeAttachmentDraft } from "./inline-attachments";
import type { RuntimeModeSnapshot } from "../modes/types";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);
const skills: RuntimeModeSnapshot["availableSkills"] = ["ardot-design-core", "cloudstudio-deploy"].map(name => ({
  id: `managed:${name}`, name, label: name, description: `Use ${name}`, system: false, scope: "private",
  presentation: { displayName: name, summary: `Use ${name}`, useCases: [], usageSteps: [], examplePrompts: [], dataScope: "", iconKey: "design", sortOrder: 1, requestedLocale: "zh-CN", resolvedLocale: "zh-CN" }
}));
const model: ChatModelAdapter = { async *run() { yield { content: [{ type: "text", text: "done" }] }; } };
function Body({ scope, initial, fail = false }: { scope: string; initial: string[]; fail?: boolean }) {
  const aui = useAui();
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const text = useAuiState(s => s.composer.text);
  const attachments = useAuiState(s => s.composer.attachments);
  const messages = useAuiState(s => s.thread.messages);
  const update = async (ids: string[]) => {
    const previous = enabled; setEnabled(ids); setBusy(true);
    await new Promise(resolve => setTimeout(resolve, 5));
    setBusy(false);
    if (fail) { setEnabled(previous); throw new Error("save failed"); }
  };
  const blocked = busy || !hasInlineComposerRequest(text, attachments.length);
  return <>
    <button onClick={() => aui.composer().setText("根据 ")}>prose</button>
    <button onClick={() => setEnabled(skills.map(skill => skill.id))}>both</button>
    <button onClick={() => setEnabled([])}>none</button>
    <ComposerPrimitive.Root onSubmit={event => { if (blocked) event.preventDefault(); }}>
      <InlineAttachmentComposer draftKey={scope} threadId={scope} skills={{ availableSkills: skills, enabledSkillIds: enabled, busy, onChange: update }} />
      <PortalSkillPicker availableSkills={skills} automaticSkills={[]} enabledSkillIds={enabled} recentSkillIds={[]} onEnabledSkillIdsChange={update} onFillPrompt={value => aui.composer().setText(value)} />
      <ComposerPrimitive.Send disabled={blocked}>Send</ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
    <output data-testid="state">{JSON.stringify({ text, enabled, messages })}</output>
  </>;
}
function Harness({ scope, initial = [], fail }: { scope: string; initial?: string[]; fail?: boolean }) {
  const runtime = useLocalRuntime(model);
  return <PortalI18nProvider defaultLocale="zh-CN" languageSwitcherEnabled={false}><AssistantRuntimeProvider runtime={runtime}><Body key={scope} scope={scope} initial={initial} fail={fail} /></AssistantRuntimeProvider></PortalI18nProvider>;
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!);
const ready = () => waitFor(() => expect(document.querySelector('[data-draft-ready="true"]')).not.toBeNull());
const chip = (index = 0) => screen.findByRole("button", { name: `Skill: ${skills[index].name}` });

describe("skill selection and the real inline composer", () => {
  it("shows selected names while retaining the picker's count and enabled state", async () => {
    render(<Harness scope="skills-picker" />); await ready();
    fireEvent.click(screen.getByText("prose"));
    fireEvent.click(screen.getByRole("button", { name: "选择 Skill" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(skills[0].name) }));
    fireEvent.click(await screen.findByRole("button", { name: "启用 Skill" }));
    await chip();
    expect(document.querySelector('.portal-composer-skill-trigger.is-active .portal-skill-count')?.textContent).toBe("1");
    expect(inlineReferencePlainText(state().text)).toContain("根据 ");
    fireEvent.click(screen.getByRole("button", { name: "选择 Skill" }));
    await screen.findByRole("button", { name: "停用 Skill" });
    expect(document.querySelector('.portal-skill-card.is-enabled')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "停用 Skill" }));
    await waitFor(() => expect(inlineSkillIds(state().text).size).toBe(0));
  });
  it("removing a token deselects the actual Skill and undo restores both", async () => {
    render(<Harness scope="skills-remove" initial={[skills[0].id]} />); await ready();
    fireEvent.click(await chip());
    fireEvent.click(await screen.findByRole("button", { name: "移除 Skill" }));
    await waitFor(() => expect(state().enabled).toEqual([]));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "消息" }), { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => expect(state().enabled).toEqual([skills[0].id]));
    await chip();
  });
  it("restores the visible and actual selection when saving a deletion fails", async () => {
    render(<Harness scope="skills-failure" initial={[skills[0].id]} fail />); await ready();
    fireEvent.click(await chip()); fireEvent.click(await screen.findByRole("button", { name: "移除 Skill" }));
    await screen.findByRole("alert"); await chip();
    expect(state().enabled).toEqual([skills[0].id]);
  });
  it("retains persisted token positions without duplicated selected skills", async () => {
    const text = `使用 ${skillReference(skills[0].id, skills[0].name)} 完成设计。`;
    await writeAttachmentDraft("skills-restore", makeAttachmentDraft(text, []));
    render(<Harness scope="skills-restore" initial={[skills[0].id]} />); await ready(); await chip();
    expect(state().text).toBe(text);
    expect(document.querySelectorAll('.inline-skill-chip')).toHaveLength(1);
  });
  it("does not send skill-only input with Enter, and a real send retains selection for the next request", async () => {
    render(<Harness scope="skills-send" initial={[skills[0].id]} />); await ready(); await chip();
    const editable = screen.getByRole("textbox", { name: "消息" });
    fireEvent.keyDown(editable, { key: "Enter", keyCode: 13 });
    expect(state().messages).toEqual([]);
    fireEvent.click(screen.getByText("prose")); await chip();
    fireEvent.click(screen.getByText("Send", { exact: true }));
    await waitFor(() => expect(state().messages.some((message: { role: string }) => message.role === "assistant")).toBe(true));
    expect(state().enabled).toEqual([skills[0].id]);
    await chip();
    expect(hasInlineComposerRequest(state().text)).toBe(false);
    expect(state().messages[0].content[0].text).toContain("skill:");
  });
  it("clearing the editor disables all selected skills and changing tasks does not leak them", async () => {
    const view = render(<Harness scope="skills-clear" initial={skills.map(skill => skill.id)} />); await ready(); await chip(1);
    const editor = getNearestEditorFromDOMNode(screen.getByRole("textbox", { name: "消息" }))!;
    await act(async () => editor.update(() => { $getRoot().clear().append($createParagraphNode().append($createTextNode("new request"))); }));
    await waitFor(() => expect(state().enabled).toEqual([]));
    view.rerender(<Harness scope="skills-other" />); await ready();
    expect(state().enabled).toEqual([]);
    expect(document.querySelectorAll('.inline-skill-chip')).toHaveLength(0);
  });
});

it.each(["zh-CN", "en"] as const)("sent Skill references have localized details and no remove action: %s", async locale => {
  render(<PortalI18nProvider defaultLocale={locale} languageSwitcherEnabled={false}><InlineSkillChip id="old" name="historic-skill" readOnly /></PortalI18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Skill: historic-skill" }));
  await screen.findByText(locale === "en" ? "Skill referenced in this message" : "此消息引用的 Skill");
  expect(screen.queryByRole("button", { name: /Remove Skill|移除 Skill/ })).toBeNull();
});
