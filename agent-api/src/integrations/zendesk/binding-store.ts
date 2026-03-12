import path from "node:path";

import { readJsonFile, writeJsonFile, WriteQueue } from "./storage.js";
import type { ZendeskBindingRecord } from "./types.js";

type PersistedBindings = {
  bindings: ZendeskBindingRecord[];
};

export class ZendeskBindingStore {
  private readonly filePath: string;
  private readonly queue = new WriteQueue();
  private cache = new Map<string, ZendeskBindingRecord>();
  private loaded = false;

  constructor(rootDir = path.resolve(process.cwd(), "temp", "zendesk")) {
    this.filePath = path.join(rootDir, "bindings.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const loaded = await readJsonFile<PersistedBindings>(this.filePath, { bindings: [] });
    this.cache.clear();
    for (const item of loaded.bindings || []) {
      const ticketId = String(item?.ticketId || "").trim();
      if (!ticketId) continue;
      this.cache.set(ticketId, {
        ...item,
        ticketId
      });
    }
    this.loaded = true;
  }

  async get(ticketId: string): Promise<ZendeskBindingRecord | undefined> {
    await this.ensureLoaded();
    return this.cache.get(String(ticketId || "").trim());
  }

  async upsert(
    ticketId: string,
    patch: Partial<Omit<ZendeskBindingRecord, "ticketId" | "createdAt" | "updatedAt">>
  ): Promise<ZendeskBindingRecord> {
    await this.ensureLoaded();
    const key = String(ticketId || "").trim();
    if (!key) throw new Error("ticketId 不能为空");

    const now = new Date().toISOString();
    const existing = this.cache.get(key);
    const next: ZendeskBindingRecord = {
      ticketId: key,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastProcessedRequesterCommentId:
        patch.lastProcessedRequesterCommentId ?? existing?.lastProcessedRequesterCommentId,
      lastAction: patch.lastAction ?? existing?.lastAction,
      lastRunAt: patch.lastRunAt ?? existing?.lastRunAt,
      lastRunId: patch.lastRunId ?? existing?.lastRunId
    };
    this.cache.set(key, next);
    await this.queue.run(async () =>
      writeJsonFile(this.filePath, {
        bindings: Array.from(this.cache.values()).sort((a, b) => a.ticketId.localeCompare(b.ticketId))
      })
    );
    return next;
  }
}
