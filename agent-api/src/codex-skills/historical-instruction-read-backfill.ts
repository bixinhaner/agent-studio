import path from "node:path";

import type { CodexInstructionRead, CodexInstructionReadKind } from "./instruction-read-observer.js";

export type HistoricalInstructionReadTurn = {
  threadId: string;
  turnId: string;
  startedAt: string;
  sourceFile?: string;
  reads: CodexInstructionRead[];
};

export type HistoricalStoredMessage = {
  id: string;
  externalId?: string | null;
  role: string;
  content: unknown;
  parentId?: string | null;
  runConfig?: unknown;
  position: number;
  createdAt: Date;
};

export type HistoricalInstructionReadPatch = {
  threadId: string;
  messageId: string;
  turnId: string;
  turnStartedAt: string;
  sourceFile?: string;
  reads: CodexInstructionRead[];
  content: Record<string, unknown>;
};

export type HistoricalInstructionReadMatchStats = {
  alreadyMarkedMessages: number;
  ambiguousTurns: number;
  incompleteAssistantMessages: number;
  nonPortalAssistantMessages: number;
  turnsWithoutAssistant: number;
};

type MutableTurn = {
  threadId: string;
  turnId: string;
  startedAt: string;
  sourceFile?: string;
  readsByKey: Map<string, CodexInstructionRead>;
  pendingCalls: Map<string, { paths: string[] }>;
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

function serializedText(value: unknown): string | undefined {
  if (typeof value === "string") return trimOrUndefined(value);
  if (value === undefined || value === null) return undefined;
  try {
    return trimOrUndefined(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function normalizeComparablePath(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\ /g, " ")
    .replace(/\\(['"])/g, "$1")
    .replace(/\\\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

function collectSkillMdPaths(command: string): string[] {
  const paths = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const normalized = normalizeComparablePath(value);
    if (!/(^|\/)SKILL\.md$/i.test(normalized)) return;
    paths.add(normalized);
  };

  for (const pattern of [/"([^"\n]*\/SKILL\.md)"/gi, /'([^'\n]*\/SKILL\.md)'/gi]) {
    for (const match of command.matchAll(pattern)) add(match[1]);
  }
  for (const match of command.matchAll(/((?:\\.|[^\s'"`;|&<>])+\/SKILL\.md)/gi)) add(match[1]);

  if (/(?:^|[\s'"`;|&<>])SKILL\.md(?:$|[\s'"`;|&<>])/i.test(command)) {
    const workdir = command.match(/\bworkdir\s*:\s*["']([^"']+)["']/i)?.[1]
      ?? command.match(/["']workdir["']\s*:\s*["']([^"']+)["']/i)?.[1];
    if (workdir) add(`${normalizeComparablePath(workdir)}/SKILL.md`);
  }

  return [...paths];
}

function skillNameFromPath(skillMdPath: string): string | undefined {
  const normalized = normalizeComparablePath(skillMdPath);
  const parent = path.posix.basename(path.posix.dirname(normalized)).trim();
  if (!parent || parent === "." || parent.includes("$")) return undefined;
  return parent;
}

function instructionKindFromPath(skillMdPath: string): CodexInstructionReadKind {
  const normalized = `/${normalizeComparablePath(skillMdPath).toLowerCase().replace(/^\/+/, "")}`;
  return normalized.includes("/plugins/") || normalized.includes("/.codex-plugin/")
    ? "capability"
    : "skill";
}

function stableReadId(kind: CodexInstructionReadKind, name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `instruction-read-${kind}-${normalized || "unknown"}`;
}

function threadIdFromWorkspace(cwd: unknown): string | undefined {
  const normalized = trimOrUndefined(cwd)?.split(path.sep).join("/");
  if (!normalized) return undefined;
  return normalized.match(/\/thread-([^/]+)(?:\/|$)/)?.[1];
}

function messageText(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((item) => trimOrUndefined(asRecord(item)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function selectedSkillPaths(text: string): string[] {
  const paths: string[] = [];
  for (const blockMatch of text.matchAll(/<skill>([\s\S]*?)<\/skill>/gi)) {
    const block = blockMatch[1] ?? "";
    const skillPath = block.match(/<path>\s*([^<]+?)\s*<\/path>/i)?.[1];
    if (skillPath && /(?:^|\/)SKILL\.md$/i.test(skillPath.trim())) {
      paths.push(normalizeComparablePath(skillPath));
    }
  }
  return paths;
}

function callId(payload: Record<string, unknown>): string | undefined {
  return trimOrUndefined(payload.call_id) ?? trimOrUndefined(payload.id);
}

function toolCallInput(payload: Record<string, unknown>): string | undefined {
  return serializedText(payload.input ?? payload.arguments);
}

function outputIsSuccessful(payload: Record<string, unknown>): boolean {
  if (payload.success === false || payload.is_error === true || payload.error) return false;
  const status = trimOrUndefined(payload.status)?.toLowerCase();
  if (status === "failed" || status === "error") return false;
  const output = serializedText(payload.output ?? payload.result ?? payload.content);
  if (!output) return false;
  if (/\b(?:script|command|tool call) failed\b/i.test(output)) return false;
  if (/\b(?:exit code|exit_code)\s*[=:]?\s*[1-9]\d*\b/i.test(output)) return false;
  return true;
}

function addRead(turn: MutableTurn, skillPath: string, trigger: CodexInstructionRead["trigger"], readAt: string): void {
  const name = skillNameFromPath(skillPath);
  if (!name) return;
  const kind = instructionKindFromPath(skillPath);
  const key = `${kind}:${name.toLowerCase()}`;
  const existing = turn.readsByKey.get(key);
  if (existing?.trigger === "selected") return;
  turn.readsByKey.set(key, {
    id: stableReadId(kind, name),
    name,
    kind,
    trigger,
    readAt
  });
}

export class HistoricalInstructionReadRolloutCollector {
  private current?: MutableTurn;
  private readonly completed: HistoricalInstructionReadTurn[] = [];
  private invalidLines = 0;

  constructor(private readonly sourceFile?: string) {}

  pushLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const mayStartTurn = trimmed.includes('"type":"turn_context"') || trimmed.includes('"type": "turn_context"');
    const mayContainRead = trimmed.includes("SKILL.md") || trimmed.includes("<skill>");
    const mayCompletePendingCall = Boolean(
      this.current?.pendingCalls.size &&
      (trimmed.includes("custom_tool_call_output") || trimmed.includes("function_call_output"))
    );
    if (!mayStartTurn && !mayContainRead && !mayCompletePendingCall) return;
    let row: Record<string, unknown> | undefined;
    try {
      row = asRecord(JSON.parse(trimmed));
    } catch {
      this.invalidLines += 1;
      return;
    }
    if (!row) return;
    const timestamp = trimOrUndefined(row.timestamp);
    const type = trimOrUndefined(row.type);
    const payload = asRecord(row.payload);
    if (!timestamp || !type || !payload) return;

    if (type === "turn_context") {
      this.finishCurrent();
      const threadId = threadIdFromWorkspace(payload.cwd);
      const turnId = trimOrUndefined(payload.turn_id);
      if (!threadId || !turnId) {
        this.current = undefined;
        return;
      }
      this.current = {
        threadId,
        turnId,
        startedAt: timestamp,
        sourceFile: this.sourceFile,
        readsByKey: new Map(),
        pendingCalls: new Map()
      };
      return;
    }

    const turn = this.current;
    if (!turn || type !== "response_item") return;
    const payloadType = trimOrUndefined(payload.type);
    if (payloadType === "message" && trimOrUndefined(payload.role) === "user") {
      for (const skillPath of selectedSkillPaths(messageText(payload))) {
        addRead(turn, skillPath, "selected", timestamp);
      }
      return;
    }

    if (payloadType === "custom_tool_call" || payloadType === "function_call") {
      const id = callId(payload);
      const input = toolCallInput(payload);
      if (!id || !input) return;
      const paths = collectSkillMdPaths(input);
      if (paths.length > 0) turn.pendingCalls.set(id, { paths });
      return;
    }

    if (payloadType === "custom_tool_call_output" || payloadType === "function_call_output") {
      const id = callId(payload);
      if (!id) return;
      const pending = turn.pendingCalls.get(id);
      turn.pendingCalls.delete(id);
      if (!pending || !outputIsSuccessful(payload)) return;
      for (const skillPath of pending.paths) addRead(turn, skillPath, "automatic", timestamp);
    }
  }

  finish(): { turns: HistoricalInstructionReadTurn[]; invalidLines: number } {
    this.finishCurrent();
    return { turns: [...this.completed], invalidLines: this.invalidLines };
  }

  private finishCurrent(): void {
    if (!this.current) return;
    if (this.current.readsByKey.size > 0) {
      this.completed.push({
        threadId: this.current.threadId,
        turnId: this.current.turnId,
        startedAt: this.current.startedAt,
        ...(this.current.sourceFile ? { sourceFile: this.current.sourceFile } : {}),
        reads: [...this.current.readsByKey.values()]
      });
    }
    this.current = undefined;
  }
}

export function parseHistoricalInstructionReadRollout(
  input: string,
  sourceFile?: string
): { turns: HistoricalInstructionReadTurn[]; invalidLines: number } {
  const collector = new HistoricalInstructionReadRolloutCollector(sourceFile);
  for (const line of input.split(/\r?\n/)) collector.pushLine(line);
  return collector.finish();
}

export function hasInstructionReadContentPart(content: unknown): boolean {
  const root = asRecord(content);
  const parts = Array.isArray(root?.content) ? root.content : [];
  return parts.some((item) => {
    const part = asRecord(item);
    return trimOrUndefined(part?.type) === "data" && trimOrUndefined(part?.name) === "codex_instruction_reads";
  });
}

function completedAssistant(content: unknown): boolean {
  const status = asRecord(asRecord(content)?.status);
  const type = trimOrUndefined(status?.type)?.toLowerCase();
  return !type || type === "complete" || type === "completed";
}

function runConfigChannel(value: unknown): string | undefined {
  return trimOrUndefined(asRecord(value)?.channel);
}

function withInstructionReads(content: unknown, reads: CodexInstructionRead[]): Record<string, unknown> | undefined {
  const root = asRecord(content);
  if (!root || hasInstructionReadContentPart(root)) return undefined;
  const parts = Array.isArray(root.content) ? root.content : [];
  return {
    ...root,
    content: [
      {
        type: "data",
        name: "codex_instruction_reads",
        data: { reads }
      },
      ...parts
    ]
  };
}

export function buildHistoricalInstructionReadPatches(input: {
  threadId: string;
  turns: HistoricalInstructionReadTurn[];
  messages: HistoricalStoredMessage[];
}): { patches: HistoricalInstructionReadPatch[]; stats: HistoricalInstructionReadMatchStats } {
  const stats: HistoricalInstructionReadMatchStats = {
    alreadyMarkedMessages: 0,
    ambiguousTurns: 0,
    incompleteAssistantMessages: 0,
    nonPortalAssistantMessages: 0,
    turnsWithoutAssistant: 0
  };
  const messages = [...input.messages].sort((left, right) => left.position - right.position);
  const messageByExternalId = new Map(
    messages
      .filter((message) => trimOrUndefined(message.externalId))
      .map((message) => [trimOrUndefined(message.externalId)!, message])
  );
  const turns = [...input.turns]
    .filter((turn) => turn.threadId === input.threadId && turn.reads.length > 0)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const usedMessages = new Set<string>();
  const patches: HistoricalInstructionReadPatch[] = [];

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    const startedAt = Date.parse(turn.startedAt);
    const nextStartedAt = index + 1 < turns.length ? Date.parse(turns[index + 1]!.startedAt) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(startedAt)) continue;

    const candidates = messages.filter((message) => {
      if (message.role !== "assistant" || usedMessages.has(message.id)) return false;
      const createdAt = message.createdAt.getTime();
      return createdAt >= startedAt - 2_000 && createdAt < nextStartedAt;
    });
    const eligible: HistoricalStoredMessage[] = [];
    for (const message of candidates) {
      if (hasInstructionReadContentPart(message.content)) {
        stats.alreadyMarkedMessages += 1;
        continue;
      }
      if (!completedAssistant(message.content)) {
        stats.incompleteAssistantMessages += 1;
        continue;
      }
      const parent = trimOrUndefined(message.parentId)
        ? messageByExternalId.get(trimOrUndefined(message.parentId)!)
        : [...messages]
            .reverse()
            .find((item) => item.role === "user" && item.position < message.position);
      if (!parent || runConfigChannel(parent.runConfig) !== "portal") {
        stats.nonPortalAssistantMessages += 1;
        continue;
      }
      const parentDelta = startedAt - parent.createdAt.getTime();
      if (parentDelta < -30_000 || parentDelta > 10 * 60_000) continue;
      eligible.push(message);
    }

    if (eligible.length === 0) {
      stats.turnsWithoutAssistant += 1;
      continue;
    }
    if (eligible.length > 1) {
      stats.ambiguousTurns += 1;
      continue;
    }
    const message = eligible[0]!;
    const content = withInstructionReads(message.content, turn.reads);
    if (!content) continue;
    usedMessages.add(message.id);
    patches.push({
      threadId: input.threadId,
      messageId: message.id,
      turnId: turn.turnId,
      turnStartedAt: turn.startedAt,
      ...(turn.sourceFile ? { sourceFile: turn.sourceFile } : {}),
      reads: turn.reads,
      content
    });
  }

  return { patches, stats };
}
