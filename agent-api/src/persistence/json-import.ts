import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import type { ThreadRecord } from "./thread-repository.js";

type LegacyStore = {
  threads?: unknown[];
};

type ImportableThreadRepository = {
  get(threadId: string): Promise<ThreadRecord | undefined>;
  importThread(record: ThreadRecord): Promise<ThreadRecord>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asMessageList(value: unknown): ThreadRecord["messages"] {
  if (!Array.isArray(value)) return [];
  const items: ThreadRecord["messages"] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    if (!obj) continue;
    items.push({
      parentId: asString(obj.parentId) ?? null,
      message: obj.message,
      runConfig: asRecord(obj.runConfig ?? undefined) ?? undefined
    });
  }
  return items;
}

function asFeedbackList(value: unknown): ThreadRecord["feedback"] {
  if (!Array.isArray(value)) return [];
  const items: ThreadRecord["feedback"] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    if (!obj) continue;
    const type = obj.type === "positive" || obj.type === "negative" ? obj.type : undefined;
    if (!type) continue;
    items.push({
      id: asString(obj.id) ?? randomUUID(),
      type,
      messageId: asString(obj.messageId),
      contentPreview: asString(obj.contentPreview),
      createdAt: asString(obj.createdAt) ?? new Date().toISOString()
    });
  }
  return items;
}

function normalizeLegacyThread(value: unknown): ThreadRecord | null {
  const obj = asRecord(value);
  if (!obj) return null;

  const id = asString(obj.id);
  const model = asString(obj.model);
  const reasoningEffort = asString(obj.reasoningEffort) as ThreadRecord["reasoningEffort"] | undefined;
  const workspace = asString(obj.workspace);
  if (!id || !model || !reasoningEffort || !workspace) {
    return null;
  }

  return {
    id,
    userId: asString(obj.userId),
    externalId: asString(obj.externalId),
    status: obj.status === "archived" ? "archived" : "regular",
    title: asString(obj.title),
    model,
    reasoningEffort,
    workspace,
    codexRunConfig: asRecord(obj.codexRunConfig ?? undefined) ?? undefined,
    createdAt: asString(obj.createdAt) ?? new Date().toISOString(),
    updatedAt: asString(obj.updatedAt) ?? new Date().toISOString(),
    headId: asString(obj.headId) ?? null,
    messages: asMessageList(obj.messages),
    feedback: asFeedbackList(obj.feedback)
  };
}

async function archiveImportedFile(filePath: string): Promise<string> {
  const archivedPath = `${filePath}.migrated-${Date.now()}.bak`;
  await fs.rename(filePath, archivedPath).catch(async () => {
    await fs.copyFile(filePath, archivedPath);
    await fs.unlink(filePath);
  });
  return archivedPath;
}

export async function importLegacyThreadsFromJson(params: {
  filePath: string;
  repository: ImportableThreadRepository;
  defaultUserId?: string;
}): Promise<{ importedCount: number; archivedPath?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(params.filePath, "utf8");
  } catch {
    return { importedCount: 0 };
  }

  let parsed: LegacyStore;
  try {
    parsed = JSON.parse(raw) as LegacyStore;
  } catch {
    return { importedCount: 0 };
  }

  const threads = Array.isArray(parsed.threads) ? parsed.threads : [];
  let importedCount = 0;
  for (const entry of threads) {
    const normalized = normalizeLegacyThread(entry);
    if (!normalized) continue;
    if (await params.repository.get(normalized.id)) {
      continue;
    }
    if (!normalized.userId && !params.defaultUserId) {
      continue;
    }
    await params.repository.importThread({
      ...normalized,
      userId: normalized.userId ?? params.defaultUserId,
      sessionId: undefined
    });
    importedCount += 1;
  }

  if (!importedCount) {
    return { importedCount: 0 };
  }

  return {
    importedCount,
    archivedPath: await archiveImportedFile(params.filePath)
  };
}
