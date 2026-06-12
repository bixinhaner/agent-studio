import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractRuntimeUsageFromStreamEvent, type RuntimeUsageSnapshot } from "../live-runtime-session.js";

type ServiceTier = "standard" | "batch" | "flex" | "priority";

type CliOptions = {
  days: number;
  since?: Date;
  until: Date;
  sessionsRoot: string;
  outputDir?: string;
  writeFiles: boolean;
  top: number;
  timezone: string;
  tier: ServiceTier;
};

type Price = {
  input: number;
  cachedInput?: number;
  output: number;
};

type PriceProfile = Price & {
  longContextThreshold?: number;
  longContext?: Price;
};

type PricingByTier = Record<ServiceTier, Record<string, PriceProfile>>;

type SessionSummary = {
  sessionId: string;
  filePath: string;
  fileCount: number;
  startedAt: string;
  lastEventAt: string;
  cwd: string;
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  estimatedCost: number;
  unknownPriceRequests: number;
};

type RequestRecord = {
  id: string;
  sessionId: string;
  timestamp: string;
  localDate: string;
  cwd: string;
  model: string;
  priceModel?: string;
  priceTier: ServiceTier;
  longContext: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  estimatedCost?: number;
  filePath: string;
};

type AggregateRow = {
  key: string;
  sessions: Set<string>;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  estimatedCost: number;
  unknownPriceRequests: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LONG_CONTEXT_THRESHOLD = 272_000;
const DEFAULT_DAYS = 7;
const DEFAULT_TOP = 10;
const PRICING_SOURCE_URL = "https://developers.openai.com/api/docs/pricing";
const MODEL_NOTES_SOURCE_URLS = [
  "https://developers.openai.com/api/docs/models/gpt-5.5",
  "https://developers.openai.com/api/docs/models/gpt-5.4"
];

const PRICING: PricingByTier = {
  standard: {
    "gpt-5.5": withLongContext({ input: 5, cachedInput: 0.5, output: 30 }),
    "gpt-5.5-pro": withLongContext({ input: 30, output: 180 }),
    "gpt-5.4": withLongContext({ input: 2.5, cachedInput: 0.25, output: 15 }),
    "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
    "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
    "gpt-5.4-pro": withLongContext({ input: 30, output: 180 }),
    "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
    "gpt-5.2-pro": { input: 21, output: 168 },
    "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
    "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
    "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
    "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
    "gpt-5-pro": { input: 15, output: 120 },
    "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
    "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
    "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
    "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
    o3: { input: 2, cachedInput: 0.5, output: 8 },
    "o4-mini": { input: 1.1, cachedInput: 0.275, output: 4.4 },
    "o3-mini": { input: 1.1, cachedInput: 0.55, output: 4.4 }
  },
  batch: {
    "gpt-5.5": withLongContext({ input: 2.5, cachedInput: 0.25, output: 15 }),
    "gpt-5.5-pro": withLongContext({ input: 15, output: 90 }),
    "gpt-5.4": withLongContext({ input: 1.25, cachedInput: 0.13, output: 7.5 }),
    "gpt-5.4-mini": { input: 0.375, cachedInput: 0.0375, output: 2.25 },
    "gpt-5.4-nano": { input: 0.1, cachedInput: 0.01, output: 0.625 },
    "gpt-5.4-pro": withLongContext({ input: 15, output: 90 }),
    "gpt-5.2": { input: 0.875, cachedInput: 0.0875, output: 7 },
    "gpt-5.1": { input: 0.625, cachedInput: 0.0625, output: 5 },
    "gpt-5": { input: 0.625, cachedInput: 0.0625, output: 5 },
    "gpt-5-mini": { input: 0.125, cachedInput: 0.0125, output: 1 },
    "gpt-5-nano": { input: 0.025, cachedInput: 0.0025, output: 0.2 },
    "gpt-5-pro": { input: 7.5, output: 60 },
    "gpt-4.1": { input: 1, output: 4 },
    "gpt-4.1-mini": { input: 0.2, output: 0.8 },
    "gpt-4.1-nano": { input: 0.05, output: 0.2 },
    "gpt-4o": { input: 1.25, output: 5 },
    "gpt-4o-mini": { input: 0.075, output: 0.3 },
    o3: { input: 1, output: 4 },
    "o4-mini": { input: 0.55, output: 2.2 }
  },
  flex: {
    "gpt-5.5": withLongContext({ input: 2.5, cachedInput: 0.25, output: 15 }),
    "gpt-5.5-pro": withLongContext({ input: 15, output: 90 }),
    "gpt-5.4": withLongContext({ input: 1.25, cachedInput: 0.13, output: 7.5 }),
    "gpt-5.4-mini": { input: 0.375, cachedInput: 0.0375, output: 2.25 },
    "gpt-5.4-nano": { input: 0.1, cachedInput: 0.01, output: 0.625 },
    "gpt-5.4-pro": withLongContext({ input: 15, output: 90 }),
    "gpt-5.2": { input: 0.875, cachedInput: 0.0875, output: 7 },
    "gpt-5.1": { input: 0.625, cachedInput: 0.0625, output: 5 },
    "gpt-5": { input: 0.625, cachedInput: 0.0625, output: 5 },
    "gpt-5-mini": { input: 0.125, cachedInput: 0.0125, output: 1 },
    "gpt-5-nano": { input: 0.025, cachedInput: 0.0025, output: 0.2 },
    o3: { input: 1, cachedInput: 0.25, output: 4 },
    "o4-mini": { input: 0.55, cachedInput: 0.138, output: 2.2 }
  },
  priority: {
    "gpt-5.5": { input: 12.5, cachedInput: 1.25, output: 75 },
    "gpt-5.4": { input: 5, cachedInput: 0.5, output: 30 },
    "gpt-5.4-mini": { input: 1.5, cachedInput: 0.15, output: 9 },
    "gpt-5.2": { input: 3.5, cachedInput: 0.35, output: 28 },
    "gpt-5.1": { input: 2.5, cachedInput: 0.25, output: 20 },
    "gpt-5": { input: 2.5, cachedInput: 0.25, output: 20 },
    "gpt-5-mini": { input: 0.45, cachedInput: 0.045, output: 3.6 },
    "gpt-4.1": { input: 3.5, cachedInput: 0.875, output: 14 },
    "gpt-4.1-mini": { input: 0.7, cachedInput: 0.175, output: 2.8 },
    "gpt-4.1-nano": { input: 0.2, cachedInput: 0.05, output: 0.8 },
    "gpt-4o": { input: 4.25, cachedInput: 2.125, output: 17 },
    "gpt-4o-mini": { input: 0.25, cachedInput: 0.125, output: 1 },
    o3: { input: 3.5, cachedInput: 0.875, output: 14 },
    "o4-mini": { input: 2, cachedInput: 0.5, output: 8 }
  }
};

function withLongContext(price: Price): PriceProfile {
  return {
    ...price,
    longContextThreshold: LONG_CONTEXT_THRESHOLD,
    longContext: {
      input: price.input * 2,
      cachedInput: price.cachedInput === undefined ? undefined : price.cachedInput * 2,
      output: price.output * 1.5
    }
  };
}

function usage(): never {
  console.error([
    "Usage: npm run report:local-codex-usage -- [options]",
    "",
    "Options:",
    "  --days <n>              Rolling window in days. Default: 7",
    "  --since <iso>           Start timestamp, overrides --days",
    "  --until <iso>           End timestamp. Default: now",
    "  --sessions-root <path>  Codex sessions root. Default: ~/.codex/sessions",
    "  --out-dir <path>        Directory for JSON/CSV files. Default: <project>/temp/local-codex-usage-<timestamp>",
    "  --no-files              Print only; do not write JSON/CSV outputs",
    "  --top <n>               Number of top sessions/requests to print. Default: 10",
    "  --timezone <tz>         IANA timezone for daily buckets. Default: system timezone",
    "  --tier <name>           Pricing tier: standard, batch, flex, priority. Default: standard",
    "  --help                  Show this help",
    "",
    "The script reads only session metadata and token_count usage records; it does not print prompt or response content."
  ].join("\n"));
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const untilDefault = new Date();
  const out: CliOptions = {
    days: DEFAULT_DAYS,
    until: untilDefault,
    sessionsRoot: path.join(os.homedir(), ".codex", "sessions"),
    writeFiles: true,
    top: DEFAULT_TOP,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    tier: "standard"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--no-files") {
      out.writeFiles = false;
      continue;
    }
    if (arg === "--days") {
      const raw = argv[++index];
      const days = Number(raw);
      if (!Number.isFinite(days) || days <= 0) usage();
      out.days = days;
      continue;
    }
    if (arg === "--since") {
      out.since = parseDateArg(argv[++index], "--since");
      continue;
    }
    if (arg === "--until") {
      out.until = parseDateArg(argv[++index], "--until");
      continue;
    }
    if (arg === "--sessions-root") {
      out.sessionsRoot = resolveHomePath(requireValue(argv[++index], "--sessions-root"));
      continue;
    }
    if (arg === "--out-dir") {
      out.outputDir = path.resolve(requireValue(argv[++index], "--out-dir"));
      continue;
    }
    if (arg === "--top") {
      const top = Number(requireValue(argv[++index], "--top"));
      if (!Number.isInteger(top) || top <= 0) usage();
      out.top = top;
      continue;
    }
    if (arg === "--timezone") {
      out.timezone = requireValue(argv[++index], "--timezone");
      continue;
    }
    if (arg === "--tier") {
      const tier = requireValue(argv[++index], "--tier") as ServiceTier;
      if (!["standard", "batch", "flex", "priority"].includes(tier)) usage();
      out.tier = tier;
      continue;
    }
    usage();
  }

  if (!out.since) {
    out.since = new Date(out.until.getTime() - out.days * MS_PER_DAY);
  }
  if (out.since.getTime() >= out.until.getTime()) {
    throw new Error("--since must be earlier than --until");
  }
  return out;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    console.error(`${flag} requires a value`);
    usage();
  }
  return value;
}

function parseDateArg(value: string | undefined, flag: string): Date {
  const raw = requireValue(value, flag);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} is not a valid date: ${raw}`);
  }
  return date;
}

function resolveHomePath(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

async function* walkJsonlFiles(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    throw new Error(`Failed to read sessions root ${root}: ${error instanceof Error ? error.message : String(error)}`);
  });
  for (const entry of entries) {
    const itemPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(itemPath);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield itemPath;
    }
  }
}

function sessionIdFromFile(filePath: string): string {
  const baseName = path.basename(filePath, ".jsonl");
  const match = baseName.match(/^rollout-.+?-(019[0-9a-f-]+)$/i);
  return match?.[1] ?? baseName;
}

function localDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function localDateTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function normalizeModel(model: string): string {
  const normalized = model.trim();
  for (const base of [
    "gpt-5.5-pro",
    "gpt-5.5",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.4",
    "gpt-5.2-pro",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-pro",
    "gpt-5"
  ]) {
    if (normalized === base || normalized.startsWith(`${base}-202`)) return base;
  }
  return normalized;
}

function pricingFor(model: string, tier: ServiceTier, inputTokens: number): {
  price?: Price;
  priceModel?: string;
  longContext: boolean;
} {
  const priceModel = normalizeModel(model);
  const profile = PRICING[tier][priceModel];
  if (!profile) return { longContext: false };
  const longContext = Boolean(
    profile.longContext &&
    profile.longContextThreshold &&
    inputTokens > profile.longContextThreshold &&
    tier !== "priority"
  );
  return {
    price: longContext && profile.longContext ? profile.longContext : profile,
    priceModel,
    longContext
  };
}

function estimatedCost(input: {
  model: string;
  tier: ServiceTier;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): { cost?: number; priceModel?: string; longContext: boolean } {
  const { price, priceModel, longContext } = pricingFor(input.model, input.tier, input.inputTokens);
  if (!price) return { longContext: false };
  const cachedInputTokens = Math.min(input.inputTokens, Math.max(0, input.cachedInputTokens));
  const uncachedInputTokens = Math.max(0, input.inputTokens - cachedInputTokens);
  const cachedInputPrice = price.cachedInput ?? price.input;
  const cost =
    (uncachedInputTokens * price.input +
      cachedInputTokens * cachedInputPrice +
      input.outputTokens * price.output) /
    1_000_000;
  return { cost, priceModel, longContext };
}

function reasoningOutputTokensFromPayload(payload: Record<string, unknown>): number {
  const info = asRecord(payload.info);
  const usage = asRecord(info?.last_token_usage) ?? asRecord(info?.total_token_usage);
  return numberValue(usage?.reasoning_output_tokens);
}

async function parseSessionFile(filePath: string, options: CliOptions): Promise<{
  session?: SessionSummary;
  requests: RequestRecord[];
}> {
  const fallbackSessionId = sessionIdFromFile(filePath);
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const requests: RequestRecord[] = [];
  let sessionId = fallbackSessionId;
  let cwd = "";
  let model = "";
  let startedAt = "";
  let lastEventAt = "";

  for (const line of content.split(/\n/)) {
    if (!line.trim()) continue;
    let root: unknown;
    try {
      root = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(root);
    if (!record) continue;

    const timestamp = stringValue(record.timestamp);
    if (timestamp) {
      startedAt ||= timestamp;
      lastEventAt = timestamp;
    }

    const payload = asRecord(record.payload);
    if (!payload) continue;

    if (record.type === "session_meta") {
      sessionId = stringValue(payload.id) ?? sessionId;
      cwd = stringValue(payload.cwd) ?? cwd;
      continue;
    }

    if (record.type === "turn_context") {
      cwd = stringValue(payload.cwd) ?? cwd;
      model = stringValue(payload.model) ?? model;
      continue;
    }

    if (payload.type !== "token_count") continue;
    if (!timestamp) continue;
    const eventAt = new Date(timestamp);
    if (Number.isNaN(eventAt.getTime())) continue;
    if (eventAt < options.since! || eventAt >= options.until) continue;

    const usage = extractRuntimeUsageFromStreamEvent(payload);
    if (!usage) continue;
    const modelForRequest = model || "unknown";
    const cost = estimatedCost({
      model: modelForRequest,
      tier: options.tier,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens
    });
    const request: RequestRecord = {
      id: `${sessionId}:${path.basename(filePath, ".jsonl")}:${requests.length + 1}`,
      sessionId,
      timestamp,
      localDate: localDateKey(eventAt, options.timezone),
      cwd,
      model: modelForRequest,
      priceModel: cost.priceModel,
      priceTier: options.tier,
      longContext: cost.longContext,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: reasoningOutputTokensFromPayload(payload),
      estimatedCost: cost.cost,
      filePath
    };
    requests.push(request);
  }

  if (!requests.length) return { requests };

  const session: SessionSummary = {
    sessionId,
    filePath,
    fileCount: 1,
    startedAt,
    lastEventAt,
    cwd,
    model: model || "unknown",
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCost: 0,
    unknownPriceRequests: 0
  };
  for (const request of requests) {
    addUsage(session, request);
  }
  return { session, requests };
}

function addUsage(
  target: Pick<
    SessionSummary,
    | "requests"
    | "inputTokens"
    | "cachedInputTokens"
    | "outputTokens"
    | "reasoningOutputTokens"
    | "estimatedCost"
    | "unknownPriceRequests"
  >,
  request: RequestRecord
): void {
  target.requests += 1;
  target.inputTokens += request.inputTokens;
  target.cachedInputTokens += request.cachedInputTokens;
  target.outputTokens += request.outputTokens;
  target.reasoningOutputTokens += request.reasoningOutputTokens;
  target.estimatedCost += request.estimatedCost ?? 0;
  if (request.estimatedCost === undefined) target.unknownPriceRequests += 1;
}

function addAggregate(map: Map<string, AggregateRow>, key: string, request: RequestRecord): void {
  const current = map.get(key) ?? {
    key,
    sessions: new Set<string>(),
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCost: 0,
    unknownPriceRequests: 0
  };
  current.sessions.add(request.sessionId);
  addUsage(current, request);
  map.set(key, current);
}

function mergeSessionSummary(target: SessionSummary, source: SessionSummary): void {
  target.fileCount += source.fileCount;
  if (source.startedAt && (!target.startedAt || source.startedAt < target.startedAt)) {
    target.startedAt = source.startedAt;
  }
  if (source.lastEventAt && (!target.lastEventAt || source.lastEventAt > target.lastEventAt)) {
    target.lastEventAt = source.lastEventAt;
    target.cwd = source.cwd || target.cwd;
    target.model = source.model || target.model;
  }
  target.requests += source.requests;
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.estimatedCost += source.estimatedCost;
  target.unknownPriceRequests += source.unknownPriceRequests;
}

function aggregateRequests(requests: RequestRecord[], keyOf: (request: RequestRecord) => string): AggregateRow[] {
  const map = new Map<string, AggregateRow>();
  for (const request of requests) {
    addAggregate(map, keyOf(request), request);
  }
  return [...map.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function aggregateToOutput(row: AggregateRow): Record<string, unknown> {
  return {
    key: row.key,
    sessions: row.sessions.size,
    requests: row.requests,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    uncachedInputTokens: Math.max(0, row.inputTokens - row.cachedInputTokens),
    outputTokens: row.outputTokens,
    reasoningOutputTokens: row.reasoningOutputTokens,
    totalTokens: row.inputTokens + row.outputTokens,
    cacheShare: row.inputTokens > 0 ? row.cachedInputTokens / row.inputTokens : 0,
    estimatedCost: row.estimatedCost,
    unknownPriceRequests: row.unknownPriceRequests
  };
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatUsd(value: number | undefined): string {
  if (value === undefined) return "n/a";
  return `$${value.toFixed(4)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printTable(title: string, rows: Array<Record<string, string | number>>, columns: string[]): void {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  (no rows)");
    return;
  }
  const widths = columns.map((column) =>
    Math.max(
      column.length,
      ...rows.map((row) => String(row[column] ?? "").length)
    )
  );
  console.log(columns.map((column, index) => column.padEnd(widths[index])).join("  "));
  console.log(columns.map((_, index) => "-".repeat(widths[index])).join("  "));
  for (const row of rows) {
    console.log(columns.map((column, index) => String(row[column] ?? "").padEnd(widths[index])).join("  "));
  }
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0] ?? {});
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n");
}

function outputPathValue(filePath: string): string {
  return filePath.startsWith(os.homedir()) ? `~${filePath.slice(os.homedir().length)}` : filePath;
}

function findProjectRoot(): string {
  let current = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      fsSync.existsSync(path.join(current, "AGENTS.md")) &&
      fsSync.existsSync(path.join(current, "agent-api"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.resolve(process.cwd(), "..");
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(findProjectRoot(), "temp", `local-codex-usage-${stamp}`);
}

async function writeOutputs(input: {
  options: CliOptions;
  sessions: SessionSummary[];
  requests: RequestRecord[];
  byDay: AggregateRow[];
  byModel: AggregateRow[];
  byCwd: AggregateRow[];
  totals: AggregateRow;
}): Promise<string | undefined> {
  if (!input.options.writeFiles) return undefined;
  const outputDir = input.options.outputDir ?? defaultOutputDir();
  await fs.mkdir(outputDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    range: {
      since: input.options.since!.toISOString(),
      until: input.options.until.toISOString(),
      timezone: input.options.timezone,
      days: input.options.days
    },
    pricing: {
      tier: input.options.tier,
      source: PRICING_SOURCE_URL,
      modelNotes: MODEL_NOTES_SOURCE_URLS,
      note: "Prices are OpenAI API text-token prices per 1M tokens. GPT-5.5/GPT-5.4 long-context requests apply the documented >272K input-token multipliers."
    },
    totals: aggregateToOutput(input.totals),
    byDay: input.byDay.map(aggregateToOutput),
    byModel: input.byModel.map(aggregateToOutput),
    byCwd: input.byCwd.map(aggregateToOutput),
    sessions: input.sessions.map(sessionToOutput),
    requests: input.requests.map(requestToOutput)
  };
  await Promise.all([
    fs.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8"),
    fs.writeFile(path.join(outputDir, "daily.csv"), toCsv(input.byDay.map(aggregateToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "models.csv"), toCsv(input.byModel.map(aggregateToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "workspaces.csv"), toCsv(input.byCwd.map(aggregateToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "sessions.csv"), toCsv(input.sessions.map(sessionToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "requests.csv"), toCsv(input.requests.map(requestToOutput)), "utf8")
  ]);
  return outputDir;
}

function sessionToOutput(session: SessionSummary): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    cwd: session.cwd,
    model: session.model,
    files: session.fileCount,
    requests: session.requests,
    inputTokens: session.inputTokens,
    cachedInputTokens: session.cachedInputTokens,
    uncachedInputTokens: Math.max(0, session.inputTokens - session.cachedInputTokens),
    outputTokens: session.outputTokens,
    reasoningOutputTokens: session.reasoningOutputTokens,
    totalTokens: session.inputTokens + session.outputTokens,
    cacheShare: session.inputTokens > 0 ? session.cachedInputTokens / session.inputTokens : 0,
    estimatedCost: session.estimatedCost,
    unknownPriceRequests: session.unknownPriceRequests,
    filePath: outputPathValue(session.filePath)
  };
}

function requestToOutput(request: RequestRecord): Record<string, unknown> {
  return {
    id: request.id,
    sessionId: request.sessionId,
    timestamp: request.timestamp,
    localDate: request.localDate,
    cwd: request.cwd,
    model: request.model,
    priceModel: request.priceModel ?? "",
    priceTier: request.priceTier,
    longContext: request.longContext,
    inputTokens: request.inputTokens,
    cachedInputTokens: request.cachedInputTokens,
    uncachedInputTokens: Math.max(0, request.inputTokens - request.cachedInputTokens),
    outputTokens: request.outputTokens,
    reasoningOutputTokens: request.reasoningOutputTokens,
    totalTokens: request.inputTokens + request.outputTokens,
    estimatedCost: request.estimatedCost ?? "",
    filePath: outputPathValue(request.filePath)
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sessions: SessionSummary[] = [];
  const sessionsById = new Map<string, SessionSummary>();
  const requests: RequestRecord[] = [];

  for await (const filePath of walkJsonlFiles(options.sessionsRoot)) {
    const parsed = await parseSessionFile(filePath, options);
    if (parsed.session) {
      const existing = sessionsById.get(parsed.session.sessionId);
      if (existing) {
        mergeSessionSummary(existing, parsed.session);
      } else {
        sessionsById.set(parsed.session.sessionId, parsed.session);
      }
    }
    requests.push(...parsed.requests);
  }

  sessions.push(...sessionsById.values());
  sessions.sort((left, right) => right.estimatedCost - left.estimatedCost);
  requests.sort((left, right) => right.inputTokens + right.outputTokens - (left.inputTokens + left.outputTokens));

  const byDay = aggregateRequests(requests, (request) => request.localDate);
  const byModel = aggregateRequests(requests, (request) => request.model).sort((left, right) => right.estimatedCost - left.estimatedCost);
  const byCwd = aggregateRequests(requests, (request) => request.cwd || "(unknown)").sort((left, right) => right.estimatedCost - left.estimatedCost);
  const totals = aggregateRequests(requests, () => "total")[0] ?? {
    key: "total",
    sessions: new Set<string>(),
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCost: 0,
    unknownPriceRequests: 0
  };

  const outputDir = await writeOutputs({ options, sessions, requests, byDay, byModel, byCwd, totals });

  console.log("Local Codex usage report");
  console.log(`Range: ${localDateTime(options.since!, options.timezone)} to ${localDateTime(options.until, options.timezone)} (${options.timezone})`);
  console.log(`Sessions root: ${outputPathValue(options.sessionsRoot)}`);
  console.log(`Pricing: OpenAI API ${options.tier} text-token prices per 1M tokens`);
  console.log(`Pricing source: ${PRICING_SOURCE_URL}`);
  console.log(`Sessions: ${formatInteger(totals.sessions.size)} | Requests: ${formatInteger(totals.requests)}`);
  console.log(
    [
      `Input: ${formatInteger(totals.inputTokens)}`,
      `Cached: ${formatInteger(totals.cachedInputTokens)} (${formatPercent(totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0)})`,
      `Output: ${formatInteger(totals.outputTokens)}`,
      `Reasoning output: ${formatInteger(totals.reasoningOutputTokens)}`,
      `Estimated cost: ${formatUsd(totals.estimatedCost)}`
    ].join(" | ")
  );
  if (totals.unknownPriceRequests > 0) {
    console.log(`Warning: ${formatInteger(totals.unknownPriceRequests)} requests used models without a bundled official price profile.`);
  }

  printTable(
    "Daily",
    byDay.map((row) => ({
      date: row.key,
      sessions: row.sessions.size,
      requests: row.requests,
      input: formatInteger(row.inputTokens),
      cached: formatInteger(row.cachedInputTokens),
      output: formatInteger(row.outputTokens),
      cost: formatUsd(row.estimatedCost)
    })),
    ["date", "sessions", "requests", "input", "cached", "output", "cost"]
  );

  printTable(
    "By model",
    byModel.slice(0, options.top).map((row) => ({
      model: row.key,
      sessions: row.sessions.size,
      requests: row.requests,
      input: formatInteger(row.inputTokens),
      cached: formatInteger(row.cachedInputTokens),
      output: formatInteger(row.outputTokens),
      cost: formatUsd(row.estimatedCost)
    })),
    ["model", "sessions", "requests", "input", "cached", "output", "cost"]
  );

  printTable(
    `Top ${options.top} sessions by estimated cost`,
    sessions.slice(0, options.top).map((session) => ({
      session: session.sessionId,
      files: session.fileCount,
      requests: session.requests,
      input: formatInteger(session.inputTokens),
      cached: formatInteger(session.cachedInputTokens),
      output: formatInteger(session.outputTokens),
      cost: formatUsd(session.estimatedCost),
      cwd: session.cwd
    })),
    ["session", "files", "requests", "input", "cached", "output", "cost", "cwd"]
  );

  printTable(
    `Top ${options.top} workspaces by estimated cost`,
    byCwd.slice(0, options.top).map((row) => ({
      sessions: row.sessions.size,
      requests: row.requests,
      input: formatInteger(row.inputTokens),
      output: formatInteger(row.outputTokens),
      cost: formatUsd(row.estimatedCost),
      cwd: row.key
    })),
    ["sessions", "requests", "input", "output", "cost", "cwd"]
  );

  if (outputDir) {
    console.log(`\nWrote report files: ${outputDir}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
