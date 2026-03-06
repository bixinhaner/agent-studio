import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { ReasoningEffort } from "./model-config.js";

export type ThreadStatus = "regular" | "archived";
export type { ReasoningEffort } from "./model-config.js";

export type StoredMessageItem = {
  parentId: string | null;
  message: unknown;
  runConfig?: Record<string, unknown>;
};

export type ThreadFeedback = {
  id: string;
  type: "positive" | "negative";
  messageId?: string;
  contentPreview?: string;
  createdAt: string;
};

export type ThreadRecord = {
  id: string;
  externalId?: string;
  status: ThreadStatus;
  title?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  headId?: string | null;
  messages: StoredMessageItem[];
  feedback: ThreadFeedback[];
};

type PersistedStore = {
  threads: ThreadRecord[];
};

type CreateThreadPayload = {
  title?: string;
  externalId?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  sessionId?: string;
};

type UpdateThreadPayload = Partial<{
  status: ThreadStatus;
  title: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig: Record<string, unknown> | undefined;
  sessionId: string | undefined;
  headId: string | null;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function messageIdOf(message: unknown): string | null {
  const obj = asRecord(message);
  if (!obj) return null;
  const id = obj.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export class ThreadStore {
  private readonly threads = new Map<string, ThreadRecord>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    let parsed: PersistedStore = { threads: [] };
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as PersistedStore;
      if (Array.isArray(data?.threads)) {
        parsed = { threads: data.threads };
      }
    } catch {
      parsed = { threads: [] };
    }

    this.threads.clear();
    for (const thread of parsed.threads) {
      if (!thread?.id) continue;
      this.threads.set(thread.id, {
        ...thread,
        messages: Array.isArray(thread.messages) ? thread.messages : [],
        feedback: Array.isArray(thread.feedback) ? thread.feedback : []
      });
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const payload: PersistedStore = {
      threads: Array.from(this.threads.values())
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private async commit(): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.save());
    await this.writeChain;
  }

  async list(includeArchived = false): Promise<ThreadRecord[]> {
    await this.ensureLoaded();
    const items = Array.from(this.threads.values())
      .filter((t) => includeArchived || t.status !== "archived")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return items;
  }

  async create(payload: CreateThreadPayload): Promise<ThreadRecord> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const record: ThreadRecord = {
      id: uuidv4(),
      externalId: payload.externalId,
      status: "regular",
      title: payload.title?.trim() || undefined,
      model: payload.model,
      reasoningEffort: payload.reasoningEffort,
      workspace: payload.workspace,
      codexRunConfig: payload.codexRunConfig,
      sessionId: payload.sessionId,
      createdAt: now,
      updatedAt: now,
      headId: null,
      messages: [],
      feedback: []
    };
    this.threads.set(record.id, record);
    await this.commit();
    return record;
  }

  async get(threadId: string): Promise<ThreadRecord | undefined> {
    await this.ensureLoaded();
    return this.threads.get(threadId);
  }

  async update(threadId: string, patch: UpdateThreadPayload): Promise<ThreadRecord> {
    await this.ensureLoaded();
    const record = this.threads.get(threadId);
    if (!record) throw new Error("thread 不存在");

    if (patch.status) record.status = patch.status;
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      record.title = title || undefined;
    }
    if (patch.model) record.model = patch.model;
    if (patch.reasoningEffort) record.reasoningEffort = patch.reasoningEffort;
    if (patch.workspace) record.workspace = patch.workspace;
    if (patch.codexRunConfig !== undefined) record.codexRunConfig = patch.codexRunConfig;
    if (patch.sessionId !== undefined) record.sessionId = patch.sessionId;
    if (patch.headId !== undefined) record.headId = patch.headId;
    record.updatedAt = new Date().toISOString();

    await this.commit();
    return record;
  }

  async delete(threadId: string): Promise<void> {
    await this.ensureLoaded();
    this.threads.delete(threadId);
    await this.commit();
  }

  async appendMessage(threadId: string, item: StoredMessageItem): Promise<ThreadRecord> {
    await this.ensureLoaded();
    const record = this.threads.get(threadId);
    if (!record) throw new Error("thread 不存在");

    const incomingId = messageIdOf(item.message);
    if (incomingId) {
      const index = record.messages.findIndex((m) => messageIdOf(m.message) === incomingId);
      if (index >= 0) {
        record.messages[index] = item;
      } else {
        record.messages.push(item);
      }
      record.headId = incomingId;
    } else {
      record.messages.push(item);
    }
    record.updatedAt = new Date().toISOString();
    await this.commit();
    return record;
  }

  async replaceMessages(
    threadId: string,
    repository: { headId?: string | null; messages: StoredMessageItem[] }
  ): Promise<ThreadRecord> {
    await this.ensureLoaded();
    const record = this.threads.get(threadId);
    if (!record) throw new Error("thread 不存在");
    record.messages = Array.isArray(repository.messages) ? repository.messages : [];
    record.headId = repository.headId ?? null;
    record.updatedAt = new Date().toISOString();
    await this.commit();
    return record;
  }

  async getRepository(threadId: string): Promise<{ headId?: string | null; messages: StoredMessageItem[] }> {
    await this.ensureLoaded();
    const record = this.threads.get(threadId);
    if (!record) throw new Error("thread 不存在");
    return {
      headId: record.headId ?? null,
      messages: record.messages
    };
  }

  async addFeedback(
    threadId: string,
    payload: Omit<ThreadFeedback, "id" | "createdAt">
  ): Promise<ThreadFeedback> {
    await this.ensureLoaded();
    const record = this.threads.get(threadId);
    if (!record) throw new Error("thread 不存在");
    const feedback: ThreadFeedback = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      type: payload.type,
      messageId: payload.messageId,
      contentPreview: payload.contentPreview
    };
    record.feedback.push(feedback);
    record.updatedAt = new Date().toISOString();
    await this.commit();
    return feedback;
  }
}
