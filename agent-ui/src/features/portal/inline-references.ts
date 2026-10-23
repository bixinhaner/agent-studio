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

// Chips a message starts with (skills, files) read as context for the question,
// so they are shown on their own row; whitespace between them is dropped and the
// question text starts cleanly below. Messages without other content stay inline.
export function splitLeadingReferences(parts: readonly InlineReference[]): {
  leading: InlineReference[];
  rest: InlineReference[];
} {
  let index = 0;
  const leading: InlineReference[] = [];
  while (index < parts.length) {
    const part = parts[index];
    if (part.type !== "text") leading.push(part);
    else if (part.text.trim()) break;
    index += 1;
  }
  const rest = parts.slice(index);
  if (leading.length === 0 || rest.length === 0) return { leading: [], rest: [...parts] };
  const [first, ...others] = rest;
  return {
    leading,
    rest: first.type === "text" ? [{ type: "text", text: first.text.replace(/^\s+/, "") }, ...others] : rest
  };
}
