import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent
} from "react";
import { useAui, useAuiState, type Attachment } from "@assistant-ui/react";
import { EditComposer } from "@assistant-ui/react-ui";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode, $createTextNode, $createLineBreakNode, $getRoot, $getSelection, $setSelection, $isRangeSelection,
  $isNodeSelection, $createNodeSelection, $getNodeByKey, $isTextNode,
  DecoratorNode, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_LOW, COPY_COMMAND, CUT_COMMAND, PASTE_COMMAND,
  KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_ENTER_COMMAND, CLEAR_HISTORY_COMMAND, HISTORY_PUSH_TAG, HISTORY_MERGE_TAG,
  type LexicalNode, type NodeKey, type SerializedLexicalNode, type RangeSelection
} from "lexical";
import { Drawer, Popover } from "antd";
import { AlertCircle, File, FileText, FileSpreadsheet, Presentation, Image, LoaderCircle, Eye, Trash2, RotateCcw } from "lucide-react";
import {
  attachmentReference, inlineAttachmentIds, completedAttachment,
  readAttachmentDraft, writeAttachmentDraft, makeAttachmentDraft, reserveAttachmentId,
  missingInlineAttachments, type InlineAttachment
} from "./inline-attachments";
import { localizedUploadFailureMessage } from "./attachment-upload-messages";
import { usePortalI18n } from "./i18n";
import { resolvePortalComposerKeyDownAction } from "./composer-keyboard";
import { parseInlineReferences, inlineReferencePlainText, inlineSkillIds, hasInlineComposerRequest } from "./inline-references";
import { InlineSkillActions, InlineSkillNode, type InlineSkillBinding } from "./InlineSkillChip";
import { InlineSkillsPlugin } from "./InlineSkillsPlugin";
import "./inline-composer.css";

type EditorActions = {
  attachments: readonly InlineAttachment[];
  remove(id: string): void;
  retry(id: string): void;
  preview?(attachment: InlineAttachment): void;
};
const AttachmentActions = createContext<EditorActions>({ attachments: [], remove() {}, retry() {} });

function FileGlyph({ name, imageUrl }: { name: string; imageUrl?: string }) {
  if (imageUrl) return <img className="inline-file-thumb" src={imageUrl} alt="" />;
  if (/\.(xlsx?|csv|ods)$/i.test(name)) return <FileSpreadsheet className="inline-file-sheet" size={20} />;
  if (/\.(pptx?|odp)$/i.test(name)) return <Presentation className="inline-file-presentation" size={20} />;
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) return <Image className="inline-file-image" size={20} />;
  if (/\.(md|txt|pdf|docx?)$/i.test(name)) return <FileText className="inline-file-document" size={20} />;
  return <File size={20} />;
}

export function InlineFileChip({ id, name, attachment: supplied, onPreview, readOnly = false }: {
  id: string; name: string; attachment?: InlineAttachment; onPreview?(attachment: InlineAttachment): void; readOnly?: boolean;
}) {
  const context = useContext(AttachmentActions);
  const attachment = supplied ?? context.attachments.find(item => item.id === id);
  const { locale, t } = usePortalI18n();
  const en = locale === "en";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const extension = name.match(/(\.[^.\s]{1,12})$/)?.[1] ?? "";
  const stem = extension ? name.slice(0, -extension.length) : name;
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [open]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!(attachment?.file instanceof Blob) || attachment.type !== "image") { setUrl(undefined); return; }
    const objectUrl = URL.createObjectURL(attachment.file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [attachment?.file, attachment?.type]);
  const running = attachment?.status.type === "running";
  const failed = !attachment || attachment.status.type === "incomplete";
  const percent = running ? Math.min(99, Math.round((attachment.status.type === "running" ? attachment.status.progress ?? 0 : 0) * 100)) : 0;
  const status = running ? (en ? "Uploading " : "上传中 ") + percent + "%"
    : failed ? (en ? "Upload unavailable" : attachment ? "上传失败" : "附件未恢复") : "";
  const preview = onPreview ?? context.preview;
  const body = <div className="inline-file-details">
    {url ? <img className="inline-file-preview" src={url} alt={name} /> : <FileGlyph name={name} />}
    <strong>{name}</strong>
    <small>{extension.slice(1).toUpperCase() || (en ? "File" : "文件")}{attachment?.file?.size ? " · " + Math.ceil(attachment.file.size / 1024) + " KB" : ""}</small>
    {status ? <p role={failed ? "alert" : "status"}>{status}{failed && attachment ? " · " + localizedUploadFailureMessage(attachment, t) : ""}</p> : null}
    <div className="inline-file-actions">
      {!failed && !running && attachment && preview ? <button type="button" onClick={() => { setOpen(false); preview(attachment); }}><Eye size={16} />{en ? "Preview" : "预览"}</button> : null}
      {!readOnly && failed && attachment?.file ? <button type="button" onClick={() => { setOpen(false); context.retry(id); }}><RotateCcw size={16} />{en ? "Retry" : "重试"}</button> : null}
      {!readOnly ? <button type="button" onClick={() => { setOpen(false); context.remove(id); }}><Trash2 size={16} />{en ? "Remove attachment" : "移除附件"}</button> : null}
    </div>
  </div>;
  const trigger = <button ref={triggerRef} type="button" className={"inline-file-chip" + (failed ? " is-failed" : "") + (running ? " is-uploading" : "")}
    aria-label={name + (status ? " · " + status : "")} aria-haspopup="dialog" aria-expanded={open}
    title={name} onClick={() => setOpen(!open)} contentEditable={false}>
    {running ? <LoaderCircle className="inline-file-spinner" size={18} /> : failed ? <AlertCircle size={18} /> : <FileGlyph name={name} imageUrl={url} />}
    <span className="inline-file-name"><span className="inline-file-stem">{stem}</span><span className="inline-file-extension">{extension}</span></span>{status ? <small>{running ? percent + "%" : en ? "Failed" : "失败"}</small> : null}
  </button>;
  return mobile ? <>{trigger}<Drawer title={en ? "Attachment" : "附件"} placement="bottom" height="auto" open={open}
    onClose={() => setOpen(false)} rootClassName="inline-file-sheet-panel">{body}</Drawer></>
    : <Popover trigger="click" placement="top" open={open} onOpenChange={setOpen} content={body} overlayClassName="inline-file-popover">{trigger}</Popover>;
}

type SerializedAttachmentNode = SerializedLexicalNode & { id: string; name: string };
export class InlineAttachmentNode extends DecoratorNode<ReactNode> {
  __id: string;
  __name: string;
  static getType() { return "bailey-attachment"; }
  static clone(node: InlineAttachmentNode) { return new InlineAttachmentNode(node.__id, node.__name, node.__key); }
  constructor(id: string, name: string, key?: NodeKey) { super(key); this.__id = id; this.__name = name; }
  static importJSON(json: SerializedAttachmentNode) { return new InlineAttachmentNode(json.id, json.name); }
  exportJSON(): SerializedAttachmentNode { return { ...super.exportJSON(), type: "bailey-attachment", version: 1, id: this.__id, name: this.__name }; }
  createDOM() { const span = document.createElement("span"); span.className = "inline-file-node"; return span; }
  updateDOM() { return false; }
  isInline() { return true; }
  isKeyboardSelectable() { return true; }
  getTextContent() { return attachmentReference(this.__id, this.__name); }
  decorate() { return <AttachmentDecoration id={this.__id} name={this.__name} nodeKey={this.getKey()} />; }
}

function AttachmentDecoration({ id, name, nodeKey }: { id: string; name: string; nodeKey: NodeKey }) {
  const [selected] = useLexicalNodeSelection(nodeKey);
  return <span className={selected ? "inline-file-selection is-selected" : "inline-file-selection"}><InlineFileChip id={id} name={name} /></span>;
}

function replaceEditorText(text: string) {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (index > 0) paragraph.append($createLineBreakNode());
    for (const part of parseInlineReferences(line)) {
      paragraph.append(part.type === "text" ? $createTextNode(part.text) : part.type === "skill"
        ? new InlineSkillNode(part.id, part.name) : new InlineAttachmentNode(part.id, part.name));
    }
  }
  root.append(paragraph);
}

type ComposerProps = {
  draftKey: string; threadId: string; autoFocus?: boolean;
  onPreview?(attachment: InlineAttachment): void;
  skills?: InlineSkillBinding;
};
function EditorBridge({ autoFocus }: Pick<ComposerProps, "autoFocus">) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();
  const actions = useContext(AttachmentActions);
  const skillActions = useContext(InlineSkillActions);
  const availableSkills = useRef(skillActions.binding?.availableSkills); availableSkills.current = skillActions.binding?.availableSkills;
  const { locale } = usePortalI18n();
  const placeholder = locale === "en" ? "Ask a question or describe a task…" : "输入问题或描述任务…";
  const text = useAuiState(state => state.composer.text);
  const editing = useAuiState(state => state.composer.isEditing);
  const lastEmitted = useRef(text);
  const lastIds = useRef(inlineAttachmentIds(text));
  const selection = useRef<RangeSelection | null>(null);
  const suppressed = useRef(new Set<string>());
  const cache = useRef(new Map<string, InlineAttachment>());
  const removals = useRef(new Map<string, Promise<void>>());
  const restoring = useRef(new Set<string>());
  for (const attachment of actions.attachments) cache.current.set(attachment.id, attachment);
  useEffect(() => { editor.setEditable(editing); }, [editing, editor]);

  useEffect(() => {
    editor.update(() => replaceEditorText(aui.composer().getState().text), { tag: HISTORY_MERGE_TAG });
    if (autoFocus) editor.focus();
  }, [aui, autoFocus, editor]);

  useEffect(() => editor.registerUpdateListener(({ editorState, tags }) => {
    editorState.read(() => {
      const currentSelection = $getSelection();
      if ($isRangeSelection(currentSelection)) selection.current = currentSelection.clone();
      const value = $getRoot().getTextContent();
      if (value === lastEmitted.current) return;
      lastEmitted.current = value;
      const ids = inlineAttachmentIds(value);
      if (!tags.has("runtime-sync")) {
        for (const id of lastIds.current) {
          if (ids.has(id)) continue;
          suppressed.current.add(id);
          if (aui.composer().getState().attachments.some(item => item.id === id)) {
            const removal = aui.composer().attachment({ id }).remove().catch(() => undefined);
            removals.current.set(id, removal);
          }
        }
        // Undo restores the real attachment, not just its visible label.
        for (const id of ids) {
          if (aui.composer().getState().attachments.some(item => item.id === id) || restoring.current.has(id)) continue;
          const saved = cache.current.get(id);
          if (!saved) continue;
          suppressed.current.delete(id);
          restoring.current.add(id);
          void (removals.current.get(id) ?? Promise.resolve()).then(async () => {
            const complete = completedAttachment(saved);
            if (complete) await aui.composer().addAttachment(complete);
            else if (saved.file) {
              reserveAttachmentId(saved.file, id);
              await aui.composer().addAttachment(saved.file);
            }
          }).finally(() => restoring.current.delete(id));
        }
      }
      lastIds.current = ids;
      aui.composer().setText(value);
    });
  }), [aui, editor]);

  useEffect(() => {
    if (text === lastEmitted.current) return;
    lastEmitted.current = text;
    lastIds.current = inlineAttachmentIds(text);
    if (!text && !actions.attachments.length) {
      suppressed.current.clear(); cache.current.clear();
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
    editor.update(() => replaceEditorText(text), { tag: ["runtime-sync", HISTORY_MERGE_TAG] });
  }, [actions.attachments.length, editor, text]);

  useEffect(() => {
    const fresh = actions.attachments.filter(item => !inlineAttachmentIds(aui.composer().getState().text).has(item.id) && !suppressed.current.has(item.id));
    if (!fresh.length) return;
    editor.update(() => {
      const nodes = fresh.map(item => new InlineAttachmentNode(item.id, item.name));
      const current = $getSelection();
      if (!$isRangeSelection(current) && selection.current) {
        try { $setSelection(selection.current.clone()); } catch { /* The old paragraph may have been replaced. */ }
      }
      let target = $getSelection();
      if (!$isRangeSelection(target) || !$getNodeByKey(target.anchor.key) || !$getNodeByKey(target.focus.key)) target = $getRoot().selectEnd();
      if ($isRangeSelection(target)) target.insertNodes(nodes);
    }, { tag: HISTORY_PUSH_TAG });
  }, [actions.attachments, aui, editor, text]);

  useEffect(() => {
    const removeSelected = (backward: boolean, event: globalThis.KeyboardEvent | null) => {
      const current = $getSelection();
      if ($isNodeSelection(current)) {
        const nodes = current.getNodes().filter(node => node instanceof InlineAttachmentNode || node instanceof InlineSkillNode);
        if (!nodes.length) return false;
        event?.preventDefault();
        const parent = nodes[0].getParent();
        const offset = nodes[0].getIndexWithinParent();
        nodes.forEach(node => node.remove());
        parent?.select(offset, offset);
        return true;
      }
      if (!$isRangeSelection(current) || !current.isCollapsed()) return false;
      const anchor = current.anchor;
      const node = anchor.getNode();
      let neighbor: LexicalNode | null = null;
      if ($isTextNode(node)) {
        if (backward && anchor.offset === 0) neighbor = node.getPreviousSibling();
        if (!backward && anchor.offset === node.getTextContentSize()) neighbor = node.getNextSibling();
      } else {
        const children = "getChildren" in node ? (node as ReturnType<typeof $createParagraphNode>).getChildren() : [];
        neighbor = children[backward ? anchor.offset - 1 : anchor.offset] ?? null;
      }
      if (!(neighbor instanceof InlineAttachmentNode) && !(neighbor instanceof InlineSkillNode)) return false;
      event?.preventDefault();
      const selected = $createNodeSelection(); selected.add(neighbor.getKey()); $setSelection(selected);
      return true;
    };
    const copy = (event: ClipboardEvent | null, cut: boolean) => {
      if (!event?.clipboardData) return false;
      const current = $getSelection();
      if (!current) return false;
      const value = current.getTextContent();
      event.preventDefault();
      event.clipboardData.setData("text/plain", inlineReferencePlainText(value));
      event.clipboardData.setData("application/x-bailey-inline", value);
      if (cut && $isRangeSelection(current)) current.removeText();
      else if (cut && $isNodeSelection(current)) current.getNodes().forEach(node => node.remove());
      return true;
    };
    return mergeRegister(
      editor.registerCommand(KEY_ENTER_COMMAND, event => {
        if (!event || resolvePortalComposerKeyDownAction({ key: event.key, keyCode: event.keyCode, shiftKey: event.shiftKey,
          isComposing: event.isComposing || editor.isComposing(), threadRunning: aui.thread().getState().isRunning }) !== "submit") return false;
        event.preventDefault(); event.stopPropagation();
        editor.getRootElement()?.closest("form")?.requestSubmit();
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, event => removeSelected(true, event), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_DELETE_COMMAND, event => removeSelected(false, event), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(COPY_COMMAND, event => copy(event instanceof ClipboardEvent ? event : null, false), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CUT_COMMAND, event => copy(event instanceof ClipboardEvent ? event : null, true), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(PASTE_COMMAND, event => {
        if (!(event instanceof ClipboardEvent) || event.defaultPrevented) return false;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length) {
          event.preventDefault();
          if (!aui.thread().getState().capabilities.attachments) return true;
          for (const file of files) void aui.composer().addAttachment(file);
          return true;
        }
        const rich = event.clipboardData?.getData("application/x-bailey-inline");
        if (!rich) return false;
        event.preventDefault();
        const current = $getSelection();
        if ($isRangeSelection(current)) current.insertNodes(parseInlineReferences(rich).map(part =>
          part.type === "attachment" && cache.current.has(part.id) ? new InlineAttachmentNode(part.id, part.name)
            : part.type === "skill" && availableSkills.current?.some(skill => skill.id === part.id) ? new InlineSkillNode(part.id, part.name)
            : $createTextNode(part.type === "text" ? part.text : part.name)));
        return true;
      }, COMMAND_PRIORITY_LOW)
    );
  }, [aui, editor]);
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const handle = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const skill = event.type === "bailey-remove-skill";
      editor.update(() => {
        for (const paragraph of $getRoot().getChildren()) {
          if (!("getChildren" in paragraph)) continue;
          for (const child of (paragraph as ReturnType<typeof $createParagraphNode>).getChildren()) {
            if ((skill ? child instanceof InlineSkillNode : child instanceof InlineAttachmentNode) && (child as InlineAttachmentNode | InlineSkillNode).__id === id) child.remove();
          }
        }
      }, { tag: HISTORY_PUSH_TAG });
      editor.focus();
    };
    root.addEventListener("bailey-remove-attachment", handle);
    root.addEventListener("bailey-remove-skill", handle);
    return () => { root.removeEventListener("bailey-remove-attachment", handle); root.removeEventListener("bailey-remove-skill", handle); };
  }, [editor]);
  return <PlainTextPlugin contentEditable={<ContentEditable className="portal-inline-editor" aria-label={locale === "en" ? "Message" : "消息"} aria-placeholder={placeholder}
    placeholder={<div className="portal-inline-placeholder">{placeholder}</div>}
    onDropCapture={event => {
      // The surrounding assistant-ui dropzone handles files during capture.
      // Respect that event so dropping into the editor does not upload twice.
      // Capture also runs before Lexical's native drop handler in standalone editors.
      if (event.defaultPrevented) return;
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault(); event.stopPropagation();
      if (!aui.thread().getState().capabilities.attachments) return;
      editor.focus();
      for (const file of files) void aui.composer().addAttachment(file);
    }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
  />} placeholder={null} ErrorBoundary={LexicalErrorBoundary} />;
}

export function InlineAttachmentComposer(props: ComposerProps) {
  const aui = useAui();
  const { locale } = usePortalI18n();
  const text = useAuiState(state => state.composer.text);
  const attachments = useAuiState(state => state.composer.attachments) as readonly InlineAttachment[];
  const wrapper = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const restoringDraftText = useRef<string | null>(null);
  const previousDraftKey = useRef(props.draftKey);
  const snapshot = useRef(makeAttachmentDraft(text, attachments));
  snapshot.current = makeAttachmentDraft(text, attachments);
  useEffect(() => {
    let active = true;
    setReady(false);
    if (previousDraftKey.current !== props.draftKey) {
      // The parent keys by local conversation identity, so a key change here is task creation.
      void writeAttachmentDraft(previousDraftKey.current, makeAttachmentDraft("", [])).catch(() => setDraftError(true));
      previousDraftKey.current = props.draftKey;
    }
    void readAttachmentDraft(props.draftKey).then(async draft => {
      if (!active || !draft || Date.now() - draft.updatedAt > 30 * 86400_000) return;
      const composer = aui.composer();
      if (composer.getState().attachments.length) return;
      // Existing text persistence owns newer edits; only restore the matching draft.
      if (composer.getState().text && composer.getState().text !== draft.text) return;
      restoringDraftText.current = draft.text;
      composer.setText(draft.text);
      for (const item of draft.attachments) {
        if (!active) return;
        if (item.attachment) await composer.addAttachment(item.attachment);
        else if (item.file) { reserveAttachmentId(item.file, item.id); void composer.addAttachment(item.file); }
      }
    }).catch(() => setDraftError(true)).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [aui, props.draftKey]);
  useEffect(() => {
    if (!ready || restoringDraftText.current === null) return;
    if (text === restoringDraftText.current || hasInlineComposerRequest(text)) {
      restoringDraftText.current = null;
    } else {
      // The first runtime mount may defer setText. Restore prose before inserting selected skills.
      aui.composer().setText(restoringDraftText.current);
    }
  }, [aui, ready, text]);
  useEffect(() => {
    if (!ready) return;
    const save = () => { void writeAttachmentDraft(props.draftKey, snapshot.current).catch(() => setDraftError(true)); };
    const timer = window.setTimeout(save, 350);
    return () => window.clearTimeout(timer);
  }, [attachments, props.draftKey, ready, text]);
  useEffect(() => {
    if (!ready) return;
    const save = () => { void writeAttachmentDraft(props.draftKey, snapshot.current).catch(() => setDraftError(true)); };
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, [props.draftKey, ready]);
  useEffect(() => {
    const restore = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string; text: string; attachments: InlineAttachment[] }>).detail;
      if (detail.threadId !== props.threadId || hasInlineComposerRequest(aui.composer().getState().text, aui.composer().getState().attachments.length)) return;
      aui.composer().setText(detail.text);
      for (const attachment of detail.attachments) {
        const complete = completedAttachment(attachment);
        if (complete) void aui.composer().addAttachment(complete);
      }
    };
    window.addEventListener("bailey-restore-composer", restore);
    return () => window.removeEventListener("bailey-restore-composer", restore);
  }, [aui, props.threadId]);
  const remove = useCallback((id: string) => wrapper.current?.querySelector("[contenteditable]")?.dispatchEvent(new CustomEvent("bailey-remove-attachment", { detail: id })), []);
  const removeSkill = useCallback((id: string) => wrapper.current?.querySelector("[contenteditable]")?.dispatchEvent(new CustomEvent("bailey-remove-skill", { detail: id })), []);
  const retry = useCallback(async (id: string) => {
    const file = aui.composer().getState().attachments.find(item => item.id === id)?.file;
    if (!file) return;
    await aui.composer().attachment({ id }).remove();
    reserveAttachmentId(file, id);
    await aui.composer().addAttachment(file);
  }, [aui]);
  const actions = useMemo(() => ({ attachments, remove, retry, preview: props.onPreview }), [attachments, props.onPreview, remove, retry]);
  return <AttachmentActions.Provider value={actions}><InlineSkillActions.Provider value={{ binding: props.skills, remove: removeSkill }}>
    <div className="portal-inline-input-wrap" ref={wrapper} data-draft-ready={ready}>
      <LexicalComposer initialConfig={{
        namespace: "BaileyComposer", nodes: [InlineAttachmentNode, InlineSkillNode], onError: error => { throw error; },
        theme: { paragraph: "portal-inline-paragraph" }
      }}>
        <HistoryPlugin />
        <EditorBridge autoFocus={props.autoFocus} />
        <InlineSkillsPlugin binding={props.skills} ready={ready && (restoringDraftText.current === null || text === restoringDraftText.current)} text={text} />
      </LexicalComposer>
    </div>
    {draftError ? <small className="portal-inline-draft-notice" role="status">{locale === "en" ? "This browser cannot save attachment drafts. Keep this page open until you send." : "当前浏览器无法保存附件草稿，请保持页面打开直至发送。"}</small> : null}
  </InlineSkillActions.Provider></AttachmentActions.Provider>;
}

export function InlineAttachmentEditComposer(props: ComposerProps) {
  const initialInline = useRef(useAuiState(state => inlineAttachmentIds(state.composer.text).size > 0 || inlineSkillIds(state.composer.text).size > 0));
  const text = useAuiState(state => state.composer.text);
  const attachments = useAuiState(state => state.composer.attachments);
  const { t } = usePortalI18n();
  const blocked = attachments.some(item => item.status.type === "running" || item.status.type === "incomplete") || missingInlineAttachments(text, attachments);
  if (!initialInline.current) return <EditComposer />;
  return <EditComposer.Root onSubmit={(event: FormEvent<HTMLFormElement>) => { if (blocked) event.preventDefault(); }}>
    <InlineAttachmentComposer {...props} />
    <EditComposer.Footer><EditComposer.Cancel /><EditComposer.Send disabled={blocked}>{t("thread.send")}</EditComposer.Send></EditComposer.Footer>
  </EditComposer.Root>;
}
