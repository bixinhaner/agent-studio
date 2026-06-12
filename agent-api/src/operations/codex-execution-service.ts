import {
  collectRuntimeCompletion,
  type RuntimeCompletionTextMode,
  type RuntimeStreamEvent,
  type RuntimeUsageSnapshot,
  streamRuntimeCompletionWithBestEffortUsage
} from "../live-runtime-session.js";
import type { CodexMemoryRunInput, CodexMemoryRunRecorder } from "../codex-memory/engine.js";

export type CodexStreamCompletionInput = Parameters<typeof streamRuntimeCompletionWithBestEffortUsage>[0];
export type CodexCollectCompletionInput = Parameters<typeof collectRuntimeCompletion>[0];
export type CodexCompletionResult = { answer: string; usage?: RuntimeUsageSnapshot };
export type CodexCompletionMemoryInput = Omit<CodexMemoryRunInput, "answerText" | "completedAt">;
export type CodexTraceKind = "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
export type CodexTraceRow = {
  id?: string;
  kind: CodexTraceKind;
  title: string;
  detail?: string;
  rawDetail?: string;
  at?: string;
};
export type CodexProjectedToolCall = {
  id?: string;
  name: string;
  server?: string;
  tool?: string;
  args: Record<string, unknown>;
  result?: unknown;
  errorMessage?: string;
};
export type CodexRuntimeEventProjection = {
  eventType: string;
  itemType: string;
  itemId?: string;
  answerDelta?: string;
  reasoningText?: string;
  completedAgentMessage?: {
    id?: string;
    text: string;
  };
  toolCall?: CodexProjectedToolCall;
  traceRows: CodexTraceRow[];
  liveCommentaryEntries?: CodexCommentaryEntry[];
};
export type CodexCommentaryEntry = {
  id: string;
  text: string;
  lines: string[];
  last_event_at?: number;
  status: "streaming" | "completed";
};
export type CodexRunProjectionFinalizeInput = {
  finalAnswer?: string;
};
export type CodexRunProjectionFinalized = {
  commentaryEntries: CodexCommentaryEntry[];
  liveCommentaryEntries: CodexCommentaryEntry[];
  traceRows: CodexTraceRow[];
  contentParts: Record<string, unknown>[];
};
export type CodexRunProjectionOptions = {
  now?: () => number;
  streamAnswerDeltas?: boolean;
};

type RuntimeStreamSource<TThread> = {
  runStreamed(thread: TThread, message: string): AsyncIterable<RuntimeStreamEvent>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function shortenText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function stringifyDetail(value: unknown, max = 1200): string | undefined {
  if (typeof value === "string") return shortenText(value, max);
  if (value === undefined || value === null) return undefined;
  try {
    return shortenText(JSON.stringify(value), max);
  } catch {
    return shortenText(String(value), max);
  }
}

function normalizeComparableText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function commentaryLinesFromText(value: string): string[] {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function removeFinalAnswerFromCommentaryText(text: string, finalAnswer: string | undefined): string | undefined {
  const normalizedText = text.trim();
  const normalizedFinal = trimOrUndefined(finalAnswer);
  if (!normalizedText) return undefined;
  if (!normalizedFinal) return normalizedText;

  const comparableText = normalizeComparableText(normalizedText);
  const comparableFinal = normalizeComparableText(normalizedFinal);
  if (!comparableFinal) return normalizedText;
  if (comparableText === comparableFinal) return undefined;
  if (!comparableText.endsWith(comparableFinal)) return normalizedText;

  const exactIndex = normalizedText.lastIndexOf(normalizedFinal);
  if (exactIndex > 0) {
    return trimOrUndefined(normalizedText.slice(0, exactIndex));
  }

  const lines = normalizedText.split(/\n+/);
  while (lines.length > 0 && normalizeComparableText(lines.join("\n")).endsWith(comparableFinal)) {
    lines.pop();
  }
  return trimOrUndefined(lines.join("\n"));
}

function mcpToolCallDetail(input: { server?: string; tool?: string; errorMessage?: string }): string | undefined {
  return [
    input.server ? `server: ${input.server}` : "",
    input.tool ? `tool: ${input.tool}` : "",
    input.errorMessage ? `error: ${shortenText(input.errorMessage, 400)}` : ""
  ]
    .filter(Boolean)
    .join("\n") || undefined;
}

function traceRow(
  itemId: string | undefined,
  index: string,
  row: Omit<CodexTraceRow, "id" | "at"> & { at?: string }
): CodexTraceRow {
  return {
    ...row,
    id: itemId ? `${itemId}-${index}` : undefined,
    at: row.at ?? new Date().toISOString()
  };
}

export function projectCodexRuntimeEvent(event: RuntimeStreamEvent): CodexRuntimeEventProjection {
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  const eventType = trimOrUndefined(event.type) ?? trimOrUndefined(raw?.type) ?? "";
  const itemType = trimOrUndefined(item?.type) ?? "";
  const itemId = trimOrUndefined(item?.id);
  const isStarted = eventType === "item.started";
  const isCompleted = eventType === "item.completed";
  const traceRows: CodexTraceRow[] = [];
  const projection: CodexRuntimeEventProjection = {
    eventType,
    itemType,
    itemId,
    answerDelta: itemType === "agent_message" ? trimOrUndefined(event.delta) : undefined,
    traceRows
  };

  if (itemType === "agent_message" && isCompleted) {
    const text = trimOrUndefined(item?.text) ?? trimOrUndefined(event.text);
    if (text) {
      projection.completedAgentMessage = {
        id: itemId,
        text
      };
    }
    return projection;
  }

  if (itemType === "reasoning" && isCompleted) {
    const reasoningText = trimOrUndefined(item?.text) ?? trimOrUndefined(event.text);
    if (reasoningText) {
      projection.reasoningText = reasoningText;
      traceRows.push(traceRow(itemId, "reasoning", {
        kind: "reasoning",
        title: "Reasoning summary",
        detail: shortenText(reasoningText, 1800)
      }));
    }
    return projection;
  }

  if (itemType === "mcp_tool_call" && isCompleted) {
    const server = trimOrUndefined(item?.server);
    const tool = trimOrUndefined(item?.tool);
    const args = asRecord(item?.arguments) ?? {};
    const error = asRecord(item?.error);
    const errorMessage = trimOrUndefined(error?.message);
    const result = item?.result;
    const name = [server, tool].filter(Boolean).join(".") || "mcp_tool_call";
    const detail = mcpToolCallDetail({ server, tool, errorMessage });
    projection.toolCall = {
      id: itemId,
      name,
      server,
      tool,
      args,
      result,
      errorMessage
    };
    traceRows.push(traceRow(itemId, "tool", {
      kind: errorMessage ? "error" : "tool",
      title: `Tool call ${errorMessage ? "failed" : "completed"}`,
      detail: errorMessage ? "Tool execution failed." : detail,
      rawDetail: errorMessage ? detail : undefined
    }));
    return projection;
  }

  if (itemType === "command_execution" && isCompleted) {
    const command = trimOrUndefined(item?.command);
    const status = trimOrUndefined(item?.status);
    const exitCode = typeof item?.exit_code === "number" ? item.exit_code : undefined;
    const output = trimOrUndefined(item?.aggregated_output);
    traceRows.push(traceRow(itemId, "command", {
      kind: exitCode && exitCode !== 0 ? "error" : "process",
      title: `Command execution ${status ?? ""}`.trim(),
      detail:
        [command ? `$ ${command}` : "", exitCode !== undefined ? `exit_code=${exitCode}` : ""]
          .filter(Boolean)
          .join("\n") || undefined,
      rawDetail: output ? shortenText(output, 1800) : undefined
    }));
    return projection;
  }

  if (itemType === "web_search" && isCompleted) {
    const query = trimOrUndefined(item?.query);
    if (query) {
      traceRows.push(traceRow(itemId, "web-search", {
        kind: "process",
        title: "Web search",
        detail: query
      }));
    }
    return projection;
  }

  if (itemType === "todo_list" && (isStarted || isCompleted)) {
    const items = Array.isArray(item?.items) ? item.items : [];
    const detail = items
      .slice(0, 20)
      .map((entry) => {
        const row = asRecord(entry);
        if (!row) return "";
        const text = trimOrUndefined(row.text);
        if (!text) return "";
        return `${row.completed === true ? "[x]" : "[ ]"} ${text}`;
      })
      .filter(Boolean)
      .join("\n");
    traceRows.push(traceRow(itemId, "todo", {
      kind: "process",
      title: "Execution plan",
      detail: detail || undefined
    }));
    return projection;
  }

  if (itemType === "file_change" && isCompleted) {
    const changes = Array.isArray(item?.changes) ? item.changes : [];
    const detail = changes
      .slice(0, 30)
      .map((entry) => {
        const row = asRecord(entry);
        const filePath = trimOrUndefined(row?.path);
        if (!filePath) return "";
        return `${trimOrUndefined(row?.kind) ?? "update"}: ${filePath}`;
      })
      .filter(Boolean)
      .join("\n");
    traceRows.push(traceRow(itemId, "file-change", {
      kind: "process",
      title: "File changes",
      detail: detail || undefined
    }));
    return projection;
  }

  if (itemType === "error" && isCompleted) {
    const message = trimOrUndefined(item?.message) ?? trimOrUndefined(event.text);
    traceRows.push(traceRow(itemId, "error", {
      kind: "error",
      title: "Execution error",
      detail: message ? shortenText(message, 1200) : undefined
    }));
    return projection;
  }

  if (
    itemType &&
    (isStarted || isCompleted) &&
    ![
      "agent_message",
      "reasoning",
      "mcp_tool_call",
      "command_execution",
      "web_search",
      "todo_list",
      "file_change",
      "error"
    ].includes(itemType)
  ) {
    traceRows.push(traceRow(itemId, "process", {
      kind: "process",
      title: `Process event ${eventType}`,
      detail: stringifyDetail(item, 800)
    }));
  }

  return projection;
}

export function codexTraceRowsToContentPart(rows: CodexTraceRow[]): Record<string, unknown> | undefined {
  const normalized = rows
    .map((row, index) => ({
      id: trimOrUndefined(row.id) ?? `codex-trace-row-${index + 1}`,
      kind: row.kind,
      title: trimOrUndefined(row.title) ?? "Process event",
      detail: trimOrUndefined(row.detail),
      rawDetail: trimOrUndefined(row.rawDetail),
      at: trimOrUndefined(row.at)
    }))
    .filter((row) => row.title || row.detail || row.rawDetail);
  if (normalized.length === 0) return undefined;
  return {
    type: "data",
    name: "codex_trace_batch",
    data: {
      batch_id: 1,
      open: false,
      active_row_id: "",
      rows: normalized
    }
  };
}

function normalizeTraceRows(rows: CodexTraceRow[], input: CodexRunProjectionFinalizeInput = {}): CodexTraceRow[] {
  return rows
    .map((row) => {
      if (row.kind !== "reasoning") return row;
      const detail = row.detail ? removeFinalAnswerFromCommentaryText(row.detail, input.finalAnswer) : undefined;
      const rawDetail = row.rawDetail ? removeFinalAnswerFromCommentaryText(row.rawDetail, input.finalAnswer) : undefined;
      if (!detail && !rawDetail) return undefined;
      return {
        ...row,
        detail,
        rawDetail
      };
    })
    .filter((row): row is CodexTraceRow => Boolean(row));
}

function normalizeCommentaryEntries(
  entries: CodexCommentaryEntry[],
  input: CodexRunProjectionFinalizeInput = {}
): CodexCommentaryEntry[] {
  const finalComparable = normalizeComparableText(input.finalAnswer);
  const normalized: CodexCommentaryEntry[] = [];
  entries.forEach((entry, index) => {
    const text = removeFinalAnswerFromCommentaryText(trimOrUndefined(entry.text) ?? "", input.finalAnswer);
    if (!text) return;
    if (finalComparable && normalizeComparableText(text) === finalComparable) return;
    const lines = commentaryLinesFromText(text);
    const lastEventAt = typeof entry.last_event_at === "number" && Number.isFinite(entry.last_event_at) ? entry.last_event_at : undefined;
    normalized.push({
      id: trimOrUndefined(entry.id) ?? `codex-commentary-${index + 1}`,
      text,
      lines: lines.length > 0 ? lines : [text],
      ...(lastEventAt !== undefined ? { last_event_at: lastEventAt } : {}),
      status: "completed"
    });
  });
  return normalized;
}

export function codexCommentaryEntriesToContentPart(
  entries: CodexCommentaryEntry[],
  input: CodexRunProjectionFinalizeInput = {}
): Record<string, unknown> | undefined {
  const normalized = normalizeCommentaryEntries(entries, input);
  if (normalized.length === 0) return undefined;

  const texts = normalized.map((entry) => entry.text.trim()).filter(Boolean);
  const latestEventAt = normalized
    .map((entry) => entry.last_event_at)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  return {
    type: "data",
    name: "codex_commentary",
    data: {
      id: "assistant-thoughts",
      text: texts.join("\n\n"),
      lines: texts,
      entries: normalized,
      open: false,
      status: "completed",
      last_event_at: latestEventAt
    }
  };
}

export class CodexRunProjection {
  private readonly traceRows: CodexTraceRow[] = [];
  private readonly commentaryEntries: CodexCommentaryEntry[] = [];
  private pendingLiveCommentaryEntry: CodexCommentaryEntry | undefined;
  private commentarySeq = 0;

  constructor(private readonly options: CodexRunProjectionOptions = {}) {}

  push(event: RuntimeStreamEvent): CodexRuntimeEventProjection {
    const projection = projectCodexRuntimeEvent(event);
    if (this.options.streamAnswerDeltas === false) {
      projection.answerDelta = undefined;
    }
    this.traceRows.push(...projection.traceRows);
    if (projection.completedAgentMessage) {
      const nextEntry = this.upsertCommentaryEntry(projection.completedAgentMessage);
      projection.liveCommentaryEntries = this.pendingLiveCommentaryEntry ? [this.pendingLiveCommentaryEntry] : [];
      this.pendingLiveCommentaryEntry = nextEntry;
    }
    return projection;
  }

  finalize(input: CodexRunProjectionFinalizeInput = {}): CodexRunProjectionFinalized {
    const commentaryEntries = normalizeCommentaryEntries(this.commentaryEntries, input);
    const liveCommentaryEntries = normalizeCommentaryEntries(
      this.pendingLiveCommentaryEntry ? [this.pendingLiveCommentaryEntry] : [],
      input
    );
    const traceRows = normalizeTraceRows(this.traceRows, input);
    const commentaryPart = codexCommentaryEntriesToContentPart(commentaryEntries);
    const tracePart = codexTraceRowsToContentPart(traceRows);
    return {
      commentaryEntries,
      liveCommentaryEntries,
      traceRows,
      contentParts: [commentaryPart, tracePart].filter((part): part is Record<string, unknown> => Boolean(part))
    };
  }

  reset(): void {
    this.traceRows.length = 0;
    this.commentaryEntries.length = 0;
    this.pendingLiveCommentaryEntry = undefined;
    this.commentarySeq = 0;
  }

  private upsertCommentaryEntry(message: { id?: string; text: string }): CodexCommentaryEntry | undefined {
    const text = trimOrUndefined(message.text);
    if (!text) return undefined;
    const id = trimOrUndefined(message.id) ?? `codex-commentary-${++this.commentarySeq}`;
    const next: CodexCommentaryEntry = {
      id,
      text,
      lines: commentaryLinesFromText(text),
      last_event_at: this.options.now?.() ?? Date.now(),
      status: "completed"
    };
    const existingIndex = this.commentaryEntries.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) {
      this.commentaryEntries[existingIndex] = next;
      return next;
    }
    this.commentaryEntries.push(next);
    return next;
  }
}

export class CodexExecutionService {
  constructor(private readonly dependencies: { memory?: CodexMemoryRunRecorder } = {}) {}

  private enqueueMemoryRun(input: CodexCompletionMemoryInput | undefined, result: CodexCompletionResult): void {
    if (!input) return;
    const answerText = trimOrUndefined(result.answer);
    if (!answerText) return;
    void Promise.resolve(this.dependencies.memory?.enqueueRun({
      ...input,
      answerText,
      completedAt: new Date()
    })).catch((error) => {
      console.warn("codex memory enqueue failed", {
        channel: input.channel,
        sessionId: input.sessionId,
        threadId: input.threadId,
        detail: error instanceof Error ? error.message : String(error)
      });
    });
  }

  async streamCompletion(input: CodexStreamCompletionInput): Promise<void> {
    await streamRuntimeCompletionWithBestEffortUsage(input);
  }

  async streamFromRuntime<TThread>(input: Omit<CodexStreamCompletionInput, "events"> & {
    runtime: RuntimeStreamSource<TThread>;
    thread: TThread;
    prompt: string;
    memory?: CodexCompletionMemoryInput;
  }): Promise<void> {
    await streamRuntimeCompletionWithBestEffortUsage({
      events: input.runtime.runStreamed(input.thread, input.prompt),
      onEvent: input.onEvent,
      onDone: async (payload) => {
        await input.onDone?.(payload);
        this.enqueueMemoryRun(input.memory, payload);
      },
      recordUsage: input.recordUsage,
      onTelemetryError: input.onTelemetryError
    });
  }

  async collectCompletion(input: CodexCollectCompletionInput): Promise<CodexCompletionResult> {
    return await collectRuntimeCompletion(input);
  }

  async collectFromRuntime<TThread>(input: {
    runtime: RuntimeStreamSource<TThread>;
    thread: TThread;
    prompt: string;
    textMode?: RuntimeCompletionTextMode;
    onEvent?(event: RuntimeStreamEvent): void | Promise<void>;
    onUsage?(usage: RuntimeUsageSnapshot, event: RuntimeStreamEvent): void | Promise<void>;
    onTextDelta?(delta: string, event: RuntimeStreamEvent): void | Promise<void>;
    memory?: CodexCompletionMemoryInput;
  }): Promise<CodexCompletionResult> {
    const result = await collectRuntimeCompletion({
      events: input.runtime.runStreamed(input.thread, input.prompt),
      textMode: input.textMode,
      onEvent: input.onEvent,
      onUsage: input.onUsage,
      onTextDelta: input.onTextDelta
    });
    this.enqueueMemoryRun(input.memory, result);
    return result;
  }
}
