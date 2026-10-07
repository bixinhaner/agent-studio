import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ConnectorEventEnvelope, ResourceRef } from "./contracts.js";

export type ScenarioMode = "disabled" | "shadow" | "active";
export type ScenarioPredicate = {
  field: string;
  op: "eq" | "ne" | "in" | "notIn" | "exists" | "notExists" | "gte" | "lte";
  value?: unknown;
};

export type ScenarioSpec = {
  key: string;
  name: string;
  description: string;
  version: number;
  eventType: string;
  match?: { all?: ScenarioPredicate[]; any?: ScenarioPredicate[] };
  dedupe: { keyTemplate: string; cooldownSeconds: number };
  rollout: { mode: ScenarioMode; percentage: number };
  agent: {
    agentMode: string;
    runtimeClass: string;
    skills: string[];
    timeoutSeconds: number;
    maxToolCalls: number;
    maxOutputBytes: number;
    allowedOperations: string[];
    prompt: string;
  };
  delivery: { surfaces: string[]; expiresAfterSeconds: number };
  limits: { maxConcurrentRuns: number; maxRunsPerHour: number };
  presentation: { icon: string; sections: string[]; surfaces: string[] };
};

export type FindingPromptInput = {
  objective: string;
  evidenceRule: string;
  severity: string;
  details: Record<string, unknown>;
  actions: Array<Record<string, string>>;
  presentation?: ScenarioSpec["presentation"];
};

function findingPrompt(input: FindingPromptInput & { key: string; presentation: ScenarioSpec["presentation"] }): string {
  return [
    `你是 xOMC 只读主动分析 Agent。${input.objective}`,
    "只能调用场景允许的 GET operation；不得执行修复、重试、配置变更或扩大事件资源范围。",
    input.evidenceRule,
    "必须把工具直接支持的内容放入 facts；未证实判断放入 hypotheses，并给出独立 confidence。",
    "事件发生时状态与当前快照必须明确区分；没有历史证据时不得使用确定因果表述。",
    "最终响应只能是符合 AgentFinding v1 的单个 JSON 对象，不要 Markdown 代码围栏或额外文字。",
    "resourceRefs 必须原样复制触发事件 resources，不得增加范围外资源。输出模板：",
    JSON.stringify({
      schemaVersion: "1.0",
      scenarioKey: input.key,
      scenarioVersion: 1,
      title: "简短、可操作的标题",
      summary: "基于证据的结论；证据不足时明确说明",
      severity: input.severity,
      confidence: 0.8,
      facts: [{ id: "fact-1", text: "已确认事实", evidenceRefs: ["tool:operation-id"] }],
      hypotheses: [{ id: "hyp-1", text: "待验证判断", confidence: 0.5, evidenceRefs: ["fact-1"] }],
      resourceRefs: [{ type: "resource", id: "从触发事件复制", role: "primary" }],
      details: input.details,
      suggestedActions: input.actions,
      presentation: input.presentation
    })
  ].join("\n");
}

/**
 * A scenario as written in the catalog file: the agent prompt is either given
 * verbatim or built from the AgentFinding template inputs.
 */
export type ScenarioSource = Omit<ScenarioSpec, "agent"> & {
  agent: Omit<ScenarioSpec["agent"], "prompt"> & { prompt?: string; finding?: FindingPromptInput };
};

export function compileScenario(source: ScenarioSource): ScenarioSpec {
  const { finding, prompt, ...agent } = source.agent;
  const compiledPrompt =
    prompt ??
    (finding ? findingPrompt({ ...finding, key: source.key, presentation: finding.presentation ?? source.presentation }) : undefined);
  if (!compiledPrompt) throw new Error(`scenario ${source.key} has neither agent.prompt nor agent.finding`);
  return { ...source, agent: { ...agent, prompt: compiledPrompt } };
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid scenario catalog: ${field} must be a non-empty string`);
}

/** Validates the catalog file; a bad edit is rejected as a whole so the previous catalog stays in use. */
export function parseScenarioCatalog(raw: unknown): ScenarioSpec[] {
  const root = raw && typeof raw === "object" ? (raw as { schemaVersion?: unknown; scenarios?: unknown }) : {};
  if (root.schemaVersion !== 1) throw new Error("invalid scenario catalog: schemaVersion must be 1");
  if (!Array.isArray(root.scenarios) || root.scenarios.length === 0) throw new Error("invalid scenario catalog: scenarios must be a non-empty array");
  const keys = new Set<string>();
  return root.scenarios.map((item, index) => {
    const source = item as ScenarioSource;
    requireString(source?.key, `scenarios[${index}].key`);
    if (keys.has(source.key)) throw new Error(`invalid scenario catalog: duplicate key ${source.key}`);
    keys.add(source.key);
    requireString(source.name, `${source.key}.name`);
    requireString(source.eventType, `${source.key}.eventType`);
    if (!Number.isInteger(source.version) || source.version < 1) throw new Error(`invalid scenario catalog: ${source.key}.version`);
    if (!["disabled", "shadow", "active"].includes(source.rollout?.mode)) throw new Error(`invalid scenario catalog: ${source.key}.rollout.mode`);
    if (!Array.isArray(source.agent?.allowedOperations) || source.agent.allowedOperations.some((op) => !/^get\./.test(op))) {
      // Proactive agents are read-only: only GET operations may be allowed.
      throw new Error(`invalid scenario catalog: ${source.key}.agent.allowedOperations must only contain get.* operations`);
    }
    requireString(source.dedupe?.keyTemplate, `${source.key}.dedupe.keyTemplate`);
    if (!source.limits || !source.delivery || !source.presentation) throw new Error(`invalid scenario catalog: ${source.key} is incomplete`);
    return compileScenario(source);
  });
}

// Scenario wording, policies and limits change more often than the worker code.
// They live in the checkout (agent-api/templates/runtime-content) and are
// reseeded when the file changes, so editing them never restarts chat.
const CATALOG_RELATIVE_PATH = path.join("templates", "runtime-content", "proactive-scenarios.json");
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function scenarioCatalogPaths(): string[] {
  return [...new Set([
    path.resolve(process.cwd(), CATALOG_RELATIVE_PATH),
    // The release copy, for processes started outside agent-api.
    path.resolve(moduleDir, "..", "..", "..", "..", CATALOG_RELATIVE_PATH)
  ])];
}

export type LoadedScenarioCatalog = { specs: ScenarioSpec[]; digest: string; path: string };

export function loadScenarioCatalog(paths = scenarioCatalogPaths()): LoadedScenarioCatalog {
  for (const file of paths) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const digest = createHash("sha256").update(text).digest("hex");
    return { specs: parseScenarioCatalog(JSON.parse(text)), digest, path: file };
  }
  throw new Error(`proactive scenario catalog not found (looked in ${paths.join(", ")})`);
}

let currentCatalog: LoadedScenarioCatalog = loadScenarioCatalog();

/** Scenarios as loaded at startup; use currentScenarios() for the latest catalog. */
export const BUILTIN_SCENARIOS: ScenarioSpec[] = currentCatalog.specs;

export function currentScenarioCatalog(): LoadedScenarioCatalog {
  return currentCatalog;
}

export function currentScenarios(): ScenarioSpec[] {
  return currentCatalog.specs;
}

/** Re-reads the catalog file; returns the new catalog when its content changed. Invalid edits keep the current one. */
export function reloadScenarioCatalog(paths?: string[]): LoadedScenarioCatalog | undefined {
  const next = loadScenarioCatalog(paths);
  if (next.digest === currentCatalog.digest) return undefined;
  currentCatalog = next;
  return next;
}

function getPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function eventContext(event: ConnectorEventEnvelope): Record<string, unknown> {
  return {
    event,
    data: event.data,
    resource: Object.fromEntries(event.resources.map((resource) => [resource.role, resource])),
    tenant: event.tenantRef
  };
}

export function evaluatePredicate(context: Record<string, unknown>, predicate: ScenarioPredicate): boolean {
  const actual = getPath(context, predicate.field);
  switch (predicate.op) {
    case "exists": return actual !== undefined && actual !== null;
    case "notExists": return actual === undefined || actual === null;
    case "eq": return actual === predicate.value;
    case "ne": return actual !== predicate.value;
    case "in": return Array.isArray(predicate.value) && predicate.value.includes(actual);
    case "notIn": return Array.isArray(predicate.value) && !predicate.value.includes(actual);
    case "gte": return typeof actual === "number" && typeof predicate.value === "number" && actual >= predicate.value;
    case "lte": return typeof actual === "number" && typeof predicate.value === "number" && actual <= predicate.value;
  }
}

export function matchesScenario(spec: ScenarioSpec, event: ConnectorEventEnvelope): boolean {
  if (spec.eventType !== event.eventType) return false;
  const context = eventContext(event);
  if (spec.match?.all?.some((predicate) => !evaluatePredicate(context, predicate))) return false;
  if (spec.match?.any?.length && !spec.match.any.some((predicate) => evaluatePredicate(context, predicate))) return false;
  return true;
}

export function renderDedupeKey(spec: ScenarioSpec, event: ConnectorEventEnvelope): string {
  const context = eventContext(event);
  return spec.dedupe.keyTemplate.replace(/\$\{([^}]+)\}/g, (_match, path: string) => {
    const value = getPath(context, path.trim());
    return value === undefined || value === null ? "missing" : String(value);
  });
}

export function includedInRollout(connectorId: string, spec: ScenarioSpec, percentage: number, dedupeKey: string): boolean {
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  const digest = createHash("sha256").update(`${connectorId}:${spec.key}:${dedupeKey}`).digest();
  return digest.readUInt32BE(0) % 100 < percentage;
}

export function resourcesWithinScope(resources: ResourceRef[], allowed: ResourceRef[]): boolean {
  const scope = new Set(allowed.map((item) => `${item.type}:${item.id}`));
  return resources.every((item) => scope.has(`${item.type}:${item.id}`));
}

export function scenarioByKey(key: string): ScenarioSpec | undefined {
  return currentScenarios().find((scenario) => scenario.key === key);
}
