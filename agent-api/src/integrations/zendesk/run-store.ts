import path from "node:path";
import { randomUUID } from "node:crypto";

import { readJsonFile, writeJsonFile, WriteQueue } from "./storage.js";
import type { ZendeskRunRecord, ZendeskRunStatus } from "./types.js";

type PersistedRuns = {
  runs: ZendeskRunRecord[];
};

const MAX_RUNS = 200;

export class ZendeskRunStore {
  private readonly filePath: string;
  private readonly queue = new WriteQueue();
  private cache: ZendeskRunRecord[] = [];
  private loaded = false;

  constructor(rootDir = path.resolve(process.cwd(), "temp", "zendesk")) {
    this.filePath = path.join(rootDir, "runs.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const loaded = await readJsonFile<PersistedRuns>(this.filePath, { runs: [] });
    this.cache = Array.isArray(loaded.runs) ? loaded.runs : [];
    this.loaded = true;
  }

  async list(limit = 50): Promise<ZendeskRunRecord[]> {
    await this.ensureLoaded();
    return this.cache.slice(0, Math.max(1, Math.min(200, limit)));
  }

  async listForInstance(limit = 50, instanceId?: string): Promise<ZendeskRunRecord[]> {
    await this.ensureLoaded();
    const safeLimit = Math.max(1, Math.min(200, limit));
    const normalizedInstanceId = typeof instanceId === "string" ? instanceId.trim() : "";
    if (!normalizedInstanceId) {
      return this.cache.slice(0, safeLimit);
    }
    return this.cache
      .filter((item) => {
        const itemInstanceId = typeof item.instanceId === "string" ? item.instanceId.trim() : "";
        return itemInstanceId === normalizedInstanceId || !itemInstanceId;
      })
      .slice(0, safeLimit);
  }

  async create(input: {
    instanceId?: string;
    ticketId: string;
    source: "webhook" | "manual";
    status: ZendeskRunStatus;
    detail: string;
    ticketSubject?: string;
  }): Promise<ZendeskRunRecord> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const record: ZendeskRunRecord = {
      id: randomUUID(),
      instanceId: typeof input.instanceId === "string" && input.instanceId.trim() ? input.instanceId.trim() : undefined,
      ticketId: input.ticketId,
      source: input.source,
      status: input.status,
      detail: input.detail,
      ticketSubject: input.ticketSubject,
      createdAt: now,
      updatedAt: now
    };
    this.cache = [record, ...this.cache].slice(0, MAX_RUNS);
    await this.persist();
    return record;
  }

  async update(
    runId: string,
    patch: Partial<Omit<ZendeskRunRecord, "id" | "ticketId" | "source" | "createdAt">>
  ): Promise<ZendeskRunRecord | undefined> {
    await this.ensureLoaded();
    const index = this.cache.findIndex((item) => item.id === runId);
    if (index < 0) return undefined;
    const current = this.cache[index];
    const next: ZendeskRunRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.cache[index] = next;
    await this.persist();
    return next;
  }

  private async persist(): Promise<void> {
    await this.queue.run(async () => writeJsonFile(this.filePath, { runs: this.cache.slice(0, MAX_RUNS) }));
  }
}
