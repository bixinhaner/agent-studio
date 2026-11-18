/**
 * Admin-only view of "the model service made this answer wait" (Codex retried a rejected
 * request, e.g. model at capacity / 429, honouring the server's delay). The waits are
 * recorded in usage metadata (`upstreamWaits`) by every Codex channel; the portal never
 * shows them. Conversation records attach each recorded turn to the assistant answer it
 * delayed so admins can see when it waited, how often, and for how long.
 */

export type TranscriptUpstreamWaitEntry = {
  at: string;
  attempt: number | null;
  maxAttempts: number | null;
  kind: string;
  message: string;
  waitedMs: number | null;
  resumedAt: string | null;
};

export type TranscriptUpstreamWait = {
  usageEventId: string;
  recordedAt: string;
  resultStatus: string;
  source: string | null;
  count: number;
  totalWaitMs: number;
  kinds: string[];
  entries: TranscriptUpstreamWaitEntry[];
};

export type UpstreamWaitUsageRow = {
  id: string;
  createdAt: Date | string;
  resultStatus: string;
  metadata: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Parses the `upstreamWaits` usage metadata written by `upstreamWaitUsageMetadata`. */
export function readUpstreamWait(row: UpstreamWaitUsageRow): TranscriptUpstreamWait | null {
  const metadata = asRecord(row.metadata);
  const summary = asRecord(metadata?.upstreamWaits);
  if (!summary) return null;
  const entries = (Array.isArray(summary.entries) ? summary.entries : [])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && str(entry.at)))
    .map((entry) => ({
      at: str(entry.at)!,
      attempt: num(entry.attempt),
      maxAttempts: num(entry.maxAttempts),
      kind: str(entry.kind) ?? "unknown",
      message: str(entry.message) ?? "",
      waitedMs: num(entry.waitedMs),
      resumedAt: str(entry.resumedAt)
    }));
  const count = num(summary.count) ?? entries.length;
  if (count <= 0) return null;
  return {
    usageEventId: row.id,
    recordedAt: iso(row.createdAt),
    resultStatus: row.resultStatus,
    source: str(metadata?.source),
    count,
    totalWaitMs: num(summary.totalWaitMs) ?? 0,
    kinds: Array.isArray(summary.kinds) ? summary.kinds.filter((kind): kind is string => typeof kind === "string") : [],
    entries
  };
}

type MessageLike = { role: string; createdAt: string | null };

/**
 * Attaches each wait to the first assistant answer saved at or after the wait began
 * (answers are saved when the turn ends); waits after the last answer go to the last one.
 */
export function attachUpstreamWaits<T extends MessageLike>(
  messages: T[],
  rows: UpstreamWaitUsageRow[]
): Array<T & { upstreamWaits?: TranscriptUpstreamWait[] }> {
  const waits = rows
    .map(readUpstreamWait)
    .filter((wait): wait is TranscriptUpstreamWait => Boolean(wait))
    .sort((a, b) => Date.parse(a.entries[0]?.at ?? a.recordedAt) - Date.parse(b.entries[0]?.at ?? b.recordedAt));
  const result: Array<T & { upstreamWaits?: TranscriptUpstreamWait[] }> = messages.map((message) => ({ ...message }));
  if (waits.length === 0) return result;
  const assistants = result
    .map((message, index) => ({ index, at: message.createdAt ? Date.parse(message.createdAt) : NaN, role: message.role }))
    .filter((item) => item.role === "assistant" && Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at);
  if (assistants.length === 0) return result;
  for (const wait of waits) {
    const startedAt = Date.parse(wait.entries[0]?.at ?? wait.recordedAt);
    const target = assistants.find((item) => item.at >= startedAt) ?? assistants[assistants.length - 1]!;
    const message = result[target.index]!;
    message.upstreamWaits = [...(message.upstreamWaits ?? []), wait];
  }
  return result;
}
