import { promises as fs } from "node:fs";
import path from "node:path";

import {
  AGENT_STUDIO_MEMORY_STORE_DIR_NAME,
  agentStudioMemoryStore,
  codexMemoryProjectionPath,
  listSiblingCodexHomes,
  normalizedMemoryKey,
  pathExists
} from "./engine.js";
import { buildNativeMemoryView, type NativeMemoryView } from "./native-memory-view.js";
import {
  readUserMemories,
  syncAgentStudioMemoryProjection,
  userMemoryId,
  userMemoryStoreDir,
  writeUserMemories,
  type UserMemoryItem
} from "./user-memory.js";

/** What Codex learned on its own, as shown to the user (read-only). */
export type PortalLearnedMemory = NativeMemoryView & { updatedAt?: string };

export type PortalMemoryScope = {
  id: string;
  /** Organization directory key; the same assistant can appear under several organizations. */
  organizationKey: string;
  agentSegment: string;
  modeId?: string;
  updatedAt?: string;
  userItems: UserMemoryItem[];
  learned?: PortalLearnedMemory;
  /** Store directory of the assistant (translation cache lives here). */
  storeDir: string;
};

export function modeIdFromAgentSegment(segment: string): string | undefined {
  return segment.match(/^agent-(.+?)(?:-[0-9a-f]{6,})?$/)?.[1];
}

/** One assistant's memory for a user: a stable store plus the per-capability homes Codex runs in. */
export type PortalMemoryHome = {
  id: string;
  organizationKey: string;
  agentSegment: string;
  /** Newest home of the assistant; the store path is derived from it. */
  codexHome: string;
  homes: string[];
};

const MAX_ITEMS_PER_SCOPE = 50;
const MAX_ITEM_CHARS = 500;

export class PortalMemoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

function cleanText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new PortalMemoryError("Memory text is required", "text_required");
  if (text.length > MAX_ITEM_CHARS) throw new PortalMemoryError(`Memory must be at most ${MAX_ITEM_CHARS} characters`, "text_too_long");
  return text;
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** Codex's learned memory of one home, without the user section Agent Studio projects into it. */
export async function learnedMemoryForHome(codexHome: string): Promise<PortalLearnedMemory | undefined> {
  const summaryPath = path.join(codexMemoryProjectionPath(codexHome), "memory_summary.md");
  const view = buildNativeMemoryView(await readText(summaryPath));
  if (!view) return undefined;
  const stat = await fs.stat(summaryPath).catch(() => undefined);
  return { ...view, updatedAt: stat?.mtime.toISOString() };
}

/**
 * Portal view of a user's memories per assistant: what Codex learned (read-only) and what the
 * user added by hand (editable). User homes live at `<sessionHomeRoot>/<org>/<userId>/<agentSegment>`.
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

  /**
   * Assistants of this user (across organizations) that hold memory. Every per-capability
   * home `agent-<mode>-<hash>` of one assistant collapses into a single scope `org~agent-<mode>`.
   */
  async listUserHomes(userId: string): Promise<PortalMemoryHome[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(userId)) return [];
    const root = path.resolve(this.options.sessionHomeRoot);
    const result: PortalMemoryHome[] = [];
    let orgEntries: string[] = [];
    try {
      orgEntries = await fs.readdir(root);
    } catch {
      return [];
    }
    for (const orgKey of orgEntries) {
      if (orgKey === "integrations" || orgKey.startsWith("thread-") || orgKey.startsWith("session-") || orgKey.startsWith(".")) continue;
      const userDir = path.join(root, orgKey, userId);
      let segments: string[] = [];
      try {
        segments = await fs.readdir(userDir);
      } catch {
        continue;
      }
      const homesByBase = new Map<string, string[]>();
      for (const segment of segments) {
        const store = agentStudioMemoryStore(path.join(userDir, segment));
        if (store) homesByBase.set(store.segmentBase, [...(homesByBase.get(store.segmentBase) ?? []), path.join(userDir, segment)]);
      }
      if (await pathExists(path.join(userDir, AGENT_STUDIO_MEMORY_STORE_DIR_NAME))) {
        for (const base of await fs.readdir(path.join(userDir, AGENT_STUDIO_MEMORY_STORE_DIR_NAME)).catch(() => [] as string[])) {
          if (base.startsWith("agent-") && !base.includes(".tmp-") && !homesByBase.has(base)) homesByBase.set(base, []);
        }
      }
      for (const [base, all] of homesByBase) {
        // Homes with memory first (newest first): the newest one is where Codex currently runs.
        const withMemory = await listSiblingCodexHomes(userDir, base);
        const homes = [...withMemory, ...all.filter((home) => !withMemory.includes(home))];
        // Any `<base>-<hash>` path derives the same store, even one that does not exist on disk.
        const anyHome = homes[0] ?? path.join(userDir, `${base}-000000`);
        result.push({ id: `${orgKey}~${base}`, organizationKey: orgKey, agentSegment: base, codexHome: anyHome, homes });
      }
    }
    return result;
  }

  async resolveHome(userId: string, scopeId: string): Promise<PortalMemoryHome> {
    const homes = await this.listUserHomes(userId);
    const found = homes.find((home) => home.id === scopeId);
    if (found) return found;
    throw new PortalMemoryError("Memory scope does not exist", "scope_not_found");
  }

  /** Learned memory of the newest home that has any; the newest home is the one Codex currently runs in. */
  async learnedMemory(home: PortalMemoryHome): Promise<PortalLearnedMemory | undefined> {
    for (const codexHome of home.homes) {
      const learned = await learnedMemoryForHome(codexHome);
      if (learned) return learned;
    }
    return undefined;
  }

  async readScope(home: PortalMemoryHome): Promise<PortalMemoryScope> {
    const [userItems, learned] = await Promise.all([readUserMemories(home.codexHome), this.learnedMemory(home)]);
    const updatedAt = [learned?.updatedAt, ...userItems.map((item) => item.updatedAt)]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return {
      id: home.id,
      organizationKey: home.organizationKey,
      agentSegment: home.agentSegment,
      modeId: modeIdFromAgentSegment(home.agentSegment),
      updatedAt,
      userItems,
      learned,
      storeDir: userMemoryStoreDir(home.codexHome)
    };
  }

  async list(userId: string): Promise<PortalMemoryScope[]> {
    const scopes = await Promise.all((await this.listUserHomes(userId)).map((home) => this.readScope(home)));
    return scopes.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  /** Memories a run in `codexHome` can draw on: the user's own items plus Codex's preference bullets. */
  async countForCodexHome(codexHome: string | undefined): Promise<number> {
    if (!codexHome) return 0;
    try {
      const [items, learned] = await Promise.all([readUserMemories(codexHome), learnedMemoryForHome(codexHome)]);
      return items.length + (learned?.preferences.length ?? 0);
    } catch {
      return 0;
    }
  }

  private async mutate<T>(home: PortalMemoryHome, change: (items: UserMemoryItem[]) => T): Promise<T> {
    // All homes of one assistant share a store, so serialize on the store, not the home.
    return this.withLock(userMemoryStoreDir(home.codexHome), async () => {
      const items = await readUserMemories(home.codexHome);
      const result = change(items);
      await writeUserMemories(home.codexHome, items);
      // Runs re-sync before starting; doing it now keeps the files consistent for admins too.
      for (const codexHome of home.homes) await syncAgentStudioMemoryProjection(codexHome);
      return result;
    });
  }

  async add(home: PortalMemoryHome, input: { text: string }): Promise<UserMemoryItem> {
    const text = cleanText(input.text);
    return this.mutate(home, (items) => {
      if (items.some((item) => normalizedMemoryKey(item.text) === normalizedMemoryKey(text))) {
        throw new PortalMemoryError("This memory already exists", "duplicate_item");
      }
      if (items.length >= MAX_ITEMS_PER_SCOPE) {
        throw new PortalMemoryError(`At most ${MAX_ITEMS_PER_SCOPE} memories are kept per assistant`, "too_many_items");
      }
      const now = new Date().toISOString();
      const item = { id: userMemoryId(text), text, createdAt: now, updatedAt: now };
      items.push(item);
      return item;
    });
  }

  async update(home: PortalMemoryHome, itemId: string, input: { text: string }): Promise<UserMemoryItem> {
    const text = cleanText(input.text);
    return this.mutate(home, (items) => {
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) throw new PortalMemoryError("Memory does not exist", "item_not_found");
      if (items.some((item, other) => other !== index && normalizedMemoryKey(item.text) === normalizedMemoryKey(text))) {
        throw new PortalMemoryError("This memory already exists", "duplicate_item");
      }
      const item = { ...items[index], id: userMemoryId(text), text, updatedAt: new Date().toISOString() };
      items[index] = item;
      return item;
    });
  }

  async remove(home: PortalMemoryHome, itemId: string): Promise<void> {
    await this.mutate(home, (items) => {
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) throw new PortalMemoryError("Memory does not exist", "item_not_found");
      items.splice(index, 1);
    });
  }
}
