import { createHash } from "node:crypto";

import { nativeMemorySummary } from "./user-memory.js";

/**
 * Display model of Codex's native `memory_summary.md`. Codex writes it for itself: a user
 * profile, preference bullets, general tips, then internal indexes ("What's in Memory",
 * "Older Memory Topics") full of file paths. Users only see the first three, cleaned of
 * Codex bookkeeping. Codex keeps reading the original file; this view is never written back.
 */

export type MemoryPoint = { text: string; details: string[] };

export type NativeMemoryContent = {
  profile: string[];
  preferences: MemoryPoint[];
  tips: MemoryPoint[];
};

export type MemoryLanguage = "zh" | "en";

export type NativeMemoryView = NativeMemoryContent & {
  language: MemoryLanguage;
  /** Hash of the displayed content; translations are cached against it. */
  contentHash: string;
};

type SectionKey = keyof NativeMemoryContent;

function sectionKey(heading: string): SectionKey | undefined {
  const name = heading.toLowerCase().replace(/[^a-z㐀-鿿 ]/g, "").trim();
  if (/^user profile|^用户画像|^用户概况/.test(name)) return "profile";
  if (/^user preferences?|^用户偏好/.test(name)) return "preferences";
  if (/^general tips?|^通用提示|^通用技巧/.test(name)) return "tips";
  return undefined;
}

const NOISE_LINE = [
  /^v\d+$/i,
  /(^|[\s(`'"])\/(usr|var|home|tmp|opt|etc|root|private|Users)\//,
  /codex-homes|rollout_summaries|raw_memories|memory_summary|MEMORY\.md|memories_\d+\.sqlite/i,
  // Notes Codex keeps about its own memory pipeline, not about the user.
  /phase ?[12]\b|phase2_workspace_diff|extensions\/|instructions\.md|consolidat|bootstrap|\bINIT\b|ad[-_ ]hoc/i,
  /\b(rollout|memory) (evidence|summar\w*|repo\w*|folder|set|root|artifacts?|blocks?)\b/i,
  /^no (durable|stable|consolidated)\b/i
];

/** Removes Codex bookkeeping (tags, citations, file references) from one line; empty when it is pure bookkeeping. */
export function cleanMemoryLine(line: string): string {
  let text = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\[(?:ad[- ]hoc note|ad_hoc|note)\]\s*/gi, "")
    .replace(/``/g, "")
    .replace(/\((?:see|from|source|cf\.?)[^)]*\)/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || NOISE_LINE.some((pattern) => pattern.test(text))) return "";
  text = text.replace(/[\s:：;；,，-]+$/, "").trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

export function parseNativeMemorySummary(content: string): NativeMemoryContent {
  const result: NativeMemoryContent = { profile: [], preferences: [], tips: [] };
  let section: SectionKey | undefined;
  let current: MemoryPoint | undefined;
  for (const rawLine of nativeMemorySummary(content).split(/\r?\n/)) {
    const heading = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      // Only second-level headings switch sections; deeper ones are sub-topics of the current one.
      if (heading[1].length <= 2) {
        section = sectionKey(heading[2]);
        current = undefined;
      }
      continue;
    }
    if (!section || !rawLine.trim()) continue;
    const text = cleanMemoryLine(rawLine);
    if (!text) continue;
    if (section === "profile") {
      result.profile.push(text);
      continue;
    }
    const indented = /^\s{2,}[-*+]\s/.test(rawLine) || /^\s{4,}\S/.test(rawLine);
    if (indented && current) {
      current.details.push(text);
      continue;
    }
    current = { text, details: [] };
    result[section].push(current);
  }
  return result;
}

function contentText(content: NativeMemoryContent): string {
  return [
    ...content.profile,
    ...content.preferences.flatMap((point) => [point.text, ...point.details]),
    ...content.tips.flatMap((point) => [point.text, ...point.details])
  ].join("\n");
}

/** Chinese when CJK characters make up a meaningful share of the letters, English otherwise. */
export function detectMemoryLanguage(text: string): MemoryLanguage {
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (!cjk) return "en";
  // A CJK character carries roughly a word; weigh it against ~5 Latin letters.
  return cjk * 5 >= latin * 0.6 ? "zh" : "en";
}

export function memoryContentHash(content: NativeMemoryContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 24);
}

export function isEmptyMemoryContent(content: NativeMemoryContent): boolean {
  return !content.profile.length && !content.preferences.length && !content.tips.length;
}

export function buildNativeMemoryView(summary: string): NativeMemoryView | undefined {
  const content = parseNativeMemorySummary(summary);
  if (isEmptyMemoryContent(content)) return undefined;
  return { ...content, language: detectMemoryLanguage(contentText(content)), contentHash: memoryContentHash(content) };
}

export function localeLanguage(locale: string | undefined): MemoryLanguage {
  return /^zh/i.test(locale ?? "") ? "zh" : "en";
}
