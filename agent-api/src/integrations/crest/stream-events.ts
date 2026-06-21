import type { CodexCommentaryEntry } from "../../operations/codex-execution-service.js";

export type CrestThoughtEventPayload = {
  id: string;
  text: string;
};

export function crestCommentaryEntryToThoughtPayload(
  entry: CodexCommentaryEntry,
  options: { maxTextLength?: number } = {}
): CrestThoughtEventPayload | undefined {
  const text = commentaryEntryText(entry);
  if (!text) return undefined;
  return {
    id: entry.id,
    text: truncateText(text, options.maxTextLength ?? 1200)
  };
}

function commentaryEntryText(entry: CodexCommentaryEntry): string {
  const text = entry.text.trim();
  if (text) return text;
  return entry.lines.map((line) => line.trim()).filter(Boolean).join("\n\n");
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
