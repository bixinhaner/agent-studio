/**
 * Local-computer activity in the admin transcript: where each turn ran (cloud or a
 * folder on the user's computer), what the agent did there, and when the user switched
 * folders. The portal shows these as workspace picker state and local tool cards; the
 * admin console needs the same picture, with full operation details for troubleshooting.
 */
export type TranscriptExecutionLocation = {
  mode: "local" | "cloud";
  deviceName: string | null;
  platform: string | null;
  path: string | null;
  label: string | null;
  /** recorded: saved with the turn; derived: inferred from the folder switch history. */
  source: "recorded" | "derived";
};

export type TranscriptLocalOperationStatus = "completed" | "pending" | "cancelled" | "expired" | "unknown";

export type TranscriptLocalOperation = {
  id: string;
  op: string;
  /** agent: tool call during a turn; portal: the user's open/download action; message: only the chat card survives. */
  source: "agent" | "portal" | "backfill" | "message";
  status: TranscriptLocalOperationStatus;
  ok: boolean | null;
  /** Main subject: file path, shell command or process id. */
  target: string | null;
  destination: string | null;
  error: string | null;
  exitCode: number | null;
  running: boolean | null;
  deviceName: string | null;
  platform: string | null;
  rootPath: string | null;
  createdAt: string | null;
  completedAt: string | null;
  /** Full args/result are stored and loaded on demand (they can be whole files or long output). */
  hasDetail: boolean;
  argsChars: number;
  resultChars: number;
};

export type TranscriptLocalEvent = {
  id: string;
  kind: "bound" | "switched" | "unbound" | "operation";
  at: string;
  from: TranscriptExecutionLocation | null;
  to: TranscriptExecutionLocation | null;
  operation?: TranscriptLocalOperation;
  /** Backfilled from the binding that existed when history recording started. */
  backfilled?: boolean;
};

export type LocalOperationLogRow = {
  id: string;
  threadId: string | null;
  deviceName: string | null;
  platform: string | null;
  rootPath: string | null;
  source: string;
  op: string;
  args: unknown;
  status: string;
  result: unknown;
  createdAt: Date | string;
  completedAt: Date | string | null;
};

export type LocalBindingEventRow = {
  id: string;
  kind: string;
  fromPath: string | null;
  fromLabel: string | null;
  fromDeviceName: string | null;
  fromPlatform: string | null;
  toPath: string | null;
  toLabel: string | null;
  toDeviceName: string | null;
  toPlatform: string | null;
  createdAt: Date | string;
};

type UnknownRecord = Record<string, unknown>;

type TranscriptMessageLike = {
  id: string;
  role: string;
  parentId: string | null;
  createdAt: string | null;
};

const EXECUTION_LOCATION_RUN_CONFIG_KEY = "_agentStudioExecutionLocation";
/** Same as the delivery deadline: a command still pending after this has an unknown outcome. */
const COMMAND_DEADLINE_MS = 10 * 60_000;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timeOf(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function jsonChars(value: unknown): number {
  if (value === undefined || value === null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function operationTarget(op: string, args: UnknownRecord | null, result: UnknownRecord | null): string | null {
  if (op === "exec") return text(args?.command);
  if (op === "process") return text(args?.process_id) ?? text(result?.process_id);
  if (op === "request_result") return text(args?.request_id);
  // The executor resolves relative paths; the absolute one is what the portal card shows.
  return text(result?.path) ?? text(args?.path);
}

function normalizeStatus(status: string, createdAt: string | null, now: number): TranscriptLocalOperationStatus {
  if (status === "completed" || status === "cancelled") return status;
  if (status === "pending") {
    const created = timeOf(createdAt);
    return !Number.isNaN(created) && now - created > COMMAND_DEADLINE_MS ? "expired" : "pending";
  }
  return "unknown";
}

export function summarizeLocalOperation(row: LocalOperationLogRow, now = Date.now()): TranscriptLocalOperation {
  const args = asRecord(row.args);
  const result = asRecord(row.result);
  const createdAt = iso(row.createdAt);
  const status = normalizeStatus(row.status, createdAt, now);
  const exitCode = typeof result?.exit_code === "number" ? result.exit_code : null;
  return {
    id: row.id,
    op: row.op,
    source: row.source === "portal" || row.source === "backfill" ? row.source : "agent",
    status,
    ok: status === "completed" ? result?.ok !== false : status === "pending" ? null : false,
    target: operationTarget(row.op, args, result),
    destination: text(args?.destination),
    error: text(result?.error) ?? text(result?.message) ?? (status === "expired" ? "REQUEST_EXPIRED_OUTCOME_UNKNOWN" : null),
    exitCode,
    running: typeof result?.running === "boolean" ? result.running : null,
    deviceName: row.deviceName ?? null,
    platform: row.platform ?? null,
    rootPath: row.rootPath ?? null,
    createdAt,
    completedAt: iso(row.completedAt),
    hasDetail: true,
    argsChars: jsonChars(row.args),
    resultChars: jsonChars(row.result)
  };
}

/** Messages older than the audit log only keep the portal's result card. */
function operationsFromMessageParts(message: unknown): TranscriptLocalOperation[] {
  const parts = asRecord(message)?.content;
  if (!Array.isArray(parts)) return [];
  const operations: TranscriptLocalOperation[] = [];
  for (const [index, entry] of parts.entries()) {
    const part = asRecord(entry);
    const toolName = text(part?.toolName);
    if (part?.type !== "tool-call" || !toolName?.startsWith("local_computer.")) continue;
    const op = toolName.slice("local_computer.".length).replace(/^local_/, "");
    const result = asRecord(part.result);
    const ok = part.isError === true || result?.ok === false ? false : result ? true : null;
    operations.push({
      id: text(part.toolCallId) ?? `local-part-${index + 1}`,
      op,
      source: "message",
      status: result?.pending === true ? "pending" : result ? "completed" : "unknown",
      ok,
      target: text(result?.path),
      destination: null,
      error: text(result?.error),
      exitCode: null,
      running: null,
      deviceName: text(result?.device_name),
      platform: null,
      rootPath: null,
      createdAt: null,
      completedAt: null,
      hasDetail: false,
      argsChars: 0,
      resultChars: 0
    });
  }
  return operations;
}

function recordedLocation(runConfig: unknown): TranscriptExecutionLocation | null {
  const location = asRecord(asRecord(runConfig)?.[EXECUTION_LOCATION_RUN_CONFIG_KEY]);
  if (!location) return null;
  if (location.mode === "cloud") {
    return { mode: "cloud", deviceName: null, platform: null, path: null, label: null, source: "recorded" };
  }
  if (location.mode !== "local") return null;
  return {
    mode: "local",
    deviceName: text(location.deviceName),
    platform: text(location.platform),
    path: text(location.path),
    label: text(location.label),
    source: "recorded"
  };
}

function eventSide(event: LocalBindingEventRow, side: "from" | "to"): TranscriptExecutionLocation | null {
  const path = side === "from" ? event.fromPath : event.toPath;
  if (!path) return null;
  return {
    mode: "local",
    deviceName: (side === "from" ? event.fromDeviceName : event.toDeviceName) ?? null,
    platform: (side === "from" ? event.fromPlatform : event.toPlatform) ?? null,
    path,
    label: (side === "from" ? event.fromLabel : event.toLabel) ?? null,
    source: "derived"
  };
}

const CLOUD_DERIVED: TranscriptExecutionLocation = {
  mode: "cloud",
  deviceName: null,
  platform: null,
  path: null,
  label: null,
  source: "derived"
};

function locationAt(events: LocalBindingEventRow[], at: number): TranscriptExecutionLocation | null {
  let latest: LocalBindingEventRow | null = null;
  for (const event of events) {
    const eventAt = timeOf(iso(event.createdAt));
    if (Number.isNaN(eventAt) || eventAt > at) continue;
    latest = event;
  }
  if (latest) return eventSide(latest, "to") ?? CLOUD_DERIVED;
  // Before the first recorded switch: only a real "bound" event proves it was cloud before.
  const first = events[0];
  if (first && first.kind === "bound" && !first.id.startsWith("backfill-")) return CLOUD_DERIVED;
  return null;
}

export function attachLocalActivity<T extends TranscriptMessageLike>(
  transcript: T[],
  rawMessages: Array<{ message: unknown; runConfig?: unknown }>,
  input: { operations: LocalOperationLogRow[]; bindingEvents: LocalBindingEventRow[]; now?: number }
): {
  messages: Array<T & { executionLocation?: TranscriptExecutionLocation; localOperations?: TranscriptLocalOperation[] }>;
  events: TranscriptLocalEvent[];
} {
  const now = input.now ?? Date.now();
  const bindingEvents = [...input.bindingEvents].sort(
    (left, right) => timeOf(iso(left.createdAt)) - timeOf(iso(right.createdAt))
  );
  const operations = input.operations
    .map((row) => summarizeLocalOperation(row, now))
    .sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt));

  // Agent operations belong to the turn whose user message was sent last before them.
  const userTurns = transcript
    .filter((message) => message.role === "user" && !Number.isNaN(timeOf(message.createdAt)))
    .sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt));
  const assistantByUser = new Map<string, string>();
  for (const message of transcript) {
    if (message.role === "assistant" && message.parentId) assistantByUser.set(message.parentId, message.id);
  }
  const operationsByAssistant = new Map<string, TranscriptLocalOperation[]>();
  const events: TranscriptLocalEvent[] = [];
  for (const operation of operations) {
    const at = timeOf(operation.createdAt);
    let owner: string | undefined;
    if (operation.source !== "portal" && !Number.isNaN(at)) {
      const turn = [...userTurns].reverse().find((message) => timeOf(message.createdAt) <= at);
      owner = turn ? assistantByUser.get(turn.id) : undefined;
    }
    if (owner) {
      operationsByAssistant.set(owner, [...(operationsByAssistant.get(owner) ?? []), operation]);
    } else if (operation.createdAt) {
      events.push({ id: `local-op-${operation.id}`, kind: "operation", at: operation.createdAt, from: null, to: null, operation });
    }
  }

  for (const event of bindingEvents) {
    const at = iso(event.createdAt);
    if (!at) continue;
    const kind = event.kind === "switched" || event.kind === "unbound" ? event.kind : "bound";
    events.push({
      id: `local-binding-${event.id}`,
      kind,
      at,
      from: eventSide(event, "from") ?? (kind === "bound" ? null : CLOUD_DERIVED),
      to: eventSide(event, "to") ?? (kind === "unbound" ? CLOUD_DERIVED : null),
      ...(event.id.startsWith("backfill-") ? { backfilled: true } : {})
    });
  }
  events.sort((left, right) => timeOf(left.at) - timeOf(right.at));

  const messages = transcript.map((message, index) => {
    const raw = rawMessages[index];
    if (message.role === "user") {
      const location =
        recordedLocation(raw?.runConfig) ??
        (Number.isNaN(timeOf(message.createdAt)) ? null : locationAt(bindingEvents, timeOf(message.createdAt)));
      return location ? { ...message, executionLocation: location } : message;
    }
    if (message.role !== "assistant") return message;
    const logged = operationsByAssistant.get(message.id) ?? [];
    const localOperations = logged.length > 0 ? logged : operationsFromMessageParts(raw?.message);
    return localOperations.length > 0 ? { ...message, localOperations } : message;
  });
  return { messages, events };
}
