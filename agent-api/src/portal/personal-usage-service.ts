import type { PrismaClient } from "@prisma/client";

import type { ListUsageEventsByExactRangeInput, UsageEventRecord } from "../persistence/usage-event-repository.js";
import { isValidTimezone } from "../scheduled-tasks/schedule.js";

/**
 * Read-only "my usage" summary for the portal account menu. It only reads
 * `usage_events` already written through UsageRecorder; it never records or
 * recalculates cost, so it does not count as a usage entry point.
 */

export const PERSONAL_USAGE_PERIODS = ["7d", "30d", "month", "last_month"] as const;
export type PersonalUsagePeriod = (typeof PERSONAL_USAGE_PERIODS)[number];
export type PersonalUsageChannel = "portal" | "dingtalk" | "scheduled" | "api" | "other";

const MAX_EVENTS = 50_000;
const MAX_OUTPUT_FILES = 5_000;

type Db = Pick<PrismaClient, "workspaceNode" | "scheduledTaskRun">;
/** Usage reads go through the shared ledger (see usage-architecture.test.ts). */
type UsageLedger = { listEventsByExactCreatedAtRange(input: ListUsageEventsByExactRangeInput): Promise<UsageEventRecord[]> };

type TokenTotals = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  turns: number;
  failed_turns: number;
};

export type PersonalUsageSummary = {
  period: PersonalUsagePeriod;
  timezone: string;
  range: { from: string; to: string; days: number };
  totals: TokenTotals & { tasks: number; output_files: number };
  previous: { total_tokens: number; turns: number } | null;
  daily: Array<{ date: string; input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number; turns: number }>;
  by_channel: Array<{ key: PersonalUsageChannel; total_tokens: number; turns: number }>;
  by_model: Array<{ model: string; total_tokens: number; turns: number }>;
  outputs_by_type: Array<{ type: OutputFileType; count: number }>;
  truncated: boolean;
};

export type OutputFileType = "document" | "spreadsheet" | "presentation" | "image" | "other";

/** Mirrors the portal outputs gallery so counts match what users see there. */
export function outputFileType(name: string, mimeType?: string | null): OutputFileType {
  const lower = name.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(lower)) return "image";
  if (/\.(xlsx?|xlsm|csv|tsv|ods)$/.test(lower)) return "spreadsheet";
  if (/\.(pptx?|odp|key)$/.test(lower)) return "presentation";
  if (/\.(pdf|docx?|odt|rtf|md|markdown|txt|html?)$/.test(lower) || mime === "application/pdf") return "document";
  return "other";
}

export function usageChannel(featureType: string, metadata: unknown, scheduledThread = false): PersonalUsageChannel {
  if (scheduledThread) return "scheduled";
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const source = typeof meta.source === "string" ? meta.source.toLowerCase() : "";
  if (meta.scheduledTaskId || meta.scheduled_task_id || source.includes("scheduled")) return "scheduled";
  if (source.includes("dingtalk")) return "dingtalk";
  if (featureType === "external_openai_api" || source.includes("openai")) return "api";
  if (featureType === "chat" && (source === "" || source === "chat_stream" || source.startsWith("portal"))) return "portal";
  return "other";
}

// ---------- time zone helpers ----------

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function zonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** UTC instant of local midnight for the given local calendar date. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let result = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(result), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    result += guess - asUtc;
  }
  return new Date(result);
}

function addLocalDays(year: number, month: number, day: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function periodRange(period: PersonalUsagePeriod, now: Date, timeZone: string) {
  const today = zonedParts(now, timeZone);
  const tomorrow = addLocalDays(today.year, today.month, today.day, 1);
  let start: { year: number; month: number; day: number };
  let end = tomorrow;
  if (period === "7d" || period === "30d") {
    start = addLocalDays(today.year, today.month, today.day, -(period === "7d" ? 6 : 29));
  } else if (period === "month") {
    start = { year: today.year, month: today.month, day: 1 };
  } else {
    const prevMonth = today.month === 1 ? { year: today.year - 1, month: 12 } : { year: today.year, month: today.month - 1 };
    start = { ...prevMonth, day: 1 };
    end = { year: today.year, month: today.month, day: 1 };
  }
  const from = zonedMidnight(start.year, start.month, start.day, timeZone);
  const to = period === "last_month" ? zonedMidnight(end.year, end.month, end.day, timeZone) : now;
  const days: string[] = [];
  for (let cursor = start; ; cursor = addLocalDays(cursor.year, cursor.month, cursor.day, 1)) {
    if (cursor.year === end.year && cursor.month === end.month && cursor.day === end.day) break;
    days.push(`${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(cursor.day).padStart(2, "0")}`);
    if (days.length > 62) break;
  }
  return { from, to, days };
}

function previousRange(period: PersonalUsagePeriod, range: { from: Date; to: Date }, now: Date, timeZone: string) {
  if (period === "month") {
    // Same elapsed span of last month, so "this month so far" compares fairly.
    const last = periodRange("last_month", now, timeZone);
    const elapsed = range.to.getTime() - range.from.getTime();
    return { from: last.from, to: new Date(Math.min(last.to.getTime(), last.from.getTime() + elapsed)) };
  }
  if (period === "last_month") {
    const p = zonedParts(range.from, timeZone);
    const prev = p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
    return { from: zonedMidnight(prev.year, prev.month, 1, timeZone), to: range.from };
  }
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: range.from };
}

function emptyTotals(): TokenTotals {
  return { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, turns: 0, failed_turns: 0 };
}

function isFailure(status: string) {
  const lower = status.toLowerCase();
  return lower !== "success" && lower !== "completed" && lower !== "ok";
}

export function createPersonalUsageService(deps: { db: Db; ledger: UsageLedger; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  return {
    async summarize(input: { userId: string; period?: string; timezone?: string }): Promise<PersonalUsageSummary> {
      // An empty id would drop the ledger's user filter and leak everyone's usage.
      if (!input.userId?.trim()) throw new Error("A signed-in user is required");
      const period = (PERSONAL_USAGE_PERIODS as readonly string[]).includes(input.period ?? "")
        ? (input.period as PersonalUsagePeriod)
        : "month";
      const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "Asia/Shanghai";
      const current = now();
      const range = periodRange(period, current, timezone);
      const prev = previousRange(period, range, current, timezone);

      const [events, previousEvents, outputs, scheduledRuns] = await Promise.all([
        deps.ledger.listEventsByExactCreatedAtRange({ userId: input.userId, from: range.from, to: range.to, take: MAX_EVENTS }),
        deps.ledger.listEventsByExactCreatedAtRange({ userId: input.userId, from: prev.from, to: prev.to, take: MAX_EVENTS }),
        deps.db.workspaceNode.findMany({
          where: {
            kind: "file",
            createdByType: "agent",
            state: { in: ["active", "trashed"] },
            workspace: { ownerUserId: input.userId },
            createdAt: { gte: range.from, lt: range.to }
          },
          select: { name: true, mimeType: true },
          take: MAX_OUTPUT_FILES
        }),
        // Scheduled runs go through the normal chat stream; their threads tell them apart.
        deps.db.scheduledTaskRun.findMany({
          where: { userId: input.userId, threadId: { not: null }, startedAt: { gte: new Date(range.from.getTime() - 86_400_000), lt: range.to } },
          select: { threadId: true },
          take: MAX_EVENTS
        })
      ]);
      const scheduledThreads = new Set(scheduledRuns.map((run) => run.threadId).filter((id): id is string => Boolean(id)));

      const totals = emptyTotals();
      const threads = new Set<string>();
      const daily = new Map(range.days.map((date) => [date, { date, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0, turns: 0 }]));
      const channels = new Map<PersonalUsageChannel, { key: PersonalUsageChannel; total_tokens: number; turns: number }>();
      const models = new Map<string, { model: string; total_tokens: number; turns: number }>();

      for (const event of events) {
        // input_tokens already includes cached input; total = input + output.
        const total = event.inputTokens + event.outputTokens;
        totals.input_tokens += event.inputTokens;
        totals.cached_input_tokens += event.cachedInputTokens;
        totals.output_tokens += event.outputTokens;
        totals.total_tokens += total;
        totals.turns += 1;
        if (isFailure(event.resultStatus)) totals.failed_turns += 1;
        if (event.threadId) threads.add(event.threadId);

        const day = daily.get(zonedDateKey(new Date(event.createdAt), timezone));
        if (day) {
          day.input_tokens += event.inputTokens;
          day.cached_input_tokens += event.cachedInputTokens;
          day.output_tokens += event.outputTokens;
          day.total_tokens += total;
          day.turns += 1;
        }
        const channelKey = usageChannel(event.featureType, event.metadata, Boolean(event.threadId && scheduledThreads.has(event.threadId)));
        const channel = channels.get(channelKey) ?? { key: channelKey, total_tokens: 0, turns: 0 };
        channel.total_tokens += total;
        channel.turns += 1;
        channels.set(channelKey, channel);
        const modelKey = event.model || "unknown";
        const model = models.get(modelKey) ?? { model: modelKey, total_tokens: 0, turns: 0 };
        model.total_tokens += total;
        model.turns += 1;
        models.set(modelKey, model);
      }

      const outputCounts = new Map<OutputFileType, number>();
      for (const node of outputs) {
        const type = outputFileType(node.name, node.mimeType);
        outputCounts.set(type, (outputCounts.get(type) ?? 0) + 1);
      }

      const byTokens = <T extends { total_tokens: number; turns: number }>(a: T, b: T) => b.total_tokens - a.total_tokens || b.turns - a.turns;
      return {
        period,
        timezone,
        range: { from: range.from.toISOString(), to: range.to.toISOString(), days: range.days.length },
        totals: { ...totals, tasks: threads.size, output_files: outputs.length },
        previous: {
          total_tokens: previousEvents.reduce((sum, event) => sum + event.inputTokens + event.outputTokens, 0),
          turns: previousEvents.length
        },
        daily: [...daily.values()],
        by_channel: [...channels.values()].sort(byTokens),
        by_model: [...models.values()].sort(byTokens).slice(0, 6),
        outputs_by_type: [...outputCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        truncated: events.length >= MAX_EVENTS
      };
    }
  };
}
