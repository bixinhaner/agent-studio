import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  agentStudioMemorySourcePath,
  buildMemorySummary,
  codexMemoryProjectionPath,
  ensureAgentStudioMemorySource,
  normalizedMemoryKey,
  pathExists,
  readCanonicalMemoryItems,
  readMemoryCandidates,
  similarityScore,
  syncAgentStudioMemoryProjection,
  uniqueMemoryItems,
  writeMemoryCandidates
} from "./engine.js";

export type PortalMemoryCategory = "preference" | "background" | "habit";
export const PORTAL_MEMORY_CATEGORIES: readonly PortalMemoryCategory[] = ["preference", "background", "habit"];

export type PortalMemoryItem = {
  id: string;
  text: string;
  category: PortalMemoryCategory;
  source: "learned" | "user";
  updatedAt?: string;
};

export type PortalMemoryScope = {
  id: string;
  agentSegment: string;
  modeId?: string;
  updatedAt?: string;
  items: PortalMemoryItem[];
};

export function modeIdFromAgentSegment(segment: string): string | undefined {
  return segment.match(/^agent-(.+)-[0-9a-f]{6,}$/)?.[1];
}

const MAX_ITEMS_PER_SCOPE = 50;
const MAX_ITEM_CHARS = 500;

export class PortalMemoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export function memoryItemId(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/** Maps free-form engine categories onto the three portal groups. */
export function portalMemoryCategory(raw: string | undefined): PortalMemoryCategory {
  const value = (raw ?? "").toLowerCase();
  if (!value) return "background";
  if (value === "preference" || value === "background" || value === "habit") return value;
  if (/prefer|style|tone|language|format|偏好/.test(value)) return "preference";
  if (/workflow|procedure|process|convention|habit|routine|习惯|流程/.test(value)) return "habit";
  return "background";
}

type RawEntry = { heading: string; lines: string[]; memory?: string; category?: string; source?: string };

function parseRawEntries(content: string): { preamble: string[]; entries: RawEntry[] } {
  const preamble: string[] = [];
  const entries: RawEntry[] = [];
  let current: RawEntry | undefined;
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) {
      current = { heading: line, lines: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      preamble.push(line);
      continue;
    }
    current.lines.push(line);
    const memory = line.match(/^- memory:\s*(.+)$/)?.[1]?.trim();
    if (memory) current.memory = memory;
    const category = line.match(/^- category:\s*(.+)$/)?.[1]?.trim();
    if (category) current.category = category;
    const source = line.match(/^- source:\s*(.+)$/)?.[1]?.trim();
    if (source) current.source = source;
  }
  return { preamble, entries };
}

function serializeRawEntries(preamble: string[], entries: RawEntry[]): string {
  const head = preamble.join("\n").trimEnd() || "# Raw Memories";
  if (!entries.length) return `${head}\n\nNo raw memories yet.\n`;
  const body = entries.map((entry) => [entry.heading, ...entry.lines].join("\n").trimEnd()).join("\n\n");
  return `${head.replace(/\n*No raw memories yet\.\s*$/i, "")}\n\n${body}\n`;
}

function sameMemory(left: string, right: string): boolean {
  return left.trim() === right.trim() || normalizedMemoryKey(left) === normalizedMemoryKey(right);
}

function cleanText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new PortalMemoryError("Memory text is required", "text_required");
  if (text.length > MAX_ITEM_CHARS) throw new PortalMemoryError(`Memory must be at most ${MAX_ITEM_CHARS} characters`, "text_too_long");
  return text;
}

/** Canonical items without the engine's empty-summary placeholder document. */
async function readItems(dir: string): Promise<string[]> {
  return (await readCanonicalMemoryItems(dir)).filter((item) => !item.startsWith("# Memory Summary"));
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Portal-facing view over the per-user Agent Studio memory source. Every user
 * agent scope lives at `<sessionHomeRoot>/<org>/<userId>/<agentSegment>`.
 */
export class PortalMemoryService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: { sessionHomeRoot: string }) {}

  private async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  /** Finds codex homes that belong to this user across organizations. */
  async listUserHomes(userId: string): Promise<Array<{ id: string; codexHome: string; agentSegment: string }>> {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) return [];
    const root = path.resolve(this.options.sessionHomeRoot);
    const homes: Array<{ id: string; codexHome: string; agentSegment: string }> = [];
    let orgEntries: string[] = [];
    try {
      orgEntries = await fs.readdir(root);
    } catch {
      return [];
    }
    for (const orgKey of orgEntries) {
      if (orgKey === "integrations" || orgKey.startsWith("thread-") || orgKey.startsWith("session-")) continue;
      const userDir = path.join(root, orgKey, userId);
      let segments: string[] = [];
      try {
        segments = await fs.readdir(userDir);
      } catch {
        continue;
      }
      for (const segment of segments) {
        const codexHome = path.join(userDir, segment);
        if (
          (await pathExists(agentStudioMemorySourcePath(codexHome))) ||
          (await pathExists(codexMemoryProjectionPath(codexHome)))
        ) {
          homes.push({ id: `${orgKey}~${segment}`, codexHome, agentSegment: segment });
        }
      }
    }
    return homes;
  }

  async resolveHome(userId: string, scopeId: string) {
    const homes = await this.listUserHomes(userId);
    const found = homes.find((home) => home.id === scopeId);
    if (found) return found;
    throw new PortalMemoryError("Memory scope does not exist", "scope_not_found");
  }

  private async readScope(codexHome: string): Promise<PortalMemoryItem[]> {
    const sourceDir = agentStudioMemorySourcePath(codexHome);
    const dir = (await pathExists(sourceDir)) ? sourceDir : codexMemoryProjectionPath(codexHome);
    const items = await readItems(dir);
    const { entries } = parseRawEntries(await readText(path.join(dir, "raw_memories.md")));
    return items.map((text) => {
      const entry = [...entries].reverse().find((item) => item.memory && sameMemory(item.memory, text));
      const updatedAt = entry?.heading.slice(3).trim();
      return {
        id: memoryItemId(text),
        text,
        category: portalMemoryCategory(entry?.category),
        source: entry?.source === "portal_user" ? "user" : "learned",
        updatedAt: updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? updatedAt : undefined
      };
    });
  }

  async list(userId: string): Promise<PortalMemoryScope[]> {
    const homes = await this.listUserHomes(userId);
    const scopes = await Promise.all(
      homes.map(async (home): Promise<PortalMemoryScope> => {
        const stat = await fs.stat(home.codexHome).catch(() => undefined);
        return {
          id: home.id,
          agentSegment: home.agentSegment,
          modeId: modeIdFromAgentSegment(home.agentSegment),
          updatedAt: stat?.mtime.toISOString(),
          items: await this.readScope(home.codexHome)
        };
      })
    );
    return scopes.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  async countForCodexHome(codexHome: string | undefined): Promise<number> {
    if (!codexHome) return 0;
    try {
      return (await this.readScope(codexHome)).length;
    } catch {
      return 0;
    }
  }

  private async mutate(
    codexHome: string,
    change: (state: { items: string[]; entries: RawEntry[]; preamble: string[] }) => void | Promise<void>
  ): Promise<void> {
    await this.withLock(codexHome, async () => {
      await fs.mkdir(codexHome, { recursive: true });
      const sourceDir = await ensureAgentStudioMemorySource(codexHome);
      const rawPath = path.join(sourceDir, "raw_memories.md");
      const items = await readItems(sourceDir);
      const { preamble, entries } = parseRawEntries(await readText(rawPath));
      const state = { items: [...items], entries, preamble };
      await change(state);
      // With an empty summary the engine falls back to raw entries, so drop
      // them too; otherwise superseded wordings would reappear.
      if (!uniqueMemoryItems(state.items).length) state.entries = [];
      const summary = buildMemorySummary(uniqueMemoryItems(state.items).slice(-MAX_ITEMS_PER_SCOPE));
      await fs.writeFile(rawPath, serializeRawEntries(state.preamble, state.entries), "utf8");
      await fs.writeFile(path.join(sourceDir, "memory_summary.md"), summary, "utf8");
      await fs.writeFile(path.join(sourceDir, "MEMORY.md"), summary, "utf8");
      await syncAgentStudioMemoryProjection(codexHome);
    });
  }

  private rawEntry(text: string, category: PortalMemoryCategory, action: string): RawEntry {
    return {
      heading: `## ${new Date().toISOString()}`,
      lines: ["- source: portal_user", `- action: ${action}`, `- category: ${category}`, `- memory: ${text}`],
      memory: text,
      category,
      source: "portal_user"
    };
  }

  async add(codexHome: string, input: { text: string; category: PortalMemoryCategory }): Promise<PortalMemoryItem> {
    const text = cleanText(input.text);
    await this.mutate(codexHome, (state) => {
      if (state.items.length >= MAX_ITEMS_PER_SCOPE) {
        throw new PortalMemoryError(`At most ${MAX_ITEMS_PER_SCOPE} memories are kept per assistant`, "too_many_items");
      }
      state.items.push(text);
      state.entries.push(this.rawEntry(text, input.category, "create"));
    });
    return { id: memoryItemId(text), text, category: input.category, source: "user" };
  }

  async update(codexHome: string, itemId: string, input: { text?: string; category?: PortalMemoryCategory }): Promise<PortalMemoryItem> {
    let result: PortalMemoryItem | undefined;
    await this.mutate(codexHome, (state) => {
      const index = state.items.findIndex((item) => memoryItemId(item) === itemId);
      if (index < 0) throw new PortalMemoryError("Memory does not exist", "item_not_found");
      const previous = state.items[index];
      const text = input.text !== undefined ? cleanText(input.text) : previous;
      const lastEntry = [...state.entries].reverse().find((entry) => entry.memory && sameMemory(entry.memory, previous));
      const category = input.category ?? portalMemoryCategory(lastEntry?.category);
      state.items[index] = text;
      // Drop raw evidence of the old wording so fallbacks cannot resurrect it.
      state.entries = state.entries.filter((entry) => !(entry.memory && sameMemory(entry.memory, previous)));
      state.entries.push(this.rawEntry(text, category, "update"));
      result = { id: memoryItemId(text), text, category, source: "user" };
    });
    return result!;
  }

  async remove(codexHome: string, itemId: string): Promise<void> {
    await this.mutate(codexHome, async (state) => {
      const index = state.items.findIndex((item) => memoryItemId(item) === itemId);
      if (index < 0) throw new PortalMemoryError("Memory does not exist", "item_not_found");
      const [removed] = state.items.splice(index, 1);
      state.entries = state.entries.filter((entry) => !(entry.memory && sameMemory(entry.memory, removed)));
      const sourceDir = agentStudioMemorySourcePath(codexHome);
      const candidates = await readMemoryCandidates(sourceDir);
      let changed = false;
      for (const candidate of candidates) {
        if (candidate.status === "pending" && (sameMemory(candidate.memory, removed) || similarityScore(candidate.memory, removed) >= 0.75)) {
          candidate.status = "rejected";
          candidate.lastDecision = "user_deleted";
          candidate.lastReason = "Deleted by the user in the portal";
          changed = true;
        }
      }
      if (changed) await writeMemoryCandidates(sourceDir, candidates);
    });
  }
}
