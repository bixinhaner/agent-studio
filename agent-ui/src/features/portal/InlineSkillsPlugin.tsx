import { useEffect, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useAui } from "@assistant-ui/react";
import {
  $getRoot, $getSelection, $setSelection, $isRangeSelection, $getNodeByKey, $createTextNode,
  $nodesOfType, HISTORY_PUSH_TAG, type RangeSelection
} from "lexical";
import { InlineSkillNode, type InlineSkillBinding } from "./InlineSkillChip";
import { inlineSkillIds } from "./inline-references";
import { usePortalI18n } from "./i18n";

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));

export function InlineSkillsPlugin({ binding, ready, text }: { binding?: InlineSkillBinding; ready: boolean; text: string }) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();
  const current = useRef(binding); current.current = binding;
  const enabled = ready && binding?.ready !== false && !!binding;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const selection = useRef<RangeSelection | null>(null);
  const previous = useRef<string[]>([]);
  const desired = useRef<string[] | null>(null);
  const saving = useRef(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => editor.registerUpdateListener(({ editorState, tags }) => {
    let next: string[] = [];
    editorState.read(() => {
      const range = $getSelection();
      if ($isRangeSelection(range)) selection.current = range.clone();
      next = [...inlineSkillIds($getRoot().getTextContent())];
    });
    const changed = !sameIds(previous.current, next);
    previous.current = next;
    if (!enabledRef.current || !changed || tags.has("runtime-sync") || tags.has("skill-sync")) return;
    const available = new Set(current.current?.availableSkills.map(skill => skill.id));
    desired.current = next.filter(id => available.has(id));
    if (saving.current) return;
    saving.current = true;
    setError(false);
    // Serialize selection changes, including a quick undo while a save is still in flight.
    void Promise.resolve().then(async () => {
      try {
        while (alive.current && desired.current) {
          const ids = desired.current;
          desired.current = null;
          await current.current?.onChange(ids);
        }
      } catch {
        desired.current = null;
        if (alive.current) setError(true);
      } finally {
        saving.current = false;
        if (alive.current) setRevision(value => value + 1);
      }
    });
  }), [editor]);

  const selectedKey = JSON.stringify(binding?.enabledSkillIds ?? []);
  const availableKey = JSON.stringify(binding?.availableSkills.map(skill => [skill.id, skill.name]) ?? []);
  useEffect(() => {
    if (!enabled || saving.current || !current.current) return;
    // IndexedDB restoration can publish runtime text before React's subscribed text has caught up.
    if (aui.composer().getState().text !== text) return;
    const state = current.current;
    const selected = state.availableSkills.filter(skill => state.enabledSkillIds.includes(skill.id));
    const ids = [...inlineSkillIds(text)];
    if (sameIds(ids, selected.map(skill => skill.id))) return;
    editor.update(() => {
      const selectedIds = new Set(selected.map(skill => skill.id));
      const nodes = $nodesOfType(InlineSkillNode);
      for (const node of nodes) if (!selectedIds.has(node.__id)) node.remove();
      const existing = new Set(nodes.filter(node => node.isAttached()).map(node => node.__id));
      const fresh = selected.filter(skill => !existing.has(skill.id));
      if (!fresh.length) return;
      const range = $getSelection();
      if (!$isRangeSelection(range) && selection.current) {
        try { $setSelection(selection.current.clone()); } catch { /* Draft replacement invalidated the old cursor. */ }
      }
      let target = $getSelection();
      if (!$isRangeSelection(target) || !$getNodeByKey(target.anchor.key) || !$getNodeByKey(target.focus.key)) target = $getRoot().selectEnd();
      if ($isRangeSelection(target)) target.insertNodes(fresh.flatMap(skill => [new InlineSkillNode(skill.id, skill.name), $createTextNode(" ")]));
    }, { tag: ["skill-sync", HISTORY_PUSH_TAG] });
  }, [aui, availableKey, editor, enabled, revision, selectedKey, text]);

  return error ? <SkillSaveError /> : null;
}

function SkillSaveError() {
  const { locale } = usePortalI18n();
  return <small className="portal-inline-draft-notice" role="alert">{locale === "en"
    ? "Skill selection could not be saved. Your previous selection has been restored. Try again."
    : "Skill 选择未能保存，已恢复原有选择，请重试。"}</small>;
}
