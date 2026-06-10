import {
  collectRuntimeCompletion,
  type RuntimeCompletionTextMode,
  type RuntimeStreamEvent,
  type RuntimeUsageSnapshot,
  streamRuntimeCompletionWithBestEffortUsage
} from "../live-runtime-session.js";

export type CodexStreamCompletionInput = Parameters<typeof streamRuntimeCompletionWithBestEffortUsage>[0];
export type CodexCollectCompletionInput = Parameters<typeof collectRuntimeCompletion>[0];
export type CodexCompletionResult = { answer: string; usage?: RuntimeUsageSnapshot };
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
  toolCall?: CodexProjectedToolCall;
  traceRows: CodexTraceRow[];
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

export class CodexExecutionService {
  async streamCompletion(input: CodexStreamCompletionInput): Promise<void> {
    await streamRuntimeCompletionWithBestEffortUsage(input);
  }

  async streamFromRuntime<TThread>(input: Omit<CodexStreamCompletionInput, "events"> & {
    runtime: RuntimeStreamSource<TThread>;
    thread: TThread;
    prompt: string;
  }): Promise<void> {
    await streamRuntimeCompletionWithBestEffortUsage({
      events: input.runtime.runStreamed(input.thread, input.prompt),
      onEvent: input.onEvent,
      onDone: input.onDone,
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
  }): Promise<CodexCompletionResult> {
    return await collectRuntimeCompletion({
      events: input.runtime.runStreamed(input.thread, input.prompt),
      textMode: input.textMode,
      onEvent: input.onEvent,
      onUsage: input.onUsage,
      onTextDelta: input.onTextDelta
    });
  }
}
