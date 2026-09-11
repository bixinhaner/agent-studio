import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Drawer, Popover } from "antd";
import { Package, Trash2 } from "lucide-react";
import { DecoratorNode, type NodeKey, type SerializedLexicalNode } from "lexical";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { skillReference } from "./inline-references";
import { usePortalI18n } from "./i18n";

export type ComposerSkill = { id: string; name: string; description?: string; presentation?: { summary?: string } };
export type InlineSkillBinding = {
  availableSkills: readonly ComposerSkill[];
  enabledSkillIds: readonly string[];
  ready?: boolean;
  busy?: boolean;
  onChange(ids: string[]): void | Promise<void>;
};
export const InlineSkillActions = createContext<{
  binding?: InlineSkillBinding;
  remove(id: string): void;
}>({ remove() {} });

export function InlineSkillChip({ id, name, readOnly = false }: { id: string; name: string; readOnly?: boolean }) {
  const { binding, remove } = useContext(InlineSkillActions);
  const { locale } = usePortalI18n();
  const en = locale === "en";
  const skill = !readOnly ? binding?.availableSkills.find(item => item.id === id) : undefined;
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const change = () => setMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation(); setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [open]);
  const body = <div className="inline-file-details inline-skill-details">
    <Package size={22} aria-hidden="true" /><strong>{name}</strong>
    <small>{readOnly ? (en ? "Skill referenced in this message" : "此消息引用的 Skill")
      : (en ? "Enabled for this conversation" : "已为本次对话启用")}</small>
    {skill?.presentation?.summary || skill?.description ? <p>{skill.presentation?.summary || skill.description}</p> : null}
    {!readOnly ? <div className="inline-file-actions"><button type="button" disabled={binding?.busy}
      onClick={() => { setOpen(false); remove(id); }}><Trash2 size={16} aria-hidden="true" />{en ? "Remove Skill" : "移除 Skill"}</button></div> : null}
  </div>;
  const trigger = <button ref={triggerRef} type="button" className="inline-file-chip inline-skill-chip"
    aria-label={`Skill: ${name}`} aria-haspopup="dialog" aria-expanded={open} title={name}
    contentEditable={false} onClick={() => setOpen(!open)}>
    <Package size={20} aria-hidden="true" /><span className="inline-file-name inline-skill-name">{name}</span>
  </button>;
  return mobile ? <>{trigger}<Drawer title="Skill" placement="bottom" height="auto" open={open}
    onClose={() => setOpen(false)} rootClassName="inline-file-sheet-panel">{body}</Drawer></>
    : <Popover trigger="click" placement="top" open={open} onOpenChange={setOpen} content={body} overlayClassName="inline-file-popover">{trigger}</Popover>;
}

type SerializedSkillNode = SerializedLexicalNode & { id: string; name: string };
export class InlineSkillNode extends DecoratorNode<ReactNode> {
  __id: string;
  __name: string;
  static getType() { return "bailey-skill"; }
  static clone(node: InlineSkillNode) { return new InlineSkillNode(node.__id, node.__name, node.__key); }
  constructor(id: string, name: string, key?: NodeKey) { super(key); this.__id = id; this.__name = name; }
  static importJSON(json: SerializedSkillNode) { return new InlineSkillNode(json.id, json.name); }
  exportJSON(): SerializedSkillNode { return { ...super.exportJSON(), type: "bailey-skill", version: 1, id: this.__id, name: this.__name }; }
  createDOM() { const span = document.createElement("span"); span.className = "inline-file-node"; return span; }
  updateDOM() { return false; }
  isInline() { return true; }
  isKeyboardSelectable() { return true; }
  getTextContent() { return skillReference(this.__id, this.__name); }
  decorate() { return <SkillDecoration id={this.__id} name={this.__name} nodeKey={this.getKey()} />; }
}
function SkillDecoration({ id, name, nodeKey }: { id: string; name: string; nodeKey: NodeKey }) {
  const [selected] = useLexicalNodeSelection(nodeKey);
  return <span className={selected ? "inline-file-selection is-selected" : "inline-file-selection"}><InlineSkillChip id={id} name={name} /></span>;
}
