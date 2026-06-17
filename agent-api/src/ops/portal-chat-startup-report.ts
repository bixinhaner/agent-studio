import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type CliOptions = {
  logPaths: string[];
  operation: string;
  threadId?: string;
  sessionId?: string;
  model?: string;
  json: boolean;
};

type TimingStep = {
  name?: string;
  atMs?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

type TimingPayload = {
  event?: string;
  trace_id?: string;
  source?: string;
  operation?: string;
  route?: string;
  status?: string;
  total_ms?: number;
  startup_ms?: number;
  log_reason?: string;
  thread_id?: string;
  session_id?: string;
  organization_type?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  steps?: TimingStep[];
};

type MetricKey =
  | "requestToMetaMs"
  | "metaToPromptMs"
  | "enterpriseContextMs"
  | "runtimeStartToFirstMs"
  | "metaToFirstMs"
  | "codexStreamMs"
  | "postDoneMs"
  | "registerArtifactsMs"
  | "startupMs"
  | "totalMs";

type RecordMetrics = Partial<Record<MetricKey, number>>;

type StartupRecord = {
  traceId: string;
  threadId: string;
  sessionId: string;
  model: string;
  status: string;
  logReason: string;
  cacheState: "hit" | "miss" | "unknown";
  runtimeState: "warm_cache_hit" | "restored_runtime" | "cache_miss_unrestored" | "unknown";
  firstEventType: string;
  metrics: RecordMetrics;
};

type Stats = {
  count: number;
  avg?: number;
  p50?: number;
  p90?: number;
  p95?: number;
  max?: number;
};

type GroupSummary = {
  key: string;
  count: number;
  metrics: Partial<Record<MetricKey, Stats>>;
};

const EVENT_NAME = "agent_studio_runtime_startup_timing";
const DEFAULT_OPERATION = "chat_stream";

const METRIC_LABELS: Record<MetricKey, string> = {
  requestToMetaMs: "request->meta",
  metaToPromptMs: "meta->prompt",
  enterpriseContextMs: "enterprise ctx",
  runtimeStartToFirstMs: "runtime->first",
  metaToFirstMs: "meta->first",
  codexStreamMs: "Codex stream",
  postDoneMs: "post done",
  registerArtifactsMs: "artifact scan",
  startupMs: "startup",
  totalMs: "total"
};

function usage(exitCode = 2): never {
  console.error([
    "Usage: npm run report:portal-chat-startup -- [options]",
    "",
    "Options:",
    "  --log <path>         Log file path. Can be repeated or comma-separated.",
    "  --thread <id>        Only include one Portal thread.",
    "  --session <id>       Only include one runtime session.",
    "  --model <name>       Only include one model.",
    "  --operation <name>   Operation to include. Default: chat_stream. Use all for every operation.",
    "  --json               Print machine-readable JSON.",
    "  --help               Show this help.",
    "",
    "When --log is omitted, the script tries the production PM2 stdout/stderr logs and the current user's PM2 logs."
  ].join("\n"));
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    logPaths: [],
    operation: DEFAULT_OPERATION,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      console.error(`Missing value for ${arg}`);
      usage();
    }
    index += 1;
    if (arg === "--log") {
      options.logPaths.push(...next.split(",").map((item) => item.trim()).filter(Boolean));
      continue;
    }
    if (arg === "--thread") {
      options.threadId = next.trim();
      continue;
    }
    if (arg === "--session") {
      options.sessionId = next.trim();
      continue;
    }
    if (arg === "--model") {
      options.model = next.trim();
      continue;
    }
    if (arg === "--operation") {
      options.operation = next.trim() || DEFAULT_OPERATION;
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    usage();
  }

  options.logPaths = normalizeLogPaths(options.logPaths);
  return options;
}

function normalizeLogPaths(input: string[]): string[] {
  const direct = input.map((item) => path.resolve(item)).filter(Boolean);
  const candidates = direct.length > 0
    ? direct
    : [
        process.env.PORTAL_CHAT_STARTUP_LOG,
        "/home/agentstudio/.pm2/logs/agent-studio-api-out.log",
        "/home/agentstudio/.pm2/logs/agent-studio-api-out-0.log",
        "/home/agentstudio/.pm2/logs/agent-studio-api-error.log",
        "/home/agentstudio/.pm2/logs/agent-studio-api-error-0.log",
        path.join(os.homedir(), ".pm2/logs/agent-studio-api-out.log"),
        path.join(os.homedir(), ".pm2/logs/agent-studio-api-out-0.log"),
        path.join(os.homedir(), ".pm2/logs/agent-studio-api-error.log"),
        path.join(os.homedir(), ".pm2/logs/agent-studio-api-error-0.log")
      ].filter((item): item is string => Boolean(item));

  return Array.from(new Set(candidates.map((item) => path.resolve(item)))).filter((item) => {
    try {
      return fsSync.statSync(item).isFile();
    } catch {
      return false;
    }
  });
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function roundMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return Math.round(value * 10) / 10;
}

function parseTimingLine(line: string): TimingPayload | undefined {
  if (!line.includes(EVENT_NAME)) return undefined;
  const eventStart = line.indexOf(`{"event":"${EVENT_NAME}"`);
  const jsonStart = eventStart >= 0 ? eventStart : line.indexOf("{");
  if (jsonStart < 0) return undefined;
  const candidate = line.slice(jsonStart).trim();
  const jsonEnd = candidate.lastIndexOf("}");
  if (jsonEnd < 0) return undefined;
  try {
    const parsed = JSON.parse(candidate.slice(0, jsonEnd + 1)) as TimingPayload;
    return parsed.event === EVENT_NAME ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readPayloads(options: CliOptions): Promise<TimingPayload[]> {
  const payloads: TimingPayload[] = [];
  for (const filePath of options.logPaths) {
    const text = await fs.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const payload = parseTimingLine(line);
      if (!payload) continue;
      if (options.operation !== "all" && payload.operation !== options.operation) continue;
      if (options.threadId && payload.thread_id !== options.threadId) continue;
      if (options.sessionId && payload.session_id !== options.sessionId) continue;
      if (options.model && payload.model !== options.model) continue;
      payloads.push(payload);
    }
  }
  return payloads;
}

function findStep(payload: TimingPayload, name: string): TimingStep | undefined {
  return (payload.steps ?? []).find((step) => step.name === name);
}

function hasStep(payload: TimingPayload, name: string): boolean {
  return Boolean(findStep(payload, name));
}

function stepAt(payload: TimingPayload, name: string): number | undefined {
  return numberValue(findStep(payload, name)?.atMs);
}

function stepDuration(payload: TimingPayload, name: string): number | undefined {
  return numberValue(findStep(payload, name)?.durationMs);
}

function firstEventType(payload: TimingPayload): string {
  const metadata = findStep(payload, "chat_stream.first_codex_event")?.metadata;
  return trimString(metadata?.eventType) || "unknown";
}

function durationBetween(payload: TimingPayload, startName: string, endName: string): number | undefined {
  const start = stepAt(payload, startName);
  const end = stepAt(payload, endName);
  if (start === undefined || end === undefined) return undefined;
  return roundMs(end - start);
}

function cacheState(payload: TimingPayload): StartupRecord["cacheState"] {
  if (hasStep(payload, "chat_stream.live_runtime_cache_hit")) return "hit";
  if (hasStep(payload, "chat_stream.live_runtime_cache_miss")) return "miss";
  return "unknown";
}

function runtimeState(payload: TimingPayload): StartupRecord["runtimeState"] {
  const cache = cacheState(payload);
  if (cache === "hit") return "warm_cache_hit";
  if (hasStep(payload, "chat_stream.restore_live_runtime")) return "restored_runtime";
  if (cache === "miss") return "cache_miss_unrestored";
  return "unknown";
}

function toStartupRecord(payload: TimingPayload): StartupRecord {
  const firstToDone = durationBetween(payload, "chat_stream.first_codex_event", "chat_stream.on_done_started");
  const fallbackFirstToDone = durationBetween(payload, "chat_stream.first_codex_event", "chat_stream.done_sent");
  return {
    traceId: trimString(payload.trace_id),
    threadId: trimString(payload.thread_id),
    sessionId: trimString(payload.session_id),
    model: trimString(payload.model) || "unknown",
    status: trimString(payload.status) || "unknown",
    logReason: trimString(payload.log_reason) || "unknown",
    cacheState: cacheState(payload),
    runtimeState: runtimeState(payload),
    firstEventType: firstEventType(payload),
    metrics: {
      requestToMetaMs: durationBetween(payload, "request_received", "chat_stream.meta_sent"),
      metaToPromptMs: durationBetween(payload, "chat_stream.meta_sent", "chat_stream.runtime_prompt_prepared"),
      enterpriseContextMs: roundMs(stepDuration(payload, "chat_stream.resolve_enterprise_context")),
      runtimeStartToFirstMs: durationBetween(payload, "chat_stream.runtime_stream_starting", "chat_stream.first_codex_event"),
      metaToFirstMs: durationBetween(payload, "chat_stream.meta_sent", "chat_stream.first_codex_event"),
      codexStreamMs: firstToDone ?? fallbackFirstToDone,
      postDoneMs: durationBetween(payload, "chat_stream.on_done_started", "chat_stream.done_sent"),
      registerArtifactsMs: roundMs(stepDuration(payload, "chat_stream.register_artifacts")),
      startupMs: roundMs(numberValue(payload.startup_ms)),
      totalMs: roundMs(numberValue(payload.total_ms))
    }
  };
}

function percentile(values: number[], pct: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeValues(values: number[]): Stats {
  if (values.length === 0) return { count: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    avg: roundMs(total / values.length),
    p50: roundMs(percentile(values, 50)),
    p90: roundMs(percentile(values, 90)),
    p95: roundMs(percentile(values, 95)),
    max: roundMs(Math.max(...values))
  };
}

function summarizeGroup(key: string, records: StartupRecord[]): GroupSummary {
  const metrics: Partial<Record<MetricKey, Stats>> = {};
  for (const metric of Object.keys(METRIC_LABELS) as MetricKey[]) {
    const values = records
      .map((record) => record.metrics[metric])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    metrics[metric] = summarizeValues(values);
  }
  return {
    key,
    count: records.length,
    metrics
  };
}

function groupBy(records: StartupRecord[], keyOf: (record: StartupRecord) => string): GroupSummary[] {
  const groups = new Map<string, StartupRecord[]>();
  for (const record of records) {
    const key = keyOf(record) || "unknown";
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([key, values]) => summarizeGroup(key, values));
}

function formatMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}s`;
  return `${value.toFixed(1)}ms`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1).padEnd(width, " ") : value.padEnd(width, " ");
}

function metricCell(summary: GroupSummary, metric: MetricKey): string {
  const stats = summary.metrics[metric];
  if (!stats || stats.count === 0) return "-";
  return `${formatMs(stats.avg)}/${formatMs(stats.p50)}/${formatMs(stats.p90)}`;
}

function printGroupTable(title: string, summaries: GroupSummary[]): void {
  const columns = [
    ["group", 30],
    ["n", 5],
    ["request->meta avg/p50/p90", 28],
    ["runtime->first avg/p50/p90", 30],
    ["meta->first avg/p50/p90", 28],
    ["Codex stream avg/p50/p90", 29],
    ["total avg/p50/p90", 25]
  ] as const;
  console.log("");
  console.log(title);
  console.log(columns.map(([label, width]) => pad(label, width)).join(" "));
  console.log(columns.map(([, width]) => "-".repeat(width)).join(" "));
  for (const summary of summaries) {
    console.log([
      pad(summary.key, 30),
      pad(String(summary.count), 5),
      pad(metricCell(summary, "requestToMetaMs"), 28),
      pad(metricCell(summary, "runtimeStartToFirstMs"), 30),
      pad(metricCell(summary, "metaToFirstMs"), 28),
      pad(metricCell(summary, "codexStreamMs"), 29),
      pad(metricCell(summary, "totalMs"), 25)
    ].join(" "));
  }
}

function printHuman(options: CliOptions, records: StartupRecord[]): void {
  console.log(`Portal chat startup timing: ${records.length} ${options.operation} samples`);
  console.log(`Logs: ${options.logPaths.join(", ")}`);
  const missingFirst = records.filter((record) => record.metrics.metaToFirstMs === undefined).length;
  const missingRuntimeStart = records.filter(
    (record) => record.metrics.metaToFirstMs !== undefined && record.metrics.runtimeStartToFirstMs === undefined
  ).length;
  if (missingFirst > 0) {
    console.log(`Records without first Codex event: ${missingFirst}`);
  }
  if (missingRuntimeStart > 0) {
    console.log(`Records without runtime_stream_starting mark: ${missingRuntimeStart}`);
  }
  console.log("Metric cell format: avg/p50/p90");

  printGroupTable("Overall", [summarizeGroup("all", records)]);
  printGroupTable("By runtime cache", groupBy(records, (record) => record.cacheState));
  printGroupTable("By runtime state", groupBy(records, (record) => record.runtimeState));
  printGroupTable("By model", groupBy(records, (record) => record.model));
  printGroupTable("By cache + model", groupBy(records, (record) => `${record.cacheState} / ${record.model}`));

  const detailed = summarizeGroup("all", records);
  console.log("");
  console.log("Detailed overall metrics");
  for (const metric of Object.keys(METRIC_LABELS) as MetricKey[]) {
    const stats = detailed.metrics[metric];
    if (!stats || stats.count === 0) continue;
    console.log(
      `${pad(METRIC_LABELS[metric], 18)} n=${stats.count} avg=${formatMs(stats.avg)} p50=${formatMs(stats.p50)} p90=${formatMs(stats.p90)} p95=${formatMs(stats.p95)} max=${formatMs(stats.max)}`
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.logPaths.length === 0) {
    console.error("No readable log files found. Pass --log <path>.");
    process.exit(1);
  }
  const payloads = await readPayloads(options);
  const records = payloads.map(toStartupRecord);
  if (options.json) {
    const output = {
      operation: options.operation,
      logs: options.logPaths,
      count: records.length,
      records,
      groups: {
        overall: [summarizeGroup("all", records)],
        cache: groupBy(records, (record) => record.cacheState),
        runtimeState: groupBy(records, (record) => record.runtimeState),
        model: groupBy(records, (record) => record.model),
        cacheModel: groupBy(records, (record) => `${record.cacheState} / ${record.model}`)
      }
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  printHuman(options, records);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
