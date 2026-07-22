#!/usr/bin/env node
/**
 * Standalone Codex local usage and cost report.
 * Requires Node.js 18+ only; no npm install or repository checkout is needed.
 * Generated from agent-api/src/ops/local-codex-usage-report.ts.
 */

// src/ops/local-codex-usage-report.ts
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/live-runtime-session.ts
function trimOrUndefined(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed || void 0;
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function toTokenCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return void 0;
  return Math.round(numeric);
}
function parseUsageRecord(value, kind, options = {}) {
  const usage2 = asRecord(value);
  if (!usage2) return void 0;
  const inputTokens = toTokenCount(usage2.input_tokens);
  const cachedInputTokens = toTokenCount(usage2.cached_input_tokens);
  const cacheWriteTokens = toTokenCount(usage2.cache_write_tokens ?? usage2.cacheWriteTokens);
  const outputTokens = toTokenCount(usage2.output_tokens);
  if (inputTokens === void 0 || cachedInputTokens === void 0 || outputTokens === void 0) {
    return void 0;
  }
  return {
    inputTokens,
    cachedInputTokens,
    ...cacheWriteTokens !== void 0 ? { cacheWriteTokens } : {},
    outputTokens,
    kind,
    cumulativeInputTokens: options.cumulative?.inputTokens,
    cumulativeCachedInputTokens: options.cumulative?.cachedInputTokens,
    ...options.cumulative?.cacheWriteTokens !== void 0 ? { cumulativeCacheWriteTokens: options.cumulative.cacheWriteTokens } : {},
    cumulativeOutputTokens: options.cumulative?.outputTokens,
    codexThreadId: options.codexThreadId
  };
}
function parseTokenCountUsage(event, raw) {
  const source = raw?.type === "token_count" ? raw : event;
  const info = asRecord(source.info);
  const codexThreadId = trimOrUndefined(typeof source.thread_id === "string" ? source.thread_id : void 0);
  const cumulative = parseUsageRecord(info?.total_token_usage, "cumulative_snapshot", { codexThreadId });
  const last = parseUsageRecord(info?.last_token_usage, "turn_delta", { codexThreadId });
  const modelContextWindow = toTokenCount(info?.model_context_window);
  const modelInvocation = last ? {
    inputTokens: last.inputTokens,
    cachedInputTokens: last.cachedInputTokens,
    ...last.cacheWriteTokens !== void 0 ? { cacheWriteTokens: last.cacheWriteTokens } : {},
    outputTokens: last.outputTokens,
    ...modelContextWindow !== void 0 ? { modelContextWindow } : {}
  } : void 0;
  const selected = cumulative ?? last;
  if (!selected) return void 0;
  return {
    ...selected,
    ...modelContextWindow !== void 0 ? { modelContextWindow } : {},
    ...modelInvocation ? { modelInvocations: [modelInvocation] } : {}
  };
}
function extractRuntimeUsageFromStreamEvent(value) {
  const event = asRecord(value);
  if (!event) return void 0;
  const eventType = trimOrUndefined(typeof event.type === "string" ? event.type : void 0);
  const raw = asRecord(event.raw);
  if (eventType === "token_count" || raw?.type === "token_count") {
    return parseTokenCountUsage(event, raw);
  }
  if (eventType !== "turn.completed") return void 0;
  const usage2 = asRecord(raw?.usage ?? event.usage ?? asRecord(raw?.turn)?.usage);
  if (!usage2) return void 0;
  const codexThreadId = trimOrUndefined(
    typeof raw?.thread_id === "string" ? raw.thread_id : typeof event.thread_id === "string" ? event.thread_id : void 0
  );
  const cumulative = parseUsageRecord(usage2.total_token_usage, "cumulative_snapshot", { codexThreadId });
  const turn = parseUsageRecord(usage2.last_token_usage, "turn_delta", {
    cumulative,
    codexThreadId
  });
  return turn ?? parseUsageRecord(usage2, "cumulative_snapshot", { codexThreadId });
}

// src/operations/usage-metrics.ts
function billableUncachedInputTokens(inputTokens, cachedInputTokens) {
  return Math.max(0, inputTokens - cachedInputTokens);
}

// src/operations/usage-ingestion-service.ts
function sanitizeUsage(input) {
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.round(input.cachedInputTokens ?? 0)));
  const cacheWriteTokens = Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    Math.max(0, Math.round(input.cacheWriteTokens ?? 0))
  );
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens
  };
}
function parseDecimal(value, fallback = 0) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function formatCost(value) {
  if (!Number.isFinite(value)) return "0.000000";
  return value.toFixed(6);
}
function pricePerToken(pricePerMillionTokens) {
  return pricePerMillionTokens / 1e6;
}
function invocationCost(input) {
  const billableUncachedTokens = billableUncachedInputTokens(input.usage.inputTokens, input.usage.cachedInputTokens);
  const cacheWriteTokens = input.cacheWriteTelemetryAvailable ? input.usage.cacheWriteTokens : input.cacheWriteTokenPrice > 0 ? billableUncachedTokens : 0;
  const uncachedInputTokens = Math.max(0, billableUncachedTokens - cacheWriteTokens);
  return uncachedInputTokens * input.inputTokenPrice + input.usage.cachedInputTokens * input.cachedInputTokenPrice + cacheWriteTokens * input.cacheWriteTokenPrice + input.usage.outputTokens * input.outputTokenPrice;
}
function sanitizePricingInvocations(input) {
  if (!input.invocations) return { invocations: [], complete: false };
  const invocations = input.invocations.map((invocation) => sanitizeUsage(invocation));
  const totals = invocations.reduce(
    (sum, invocation) => ({
      inputTokens: sum.inputTokens + invocation.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + invocation.cachedInputTokens,
      cacheWriteTokens: sum.cacheWriteTokens + invocation.cacheWriteTokens,
      outputTokens: sum.outputTokens + invocation.outputTokens
    }),
    { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
  );
  const withinAggregate = totals.inputTokens <= input.aggregate.inputTokens && totals.cachedInputTokens <= input.aggregate.cachedInputTokens && totals.cacheWriteTokens <= input.aggregate.cacheWriteTokens && totals.outputTokens <= input.aggregate.outputTokens;
  return {
    invocations: withinAggregate ? invocations : [],
    complete: withinAggregate && totals.inputTokens === input.aggregate.inputTokens && totals.outputTokens === input.aggregate.outputTokens
  };
}
function calculateEstimatedCost(input) {
  const longContextPricingBasis = input.longContextPricingBasis ?? "aggregate_request";
  if (!input.profile) {
    return {
      estimatedCost: "0.000000",
      internalCost: "0.000000",
      longContextApplied: false,
      longContextInvocationCount: 0,
      maxInvocationInputTokens: 0,
      longContextPricingBasis,
      longContextPricingComplete: longContextPricingBasis === "aggregate_request"
    };
  }
  const inputTokenPrice = pricePerToken(parseDecimal(input.profile.inputTokenPrice));
  const cachedInputTokenPrice = pricePerToken(parseDecimal(input.profile.cachedInputTokenPrice));
  const cacheWriteTokenPrice = pricePerToken(parseDecimal(input.profile.cacheWriteTokenPrice));
  const outputTokenPrice = pricePerToken(parseDecimal(input.profile.outputTokenPrice));
  const longContextThresholdTokens = input.profile.longContextThresholdTokens ?? 0;
  const inputPriceMultiplier = parseDecimal(input.profile.longContextInputMultiplier, 1);
  const outputPriceMultiplier = parseDecimal(input.profile.longContextOutputMultiplier, 1);
  const internalCostMultiplier = parseDecimal(input.profile.internalCostMultiplier, 1);
  const aggregateUsage = sanitizeUsage(input);
  const baseEstimated = invocationCost({
    usage: aggregateUsage,
    inputTokenPrice,
    cachedInputTokenPrice,
    cacheWriteTokenPrice,
    outputTokenPrice,
    cacheWriteTelemetryAvailable: input.cacheWriteTelemetryAvailable
  });
  const pricingInvocations = sanitizePricingInvocations({
    invocations: input.modelInvocations,
    aggregate: aggregateUsage
  });
  const candidates = longContextPricingBasis === "model_invocation" ? pricingInvocations.invocations : [aggregateUsage];
  const longInvocations = longContextThresholdTokens > 0 ? candidates.filter((invocation) => invocation.inputTokens > longContextThresholdTokens) : [];
  const longContextExtra = longInvocations.reduce((sum, invocation) => {
    const normalInputCost = invocationCost({
      usage: { ...invocation, outputTokens: 0 },
      inputTokenPrice,
      cachedInputTokenPrice,
      cacheWriteTokenPrice,
      outputTokenPrice,
      cacheWriteTelemetryAvailable: input.cacheWriteTelemetryAvailable
    });
    const normalOutputCost = invocation.outputTokens * outputTokenPrice;
    return sum + normalInputCost * (inputPriceMultiplier - 1) + normalOutputCost * (outputPriceMultiplier - 1);
  }, 0);
  const estimated = baseEstimated + longContextExtra;
  const internal = estimated * internalCostMultiplier;
  const maxInvocationInputTokens = candidates.reduce((max, invocation) => Math.max(max, invocation.inputTokens), 0);
  return {
    estimatedCost: formatCost(estimated),
    internalCost: formatCost(internal),
    longContextApplied: longInvocations.length > 0,
    longContextInvocationCount: longInvocations.length,
    maxInvocationInputTokens,
    longContextPricingBasis,
    longContextPricingComplete: longContextPricingBasis === "aggregate_request" || pricingInvocations.complete
  };
}

// src/ops/local-codex-usage-report.ts
var MS_PER_DAY = 24 * 60 * 60 * 1e3;
var LONG_CONTEXT_THRESHOLD = 272e3;
var DEFAULT_DAYS = 7;
var DEFAULT_TOP = 10;
var PRICING_SOURCE_URL = "https://developers.openai.com/api/docs/pricing";
var MODEL_NOTES_SOURCE_URLS = [
  "https://developers.openai.com/api/docs/models/gpt-5.5",
  "https://developers.openai.com/api/docs/models/gpt-5.4",
  "https://developers.openai.com/api/docs/models/gpt-5.6-sol"
];
var PRICING = {
  standard: {
    "gpt-5.6-sol": withLongContext({ input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 }),
    "gpt-5.6-terra": withLongContext({ input: 2.5, cachedInput: 0.25, cacheWrite: 3.125, output: 15 }),
    "gpt-5.6-luna": withLongContext({ input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 6 }),
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
    "gpt-5-nano": { input: 0.05, cachedInput: 5e-3, output: 0.4 },
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
    "gpt-5.6-sol": withLongContext({ input: 2.5, cachedInput: 0.25, cacheWrite: 3.125, output: 15 }),
    "gpt-5.6-terra": withLongContext({ input: 1.25, cachedInput: 0.125, cacheWrite: 1.5625, output: 7.5 }),
    "gpt-5.6-luna": withLongContext({ input: 0.5, cachedInput: 0.05, cacheWrite: 0.625, output: 3 }),
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
    "gpt-5-nano": { input: 0.025, cachedInput: 25e-4, output: 0.2 },
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
    "gpt-5.6-sol": withLongContext({ input: 2.5, cachedInput: 0.25, cacheWrite: 3.125, output: 15 }),
    "gpt-5.6-terra": withLongContext({ input: 1.25, cachedInput: 0.125, cacheWrite: 1.5625, output: 7.5 }),
    "gpt-5.6-luna": withLongContext({ input: 0.5, cachedInput: 0.05, cacheWrite: 0.625, output: 3 }),
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
    "gpt-5-nano": { input: 0.025, cachedInput: 25e-4, output: 0.2 },
    o3: { input: 1, cachedInput: 0.25, output: 4 },
    "o4-mini": { input: 0.55, cachedInput: 0.138, output: 2.2 }
  },
  priority: {
    "gpt-5.6-sol": { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 60 },
    "gpt-5.6-terra": { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
    "gpt-5.6-luna": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
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
function withLongContext(price) {
  return {
    ...price,
    longContextThreshold: LONG_CONTEXT_THRESHOLD,
    longContext: {
      input: price.input * 2,
      cachedInput: price.cachedInput === void 0 ? void 0 : price.cachedInput * 2,
      cacheWrite: price.cacheWrite === void 0 ? void 0 : price.cacheWrite * 2,
      output: price.output * 1.5
    }
  };
}
function usage(exitCode = 2) {
  const message = [
    "Usage: node codex-local-usage-report.mjs [options]",
    "",
    "Options:",
    "  --days <n>              Rolling window in days. Default: 7",
    "  --since <iso>           Start timestamp, overrides --days",
    "  --until <iso>           End timestamp. Default: now",
    "  --codex-root <path>     Codex data root. Default: ~/.codex (includes sessions and archived_sessions)",
    "  --sessions-root <path>  Compatibility alias for --codex-root",
    "  --out-dir <path>        Directory for JSON/CSV files. Default: ./local-codex-usage-<timestamp>",
    "  --no-files              Print only; do not write JSON/CSV outputs",
    "  --top <n>               Number of top sessions/requests to print. Default: 10",
    "  --timezone <tz>         IANA timezone for daily buckets. Default: system timezone",
    "  --tier <name>           Pricing tier: standard, batch, flex, priority. Default: standard",
    "  --help                  Show this help",
    "",
    "The script reads only session metadata and token_count usage records; it does not print prompt or response content."
  ].join("\n");
  if (exitCode === 0) console.log(message);
  else console.error(message);
  process.exit(exitCode);
}
function parseArgs(argv) {
  const untilDefault = /* @__PURE__ */ new Date();
  const out = {
    days: DEFAULT_DAYS,
    until: untilDefault,
    sessionsRoot: path.join(os.homedir(), ".codex"),
    writeFiles: true,
    top: DEFAULT_TOP,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    tier: "standard"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") usage(0);
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
    if (arg === "--sessions-root" || arg === "--codex-root") {
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
      const tier = requireValue(argv[++index], "--tier");
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
function requireValue(value, flag) {
  if (!value) {
    console.error(`${flag} requires a value`);
    usage();
  }
  return value;
}
function parseDateArg(value, flag) {
  const raw = requireValue(value, flag);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} is not a valid date: ${raw}`);
  }
  return date;
}
function resolveHomePath(input) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}
function asRecord2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
async function* walkJsonlFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
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
function codexSessionRoots(root) {
  const namedRoots = ["sessions", "archived_sessions"].map((directory) => path.join(root, directory)).filter((directory) => fsSync.existsSync(directory) && fsSync.statSync(directory).isDirectory());
  return namedRoots.length > 0 ? namedRoots : [root];
}
function sessionIdFromFile(filePath) {
  const baseName = path.basename(filePath, ".jsonl");
  const match = baseName.match(/^rollout-.+?-(019[0-9a-f-]+)$/i);
  return match?.[1] ?? baseName;
}
function localDateKey(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function localDateTime(date, timezone) {
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
function normalizeModel(model) {
  const normalized = model.trim();
  for (const base of [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
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
function costProfileFor(model, tier) {
  const priceModel = normalizeModel(model);
  const price = PRICING[tier][priceModel];
  if (!price) return {};
  const now = (/* @__PURE__ */ new Date(0)).toISOString();
  return {
    priceModel,
    profile: {
      id: `local:${tier}:${priceModel}`,
      model: priceModel,
      inputTokenPrice: String(price.input),
      cachedInputTokenPrice: String(price.cachedInput ?? price.input),
      cacheWriteTokenPrice: String(price.cacheWrite ?? 0),
      outputTokenPrice: String(price.output),
      longContextThresholdTokens: tier === "priority" ? void 0 : price.longContextThreshold,
      longContextInputMultiplier: price.longContext ? "2" : "1",
      longContextOutputMultiplier: price.longContext ? "1.5" : "1",
      internalCostMultiplier: "1",
      isActive: true,
      createdAt: now,
      updatedAt: now
    }
  };
}
function estimatedCost(input) {
  const { profile, priceModel } = costProfileFor(input.model, input.tier);
  if (!profile) return { longContext: false, costCompleteness: "complete" };
  const cacheWriteTelemetryAvailable = input.cacheWriteTokens !== void 0;
  const invocation = {
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    outputTokens: input.outputTokens
  };
  const calculated = calculateEstimatedCost({
    profile,
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    cacheWriteTokens: input.cacheWriteTokens ?? 0,
    outputTokens: input.outputTokens,
    cacheWriteTelemetryAvailable,
    modelInvocations: [invocation],
    longContextPricingBasis: "model_invocation"
  });
  return {
    cost: Number(calculated.estimatedCost),
    priceModel,
    longContext: calculated.longContextApplied,
    costCompleteness: !cacheWriteTelemetryAvailable && Number(profile.cacheWriteTokenPrice ?? 0) > 0 ? "upper_bound_missing_cache_write_tokens" : "complete"
  };
}
function reasoningOutputTokensFromPayload(payload) {
  const info = asRecord2(payload.info);
  const usage2 = asRecord2(info?.last_token_usage) ?? asRecord2(info?.total_token_usage);
  return numberValue(usage2?.reasoning_output_tokens);
}
function deltaFromCumulative(current, previous) {
  if (previous === void 0 || current < previous) return Math.max(0, current);
  return Math.max(0, current - previous);
}
function cumulativeUsageKey(usage2, key) {
  if (usage2.kind !== "cumulative_snapshot") return void 0;
  return [
    key,
    usage2.inputTokens,
    usage2.cachedInputTokens,
    usage2.cacheWriteTokens ?? "",
    usage2.outputTokens
  ].join(":");
}
function usageForLocalModelCall(usage2, state, key) {
  if (usage2.kind !== "cumulative_snapshot") return usage2;
  const usageKey = cumulativeUsageKey(usage2, key);
  if (usageKey && state.seenCumulativeUsage.has(usageKey)) return void 0;
  if (usageKey) state.seenCumulativeUsage.add(usageKey);
  const previous = state.previousCumulativeByKey.get(key);
  state.previousCumulativeByKey.set(key, usage2);
  const modelInvocation = usage2.modelInvocations?.at(-1);
  if (modelInvocation) {
    return {
      ...usage2,
      inputTokens: modelInvocation.inputTokens,
      cachedInputTokens: modelInvocation.cachedInputTokens,
      cacheWriteTokens: modelInvocation.cacheWriteTokens,
      outputTokens: modelInvocation.outputTokens,
      kind: "turn_delta",
      cumulativeInputTokens: usage2.inputTokens,
      cumulativeCachedInputTokens: usage2.cachedInputTokens,
      cumulativeCacheWriteTokens: usage2.cacheWriteTokens,
      cumulativeOutputTokens: usage2.outputTokens
    };
  }
  const inputTokens = deltaFromCumulative(usage2.inputTokens, previous?.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    deltaFromCumulative(usage2.cachedInputTokens, previous?.cachedInputTokens)
  );
  const cacheWriteTokens = usage2.cacheWriteTokens === void 0 ? void 0 : Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    deltaFromCumulative(usage2.cacheWriteTokens, previous?.cacheWriteTokens)
  );
  return {
    ...usage2,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens: deltaFromCumulative(usage2.outputTokens, previous?.outputTokens),
    kind: "turn_delta",
    cumulativeInputTokens: usage2.inputTokens,
    cumulativeCachedInputTokens: usage2.cachedInputTokens,
    cumulativeCacheWriteTokens: usage2.cacheWriteTokens,
    cumulativeOutputTokens: usage2.outputTokens
  };
}
async function parseSessionFile(filePath, options, state) {
  const fallbackSessionId = sessionIdFromFile(filePath);
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const requests = [];
  let sessionId = fallbackSessionId;
  let cwd = "";
  let model = "";
  let startedAt = "";
  let lastEventAt = "";
  for (const line of content.split(/\n/)) {
    if (!line.trim()) continue;
    let root;
    try {
      root = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord2(root);
    if (!record) continue;
    const timestamp = stringValue(record.timestamp);
    if (timestamp) {
      startedAt ||= timestamp;
      lastEventAt = timestamp;
    }
    const payload = asRecord2(record.payload);
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
    const rawUsage = extractRuntimeUsageFromStreamEvent(payload);
    if (!rawUsage) continue;
    const usage2 = usageForLocalModelCall(
      rawUsage,
      state,
      rawUsage.codexThreadId ?? sessionId
    );
    if (!usage2) continue;
    if (eventAt < options.since || eventAt >= options.until) continue;
    const modelForRequest = model || "unknown";
    const cost = estimatedCost({
      model: modelForRequest,
      tier: options.tier,
      inputTokens: usage2.inputTokens,
      cachedInputTokens: usage2.cachedInputTokens,
      cacheWriteTokens: usage2.cacheWriteTokens,
      outputTokens: usage2.outputTokens
    });
    const request = {
      id: `${sessionId}:${path.basename(filePath, ".jsonl")}:${requests.length + 1}`,
      sessionId,
      timestamp,
      localDate: localDateKey(eventAt, options.timezone),
      cwd,
      model: modelForRequest,
      priceModel: cost.priceModel,
      priceTier: options.tier,
      longContext: cost.longContext,
      costCompleteness: cost.costCompleteness,
      inputTokens: usage2.inputTokens,
      cachedInputTokens: usage2.cachedInputTokens,
      cacheWriteTokens: usage2.cacheWriteTokens ?? 0,
      outputTokens: usage2.outputTokens,
      reasoningOutputTokens: reasoningOutputTokensFromPayload(payload),
      estimatedCost: cost.cost,
      filePath
    };
    requests.push(request);
  }
  if (!requests.length) return { requests };
  const session = {
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
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCost: 0,
    unknownPriceRequests: 0,
    upperBoundCostRequests: 0
  };
  for (const request of requests) {
    addUsage(session, request);
  }
  return { session, requests };
}
function addUsage(target, request) {
  target.requests += 1;
  target.inputTokens += request.inputTokens;
  target.cachedInputTokens += request.cachedInputTokens;
  target.cacheWriteTokens += request.cacheWriteTokens;
  target.outputTokens += request.outputTokens;
  target.reasoningOutputTokens += request.reasoningOutputTokens;
  target.estimatedCost += request.estimatedCost ?? 0;
  if (request.estimatedCost === void 0) target.unknownPriceRequests += 1;
  if (request.costCompleteness === "upper_bound_missing_cache_write_tokens") target.upperBoundCostRequests += 1;
}
function addAggregate(map, key, request) {
  const current = map.get(key) ?? {
    key,
    sessions: /* @__PURE__ */ new Set(),
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCost: 0,
    unknownPriceRequests: 0,
    upperBoundCostRequests: 0
  };
  current.sessions.add(request.sessionId);
  addUsage(current, request);
  map.set(key, current);
}
function mergeSessionSummary(target, source) {
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
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.estimatedCost += source.estimatedCost;
  target.unknownPriceRequests += source.unknownPriceRequests;
  target.upperBoundCostRequests += source.upperBoundCostRequests;
}
function aggregateRequests(requests, keyOf) {
  const map = /* @__PURE__ */ new Map();
  for (const request of requests) {
    addAggregate(map, keyOf(request), request);
  }
  return [...map.values()].sort((left, right) => left.key.localeCompare(right.key));
}
function aggregateToOutput(row) {
  return {
    key: row.key,
    sessions: row.sessions.size,
    modelCalls: row.requests,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    uncachedInputTokens: Math.max(0, row.inputTokens - row.cachedInputTokens - row.cacheWriteTokens),
    outputTokens: row.outputTokens,
    reasoningOutputTokens: row.reasoningOutputTokens,
    totalTokens: row.inputTokens + row.outputTokens,
    cacheShare: row.inputTokens > 0 ? row.cachedInputTokens / row.inputTokens : 0,
    estimatedCost: row.estimatedCost,
    unknownPriceModelCalls: row.unknownPriceRequests,
    upperBoundCostModelCalls: row.upperBoundCostRequests
  };
}
function formatInteger(value) {
  return Math.round(value).toLocaleString("en-US");
}
function formatUsd(value) {
  if (value === void 0) return "n/a";
  return `$${value.toFixed(4)}`;
}
function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
function printTable(title, rows, columns) {
  console.log(`
${title}`);
  if (!rows.length) {
    console.log("  (no rows)");
    return;
  }
  const widths = columns.map(
    (column) => Math.max(
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
function csvEscape(value) {
  if (value === void 0 || value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0] ?? {});
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n");
}
function outputPathValue(filePath) {
  return filePath.startsWith(os.homedir()) ? `~${filePath.slice(os.homedir().length)}` : filePath;
}
function findProjectRoot() {
  let current = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth += 1) {
    if (fsSync.existsSync(path.join(current, "AGENTS.md")) && fsSync.existsSync(path.join(current, "agent-api"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return void 0;
}
function defaultOutputDir() {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const projectRoot = findProjectRoot();
  return projectRoot ? path.join(projectRoot, "temp", `local-codex-usage-${stamp}`) : path.join(process.cwd(), `local-codex-usage-${stamp}`);
}
async function writeOutputs(input) {
  if (!input.options.writeFiles) return void 0;
  const outputDir = input.options.outputDir ?? defaultOutputDir();
  await fs.mkdir(outputDir, { recursive: true });
  const summary = {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    range: {
      since: input.options.since.toISOString(),
      until: input.options.until.toISOString(),
      timezone: input.options.timezone,
      days: input.options.days
    },
    pricing: {
      tier: input.options.tier,
      source: PRICING_SOURCE_URL,
      modelNotes: MODEL_NOTES_SOURCE_URLS,
      note: "Costs use the same calculator as production. Long-context multipliers are evaluated per deduplicated model call; missing cache-write telemetry uses the production upper-bound policy.",
      compatibility: "requests.csv is a legacy filename alias of model-calls.csv; its rows are model calls, not business requests."
    },
    totals: aggregateToOutput(input.totals),
    byDay: input.byDay.map(aggregateToOutput),
    byModel: input.byModel.map(aggregateToOutput),
    byCwd: input.byCwd.map(aggregateToOutput),
    sessions: input.sessions.map(sessionToOutput),
    modelCalls: input.requests.map(requestToOutput)
  };
  await Promise.all([
    fs.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8"),
    fs.writeFile(path.join(outputDir, "daily.csv"), toCsv(input.byDay.map(aggregateToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "models.csv"), toCsv(input.byModel.map(aggregateToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "workspaces.csv"), toCsv(input.byCwd.map(aggregateToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "sessions.csv"), toCsv(input.sessions.map(sessionToOutput)), "utf8"),
    fs.writeFile(path.join(outputDir, "model-calls.csv"), toCsv(input.requests.map(requestToOutput)), "utf8"),
    // Kept as a compatibility alias for existing local automations.
    fs.writeFile(path.join(outputDir, "requests.csv"), toCsv(input.requests.map(requestToOutput)), "utf8")
  ]);
  return outputDir;
}
function sessionToOutput(session) {
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    cwd: session.cwd,
    model: session.model,
    files: session.fileCount,
    modelCalls: session.requests,
    inputTokens: session.inputTokens,
    cachedInputTokens: session.cachedInputTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    uncachedInputTokens: Math.max(0, session.inputTokens - session.cachedInputTokens - session.cacheWriteTokens),
    outputTokens: session.outputTokens,
    reasoningOutputTokens: session.reasoningOutputTokens,
    totalTokens: session.inputTokens + session.outputTokens,
    cacheShare: session.inputTokens > 0 ? session.cachedInputTokens / session.inputTokens : 0,
    estimatedCost: session.estimatedCost,
    unknownPriceModelCalls: session.unknownPriceRequests,
    upperBoundCostModelCalls: session.upperBoundCostRequests,
    filePath: outputPathValue(session.filePath)
  };
}
function requestToOutput(request) {
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
    costCompleteness: request.costCompleteness,
    inputTokens: request.inputTokens,
    cachedInputTokens: request.cachedInputTokens,
    cacheWriteTokens: request.cacheWriteTokens,
    uncachedInputTokens: Math.max(0, request.inputTokens - request.cachedInputTokens - request.cacheWriteTokens),
    outputTokens: request.outputTokens,
    reasoningOutputTokens: request.reasoningOutputTokens,
    totalTokens: request.inputTokens + request.outputTokens,
    estimatedCost: request.estimatedCost ?? "",
    filePath: outputPathValue(request.filePath)
  };
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessions = [];
  const sessionsById = /* @__PURE__ */ new Map();
  const requests = [];
  const usageState = {
    previousCumulativeByKey: /* @__PURE__ */ new Map(),
    seenCumulativeUsage: /* @__PURE__ */ new Set()
  };
  const filePaths = [];
  for (const root of codexSessionRoots(options.sessionsRoot)) {
    for await (const filePath of walkJsonlFiles(root)) {
      filePaths.push(filePath);
    }
  }
  filePaths.sort();
  for (const filePath of filePaths) {
    const parsed = await parseSessionFile(filePath, options, usageState);
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
    sessions: /* @__PURE__ */ new Set(),
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    estimatedCost: 0,
    unknownPriceRequests: 0,
    upperBoundCostRequests: 0
  };
  const outputDir = await writeOutputs({ options, sessions, requests, byDay, byModel, byCwd, totals });
  console.log("Local Codex usage report");
  console.log(`Range: ${localDateTime(options.since, options.timezone)} to ${localDateTime(options.until, options.timezone)} (${options.timezone})`);
  console.log(`Sessions root: ${outputPathValue(options.sessionsRoot)}`);
  console.log(`Pricing: OpenAI API ${options.tier} text-token prices per 1M tokens`);
  console.log(`Pricing source: ${PRICING_SOURCE_URL}`);
  console.log(`Sessions: ${formatInteger(totals.sessions.size)} | Model calls: ${formatInteger(totals.requests)}`);
  console.log(
    [
      `Input: ${formatInteger(totals.inputTokens)}`,
      `Cached: ${formatInteger(totals.cachedInputTokens)} (${formatPercent(totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : 0)})`,
      `Cache write: ${formatInteger(totals.cacheWriteTokens)}`,
      `Output: ${formatInteger(totals.outputTokens)}`,
      `Reasoning output: ${formatInteger(totals.reasoningOutputTokens)}`,
      `Estimated cost: ${formatUsd(totals.estimatedCost)}`
    ].join(" | ")
  );
  if (totals.unknownPriceRequests > 0) {
    console.log(`Warning: ${formatInteger(totals.unknownPriceRequests)} model calls used models without a bundled official price profile.`);
  }
  if (totals.upperBoundCostRequests > 0) {
    console.log(`Notice: ${formatInteger(totals.upperBoundCostRequests)} model calls lacked cache-write telemetry and used the production upper-bound policy.`);
  }
  printTable(
    "Daily",
    byDay.map((row) => ({
      date: row.key,
      sessions: row.sessions.size,
      modelCalls: row.requests,
      input: formatInteger(row.inputTokens),
      cached: formatInteger(row.cachedInputTokens),
      output: formatInteger(row.outputTokens),
      cost: formatUsd(row.estimatedCost)
    })),
    ["date", "sessions", "modelCalls", "input", "cached", "output", "cost"]
  );
  printTable(
    "By model",
    byModel.slice(0, options.top).map((row) => ({
      model: row.key,
      sessions: row.sessions.size,
      modelCalls: row.requests,
      input: formatInteger(row.inputTokens),
      cached: formatInteger(row.cachedInputTokens),
      output: formatInteger(row.outputTokens),
      cost: formatUsd(row.estimatedCost)
    })),
    ["model", "sessions", "modelCalls", "input", "cached", "output", "cost"]
  );
  printTable(
    `Top ${options.top} sessions by estimated cost`,
    sessions.slice(0, options.top).map((session) => ({
      session: session.sessionId,
      files: session.fileCount,
      modelCalls: session.requests,
      input: formatInteger(session.inputTokens),
      cached: formatInteger(session.cachedInputTokens),
      output: formatInteger(session.outputTokens),
      cost: formatUsd(session.estimatedCost),
      cwd: session.cwd
    })),
    ["session", "files", "modelCalls", "input", "cached", "output", "cost", "cwd"]
  );
  printTable(
    `Top ${options.top} workspaces by estimated cost`,
    byCwd.slice(0, options.top).map((row) => ({
      sessions: row.sessions.size,
      modelCalls: row.requests,
      input: formatInteger(row.inputTokens),
      output: formatInteger(row.outputTokens),
      cost: formatUsd(row.estimatedCost),
      cwd: row.key
    })),
    ["sessions", "modelCalls", "input", "output", "cost", "cwd"]
  );
  if (outputDir) {
    console.log(`
Wrote report files: ${outputDir}`);
  }
}
var invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
export {
  estimatedCost,
  usageForLocalModelCall
};
