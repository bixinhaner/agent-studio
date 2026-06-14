import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import {
  type CodexMemoryRunStatus,
  CodexMemoryEngine,
  codexHomeFromRunConfig,
  codexRunConfigHasExternalContext
} from "./engine.js";
import {
  buildSharedCodexHomeScope
} from "../runtime-scope-resolver.js";

export type CodexMemoryBackfillRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type CodexMemoryBackfillItemStatus = "pending" | "processing" | CodexMemoryRunStatus | "cancelled";

export type CodexMemoryBackfillFilters = {
  channels?: string[];
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
};

export type CodexMemoryBackfillChannelSummary = {
  channel: string;
  totalPairs: number;
  readyItems: number;
  skippedMissingInput: number;
  alreadyProcessed: number;
};

export type CodexMemoryBackfillPreview = {
  totalPairs: number;
  readyItems: number;
  skippedMissingInput: number;
  alreadyProcessed: number;
  estimatedLlmCalls: number;
  byChannel: CodexMemoryBackfillChannelSummary[];
};

export type CodexMemoryBackfillRunSummary = {
  id: string;
  status: CodexMemoryBackfillRunStatus;
  name?: string;
  filters: CodexMemoryBackfillFilters;
  dryRun: boolean;
  totalItems: number;
  processedItems: number;
  writtenItems: number;
  skippedNoDurableItems: number;
  skippedMissingInputItems: number;
  failedItems: number;
  alreadyProcessedItems: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

type Logger = Pick<typeof console, "warn" | "info">;

type MessageRow = {
  id: string;
  externalId: string | null;
  role: string;
  content: unknown;
  parentId: string | null;
  runConfig: unknown;
  position: number;
  createdAt: Date;
};

type RuntimeSessionRow = {
  id: string;
  externalId: string | null;
  metadata: unknown;
  model?: string | null;
  updatedAt: Date;
};

type ThreadRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  title: string | null;
  model: string | null;
  workspace: string | null;
  codexRunConfig: unknown;
  createdAt: Date;
  messages: MessageRow[];
  runtimeSessions: RuntimeSessionRow[];
};

type CandidateItem = {
  threadId: string;
  userMessageId: string;
  assistantMessageId: string;
  organizationId?: string;
  userId?: string;
  channel: string;
  status: "pending" | "skipped_missing_input";
  reason?: string;
  codexHome?: string;
  relativeHome?: string;
  codexThreadId?: string;
  sessionId?: string;
  model?: string;
  prompt: string;
  answerText: string;
  promptChars: number;
  answerChars: number;
  hasExternalContext: boolean;
  completedAt?: Date;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function toDate(value: string | undefined, fallback?: Date): Date | undefined {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizeChannels(value: string[] | undefined): string[] {
  return [...new Set((value ?? [])
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

export function normalizeBackfillFilters(input: CodexMemoryBackfillFilters = {}): CodexMemoryBackfillFilters {
  const channels = normalizeChannels(input.channels);
  const limit = Number.isFinite(input.limit) && input.limit && input.limit > 0
    ? Math.min(Math.floor(input.limit), 20000)
    : undefined;
  return {
    ...(channels.length ? { channels } : {}),
    ...(trimOrUndefined(input.createdFrom) ? { createdFrom: trimOrUndefined(input.createdFrom) } : {}),
    ...(trimOrUndefined(input.createdTo) ? { createdTo: trimOrUndefined(input.createdTo) } : {}),
    ...(limit ? { limit } : {})
  };
}

export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => extractMessageTextPart(part))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  const record = asRecord(content);
  if (!record) return "";
  if (Array.isArray(record.content)) return extractMessageText(record.content);
  if (typeof record.content === "string") return record.content.trim();
  if (typeof record.text === "string") return record.text.trim();
  if (typeof record.markdown === "string") return record.markdown.trim();
  return "";
}

function extractMessageTextPart(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  const type = trimOrUndefined(record.type)?.toLowerCase();
  if (type === "text" || type === "input_text" || type === "output_text") {
    return trimOrUndefined(record.text) ?? trimOrUndefined(record.content) ?? "";
  }
  return "";
}

function isAssistantComplete(content: unknown): boolean {
  const record = asRecord(content);
  const status = asRecord(record?.status);
  const statusType = trimOrUndefined(status?.type)?.toLowerCase();
  const statusReason = trimOrUndefined(status?.reason)?.toLowerCase();
  if (statusType === "incomplete" || statusType === "error") return false;
  if (statusReason === "error") return false;
  return true;
}

export function buildUserAssistantPairs(messages: MessageRow[]): Array<{ user: MessageRow; assistant: MessageRow }> {
  const ordered = [...messages].sort((left, right) => {
    const byPosition = left.position - right.position;
    if (byPosition !== 0) return byPosition;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
  const pairs: Array<{ user: MessageRow; assistant: MessageRow }> = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const user = ordered[index];
    if (user.role !== "user") continue;
    const nextUserIndex = ordered.findIndex((message, messageIndex) => messageIndex > index && message.role === "user");
    const searchEnd = nextUserIndex >= 0 ? nextUserIndex : ordered.length;
    const directParentId = user.externalId || user.id;
    const parentMatch = ordered
      .slice(index + 1, searchEnd)
      .find((message) => message.role === "assistant" && message.parentId && message.parentId === directParentId);
    const nextAssistant = parentMatch ?? ordered
      .slice(index + 1, searchEnd)
      .find((message) => message.role === "assistant");
    if (nextAssistant) pairs.push({ user, assistant: nextAssistant });
  }
  return pairs;
}

export function inferBackfillChannel(input: {
  threadTitle?: string | null;
  workspace?: string | null;
  codexRunConfig?: Record<string, unknown>;
  userRunConfig?: Record<string, unknown>;
  assistantRunConfig?: Record<string, unknown>;
}): string {
  const configured =
    trimOrUndefined(input.userRunConfig?.channel) ??
    trimOrUndefined(input.assistantRunConfig?.channel) ??
    trimOrUndefined(input.codexRunConfig?.channel);
  if (configured) return configured.toLowerCase();
  const workspace = input.workspace ?? "";
  const title = input.threadTitle ?? "";
  if (workspace.includes("/integrations/zendesk/")) return "zendesk";
  if (workspace.includes("/integrations/openai-compatible/")) return "openai_compatible_api";
  if (/^crest\b/i.test(title)) return "crest";
  if (title.startsWith("钉钉")) return "dingtalk";
  return "portal";
}

function runConfigFrom(value: unknown): Record<string, unknown> | undefined {
  return asRecord(value) ?? undefined;
}

function runtimeRunConfig(runtimeSession?: RuntimeSessionRow): Record<string, unknown> | undefined {
  return asRecord(asRecord(runtimeSession?.metadata)?.codexRunConfig);
}

function runtimeCodexThreadId(runtimeSession?: RuntimeSessionRow): string | undefined {
  const metadata = asRecord(runtimeSession?.metadata);
  return trimOrUndefined(metadata?.codexThreadId);
}

function relativeHomeFromRoot(sessionHomeRoot: string, codexHome: string | undefined): string | undefined {
  const home = trimOrUndefined(codexHome);
  if (!home) return undefined;
  const relative = path.relative(path.resolve(sessionHomeRoot), path.resolve(home));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

function modeIdFromRunConfig(codexRunConfig?: Record<string, unknown>): string | undefined {
  return trimOrUndefined(codexRunConfig?.mode);
}

function resolveCodexHome(input: {
  sessionHomeRoot: string;
  thread: ThreadRow;
  channel: string;
  codexRunConfigs: Array<Record<string, unknown> | undefined>;
}): string | undefined {
  for (const config of input.codexRunConfigs) {
    const home = codexHomeFromRunConfig(config);
    if (home) return home;
  }
  const mergedConfig = input.codexRunConfigs.find(Boolean);
  const modeId = modeIdFromRunConfig(mergedConfig);
  if (!modeId || !input.thread.userId || !input.thread.organizationId) return undefined;
  if (input.channel !== "portal" && input.channel !== "dingtalk" && input.channel !== "crest") return undefined;
  const scope = buildSharedCodexHomeScope({
    actor: {
      organizationId: input.thread.organizationId,
      userId: input.thread.userId
    },
    modeId,
    codexRunConfig: mergedConfig
  });
  return path.join(input.sessionHomeRoot, ...scope.scopeSegments);
}

function hasExternalContext(configs: Array<Record<string, unknown> | undefined>): boolean {
  return configs.some((config) => codexRunConfigHasExternalContext(config));
}

function candidateStatus(input: { prompt: string; answerText: string; codexHome?: string; assistantContent: unknown }): {
  status: CandidateItem["status"];
  reason?: string;
} {
  if (!input.prompt) return { status: "skipped_missing_input", reason: "missing_prompt" };
  if (!isAssistantComplete(input.assistantContent)) return { status: "skipped_missing_input", reason: "assistant_incomplete" };
  if (!input.answerText) return { status: "skipped_missing_input", reason: "missing_answer" };
  if (!input.codexHome) return { status: "skipped_missing_input", reason: "missing_codex_home" };
  return { status: "pending" };
}

function resultCounterKey(status: CodexMemoryRunStatus): keyof Pick<
  CodexMemoryBackfillRunSummary,
  "writtenItems" | "skippedNoDurableItems" | "skippedMissingInputItems" | "failedItems"
> {
  if (status === "written") return "writtenItems";
  if (status === "skipped_no_durable_memory") return "skippedNoDurableItems";
  if (status === "skipped_missing_input") return "skippedMissingInputItems";
  return "failedItems";
}

function runSummary(row: {
  id: string;
  status: string;
  name: string | null;
  filters: unknown;
  dryRun: boolean;
  totalItems: number;
  processedItems: number;
  writtenItems: number;
  skippedNoDurableItems: number;
  skippedMissingInputItems: number;
  failedItems: number;
  alreadyProcessedItems: number;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CodexMemoryBackfillRunSummary {
  return {
    id: row.id,
    status: row.status as CodexMemoryBackfillRunStatus,
    ...(row.name ? { name: row.name } : {}),
    filters: normalizeBackfillFilters(asRecord(row.filters) as CodexMemoryBackfillFilters | undefined),
    dryRun: row.dryRun,
    totalItems: row.totalItems,
    processedItems: row.processedItems,
    writtenItems: row.writtenItems,
    skippedNoDurableItems: row.skippedNoDurableItems,
    skippedMissingInputItems: row.skippedMissingInputItems,
    failedItems: row.failedItems,
    alreadyProcessedItems: row.alreadyProcessedItems,
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export class CodexMemoryBackfillService {
  private activeRuns = new Set<string>();

  constructor(private readonly dependencies: {
    db: PrismaClient;
    memoryEngine: CodexMemoryEngine;
    sessionHomeRoot: string;
    logger?: Logger;
  }) {}

  async preview(filtersInput: CodexMemoryBackfillFilters = {}): Promise<CodexMemoryBackfillPreview> {
    const filters = normalizeBackfillFilters(filtersInput);
    const candidates = await this.collectCandidates(filters);
    const existingKeys = await this.existingCandidateKeys(candidates);
    return this.summarizeCandidates(candidates, existingKeys);
  }

  async listRuns(limit = 50): Promise<{ total: number; runs: CodexMemoryBackfillRunSummary[] }> {
    const take = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 50;
    const [total, rows] = await Promise.all([
      this.dependencies.db.codexMemoryBackfillRun.count(),
      this.dependencies.db.codexMemoryBackfillRun.findMany({
        orderBy: { createdAt: "desc" },
        take
      })
    ]);
    return {
      total,
      runs: rows.map(runSummary)
    };
  }

  async getRun(runId: string): Promise<CodexMemoryBackfillRunSummary | undefined> {
    const row = await this.dependencies.db.codexMemoryBackfillRun.findUnique({ where: { id: runId } });
    return row ? runSummary(row) : undefined;
  }

  async createRun(input: {
    filters?: CodexMemoryBackfillFilters;
    dryRun?: boolean;
    name?: string;
    requestedByUserId?: string;
  }): Promise<CodexMemoryBackfillRunSummary> {
    const filters = normalizeBackfillFilters(input.filters);
    const candidates = await this.collectCandidates(filters);
    const existingKeys = await this.existingCandidateKeys(candidates);
    const pendingCandidates = candidates.filter((candidate) => !existingKeys.has(candidateKey(candidate)));
    const initialSkipped = pendingCandidates.filter((candidate) => candidate.status === "skipped_missing_input").length;
    const now = new Date();
    const dryRun = Boolean(input.dryRun);
    const run = await this.dependencies.db.codexMemoryBackfillRun.create({
      data: {
        status: dryRun || pendingCandidates.length === initialSkipped ? "completed" : "queued",
        name: trimOrUndefined(input.name),
        requestedByUserId: trimOrUndefined(input.requestedByUserId),
        filters,
        dryRun,
        totalItems: pendingCandidates.length,
        processedItems: dryRun ? 0 : initialSkipped,
        skippedMissingInputItems: dryRun ? 0 : initialSkipped,
        alreadyProcessedItems: existingKeys.size,
        completedAt: dryRun || pendingCandidates.length === initialSkipped ? now : null
      }
    });

    if (!dryRun && pendingCandidates.length > 0) {
      await this.dependencies.db.codexMemoryBackfillItem.createMany({
        data: pendingCandidates.map((candidate) => ({
          runId: run.id,
          threadId: candidate.threadId,
          userMessageId: candidate.userMessageId,
          assistantMessageId: candidate.assistantMessageId,
          organizationId: candidate.organizationId,
          userId: candidate.userId,
          channel: candidate.channel,
          status: candidate.status,
          reason: candidate.reason,
          codexHome: candidate.codexHome,
          relativeHome: candidate.relativeHome,
          codexThreadId: candidate.codexThreadId,
          sessionId: candidate.sessionId,
          model: candidate.model,
          promptChars: candidate.promptChars,
          answerChars: candidate.answerChars,
          hasExternalContext: candidate.hasExternalContext,
          processedAt: candidate.status === "skipped_missing_input" ? now : null
        })),
        skipDuplicates: true
      });
      if (pendingCandidates.some((candidate) => candidate.status === "pending")) {
        this.startProcessing(run.id);
      }
    }

    return (await this.getRun(run.id)) ?? runSummary(run);
  }

  async pauseRun(runId: string): Promise<CodexMemoryBackfillRunSummary | undefined> {
    await this.dependencies.db.codexMemoryBackfillRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running"] } },
      data: { status: "paused" }
    });
    return await this.getRun(runId);
  }

  async resumeRun(runId: string): Promise<CodexMemoryBackfillRunSummary | undefined> {
    const run = await this.dependencies.db.codexMemoryBackfillRun.findUnique({ where: { id: runId } });
    if (!run || (run.status !== "paused" && run.status !== "failed" && run.status !== "queued")) {
      return run ? runSummary(run) : undefined;
    }
    await this.dependencies.db.codexMemoryBackfillItem.updateMany({
      where: { runId, status: "processing" },
      data: { status: "pending", reason: null, error: null }
    });
    await this.dependencies.db.codexMemoryBackfillRun.update({
      where: { id: runId },
      data: { status: "queued", completedAt: null, lastError: null }
    });
    this.startProcessing(runId);
    return await this.getRun(runId);
  }

  async cancelRun(runId: string): Promise<CodexMemoryBackfillRunSummary | undefined> {
    await this.dependencies.db.codexMemoryBackfillItem.updateMany({
      where: { runId, status: "pending" },
      data: { status: "cancelled", processedAt: new Date(), reason: "run_cancelled" }
    });
    await this.dependencies.db.codexMemoryBackfillRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running", "paused", "failed"] } },
      data: { status: "cancelled", completedAt: new Date() }
    });
    return await this.getRun(runId);
  }

  async resumePendingRuns(): Promise<void> {
    const rows = await this.dependencies.db.codexMemoryBackfillRun.findMany({
      where: { status: { in: ["queued", "running"] } },
      select: { id: true }
    });
    for (const row of rows) {
      await this.dependencies.db.codexMemoryBackfillItem.updateMany({
        where: { runId: row.id, status: "processing" },
        data: { status: "pending", reason: null, error: null }
      });
      this.startProcessing(row.id);
    }
  }

  private async collectCandidates(filters: CodexMemoryBackfillFilters): Promise<CandidateItem[]> {
    const createdFrom = toDate(filters.createdFrom);
    const createdTo = toDate(filters.createdTo);
    const threadWhere: Record<string, unknown> = {};
    if (createdFrom || createdTo) {
      threadWhere.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {})
      };
    }
    const rows = await this.dependencies.db.thread.findMany({
      where: threadWhere,
      include: {
        messages: {
          where: { role: { in: ["user", "assistant"] } },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }]
        },
        runtimeSessions: {
          orderBy: { updatedAt: "desc" },
          take: 1
        }
      },
      orderBy: { createdAt: "asc" }
    }) as unknown as ThreadRow[];
    const channels = new Set(normalizeChannels(filters.channels));
    const candidates: CandidateItem[] = [];
    for (const thread of rows) {
      const latestRuntime = thread.runtimeSessions[0];
      const threadRunConfig = runConfigFrom(thread.codexRunConfig);
      const latestRuntimeRunConfig = runtimeRunConfig(latestRuntime);
      for (const pair of buildUserAssistantPairs(thread.messages)) {
        const userRunConfig = runConfigFrom(pair.user.runConfig);
        const assistantRunConfig = runConfigFrom(pair.assistant.runConfig);
        const channel = inferBackfillChannel({
          threadTitle: thread.title,
          workspace: thread.workspace,
          codexRunConfig: threadRunConfig,
          userRunConfig,
          assistantRunConfig
        });
        if (channels.size > 0 && !channels.has(channel.toLowerCase())) continue;
        const codexRunConfigs = [assistantRunConfig, userRunConfig, threadRunConfig, latestRuntimeRunConfig];
        const codexHome = resolveCodexHome({
          sessionHomeRoot: this.dependencies.sessionHomeRoot,
          thread,
          channel,
          codexRunConfigs
        });
        const prompt = extractMessageText(pair.user.content);
        const answerText = extractMessageText(pair.assistant.content);
        const status = candidateStatus({
          prompt,
          answerText,
          codexHome,
          assistantContent: pair.assistant.content
        });
        candidates.push({
          threadId: thread.id,
          userMessageId: pair.user.id,
          assistantMessageId: pair.assistant.id,
          ...(thread.organizationId ? { organizationId: thread.organizationId } : {}),
          ...(thread.userId ? { userId: thread.userId } : {}),
          channel,
          status: status.status,
          reason: status.reason,
          codexHome,
          relativeHome: relativeHomeFromRoot(this.dependencies.sessionHomeRoot, codexHome),
          codexThreadId: runtimeCodexThreadId(latestRuntime),
          sessionId: trimOrUndefined(latestRuntime?.externalId),
          model: trimOrUndefined(thread.model),
          prompt,
          answerText,
          promptChars: prompt.length,
          answerChars: answerText.length,
          hasExternalContext: hasExternalContext(codexRunConfigs),
          completedAt: pair.assistant.createdAt
        });
        if (filters.limit && candidates.length >= filters.limit) return candidates;
      }
    }
    return candidates;
  }

  private async existingCandidateKeys(candidates: CandidateItem[]): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    const userMessageIds = [...new Set(candidates.map((candidate) => candidate.userMessageId))];
    const existing = await this.dependencies.db.codexMemoryBackfillItem.findMany({
      where: { userMessageId: { in: userMessageIds } },
      select: {
        userMessageId: true,
        assistantMessageId: true
      }
    });
    return new Set(existing.map((item) => `${item.userMessageId}:${item.assistantMessageId}`));
  }

  private summarizeCandidates(candidates: CandidateItem[], existingKeys: Set<string>): CodexMemoryBackfillPreview {
    const byChannel = new Map<string, CodexMemoryBackfillChannelSummary>();
    let readyItems = 0;
    let skippedMissingInput = 0;
    let alreadyProcessed = 0;
    for (const candidate of candidates) {
      const summary = byChannel.get(candidate.channel) ?? {
        channel: candidate.channel,
        totalPairs: 0,
        readyItems: 0,
        skippedMissingInput: 0,
        alreadyProcessed: 0
      };
      summary.totalPairs += 1;
      if (existingKeys.has(candidateKey(candidate))) {
        alreadyProcessed += 1;
        summary.alreadyProcessed += 1;
      } else if (candidate.status === "pending") {
        readyItems += 1;
        summary.readyItems += 1;
      } else {
        skippedMissingInput += 1;
        summary.skippedMissingInput += 1;
      }
      byChannel.set(candidate.channel, summary);
    }
    return {
      totalPairs: candidates.length,
      readyItems,
      skippedMissingInput,
      alreadyProcessed,
      estimatedLlmCalls: readyItems,
      byChannel: [...byChannel.values()].sort((left, right) => right.totalPairs - left.totalPairs)
    };
  }

  private startProcessing(runId: string): void {
    if (this.activeRuns.has(runId)) return;
    this.activeRuns.add(runId);
    void this.processRun(runId).finally(() => {
      this.activeRuns.delete(runId);
    });
  }

  private async processRun(runId: string): Promise<void> {
    try {
      await this.dependencies.db.codexMemoryBackfillRun.updateMany({
        where: { id: runId, status: "queued" },
        data: { status: "running", startedAt: new Date(), completedAt: null, lastError: null }
      });
      while (true) {
        const run = await this.dependencies.db.codexMemoryBackfillRun.findUnique({ where: { id: runId } });
        if (!run || run.status === "paused" || run.status === "cancelled" || run.status === "completed") return;
        const item = await this.dependencies.db.codexMemoryBackfillItem.findFirst({
          where: { runId, status: "pending" },
          orderBy: { createdAt: "asc" }
        });
        if (!item) {
          await this.dependencies.db.codexMemoryBackfillRun.update({
            where: { id: runId },
            data: { status: "completed", completedAt: new Date() }
          });
          return;
        }
        await this.dependencies.db.codexMemoryBackfillItem.update({
          where: { id: item.id },
          data: { status: "processing", reason: null, error: null }
        });
        await this.processItem(runId, item.id);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.dependencies.logger?.warn?.("codex memory backfill failed", { runId, detail });
      await this.dependencies.db.codexMemoryBackfillRun.updateMany({
        where: { id: runId },
        data: { status: "failed", lastError: detail, completedAt: new Date() }
      });
    }
  }

  private async processItem(runId: string, itemId: string): Promise<void> {
    const item = await this.dependencies.db.codexMemoryBackfillItem.findUnique({ where: { id: itemId } });
    if (!item) return;
    const [userMessage, assistantMessage] = await Promise.all([
      this.dependencies.db.message.findUnique({ where: { id: item.userMessageId } }),
      this.dependencies.db.message.findUnique({ where: { id: item.assistantMessageId } })
    ]);
    const prompt = extractMessageText(userMessage?.content);
    const answerText = extractMessageText(assistantMessage?.content);
    const missingReason =
      !prompt ? "missing_prompt" :
      !isAssistantComplete(assistantMessage?.content) ? "assistant_incomplete" :
      !answerText ? "missing_answer" :
      !item.codexHome ? "missing_codex_home" :
      undefined;
    if (missingReason) {
      await this.markItemResult(runId, itemId, "skipped_missing_input", missingReason);
      return;
    }
    try {
      const result = await this.dependencies.memoryEngine.processRunAndLog({
        channel: item.channel,
        prompt,
        answerText,
        codexHome: item.codexHome ?? undefined,
        codexThreadId: item.codexThreadId ?? undefined,
        sessionId: item.sessionId ?? undefined,
        threadId: item.threadId,
        organizationId: item.organizationId ?? undefined,
        userId: item.userId ?? undefined,
        model: item.model ?? undefined,
        hasExternalContext: item.hasExternalContext,
        completedAt: assistantMessage?.createdAt ?? new Date(),
        metadata: {
          source: "historical_backfill",
          backfillRunId: runId,
          backfillItemId: itemId,
          userMessageId: item.userMessageId,
          assistantMessageId: item.assistantMessageId
        }
      });
      await this.markItemResult(runId, itemId, result.status, result.reason, {
        memoryRunLogId: result.id,
        error: result.error
      });
    } catch (error) {
      await this.markItemResult(runId, itemId, "failed", "exception", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async markItemResult(
    runId: string,
    itemId: string,
    status: CodexMemoryRunStatus,
    reason: string,
    extra: { memoryRunLogId?: string; error?: string } = {}
  ): Promise<void> {
    const counterKey = resultCounterKey(status);
    await this.dependencies.db.$transaction(async (tx) => {
      await tx.codexMemoryBackfillItem.update({
        where: { id: itemId },
        data: {
          status,
          reason,
          memoryRunLogId: extra.memoryRunLogId,
          error: extra.error,
          processedAt: new Date()
        }
      });
      await tx.codexMemoryBackfillRun.update({
        where: { id: runId },
        data: {
          processedItems: { increment: 1 },
          [counterKey]: { increment: 1 }
        }
      });
    });
  }
}

function candidateKey(candidate: Pick<CandidateItem, "userMessageId" | "assistantMessageId">): string {
  return `${candidate.userMessageId}:${candidate.assistantMessageId}`;
}
