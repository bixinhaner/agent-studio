import { parseInlineAttachments, type InlinePart } from "./inline-attachments";

export type InlineSkillReference = { type: "skill"; id: string; name: string };
export type InlineReference = InlinePart | InlineSkillReference;
const skillPattern = /\[((?:\\.|[^\]\\])*)\]\(skill:([A-Za-z0-9%_.~-]+)\)/g;

export function skillReference(id: string, name: string): string {
  return `[${name.replace(/[\r\n]/g, " ").replace(/[\\[\]]/g, "\\$&")}](skill:${encodeURIComponent(id)})`;
}

export function parseInlineReferences(text: string): InlineReference[] {
  return parseInlineAttachments(text).flatMap((part): InlineReference[] => {
    if (part.type !== "text") return [part];
    const result: InlineReference[] = [];
    let offset = 0;
    for (const match of part.text.matchAll(skillPattern)) {
      let id: string;
      try { id = decodeURIComponent(match[2]); } catch { continue; }
      if (!id || id.length > 200) continue;
      if (match.index! > offset) result.push({ type: "text", text: part.text.slice(offset, match.index) });
      result.push({ type: "skill", id, name: match[1].replace(/\\(.)/g, "$1") });
      offset = match.index! + match[0].length;
    }
    if (offset < part.text.length) result.push({ type: "text", text: part.text.slice(offset) });
    return result;
  });
}

export function inlineSkillIds(text: string): Set<string> {
  return new Set(parseInlineReferences(text).flatMap(part => part.type === "skill" ? [part.id] : []));
}

export function inlineReferencePlainText(text: string): string {
  return parseInlineReferences(text).map(part => part.type === "text" ? part.text : part.name).join("");
}

// Selected skills describe the conversation's capabilities, not a new user request.
export function hasInlineComposerRequest(text: string, attachmentCount = 0): boolean {
  return attachmentCount > 0 || parseInlineReferences(text).some(part =>
    part.type === "attachment" || (part.type === "text" && !!part.text.trim()));
}
