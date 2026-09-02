import { createHash } from "node:crypto";

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

function findingPrompt(input: {
  key: string;
  objective: string;
  evidenceRule: string;
  severity: string;
  details: Record<string, unknown>;
  actions: Array<Record<string, string>>;
  presentation: ScenarioSpec["presentation"];
}): string {
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

const commonAgent = {
  agentMode: "external-operations",
  runtimeClass: "background-analysis",
  skills: ["omc-operations@1.2.0"],
  timeoutSeconds: 120,
  maxToolCalls: 18,
  maxOutputBytes: 65_536
};

export const BUILTIN_SCENARIOS: ScenarioSpec[] = [
  {
    key: "task-failure-analysis",
    name: "任务失败智能分析",
    description: "分析失败任务、设备状态、相关告警和近期历史。",
    version: 1,
    eventType: "omc.task.failed.v1",
    match: { all: [{ field: "data.taskType", op: "notIn", value: ["temporary_diagnostic"] }] },
    dedupe: { keyTemplate: "${resource.task.id}", cooldownSeconds: 1_800 },
    // This vertical slice is already visible in production. Preserve that user-facing
    // behavior while the other scenarios start in shadow/disabled.
    rollout: { mode: "active", percentage: 100 },
    agent: {
      ...commonAgent,
      allowedOperations: ["get.devices.by_id", "get.devices.tasks.by_task_id", "get.devices", "get.alarms.active"],
      prompt: findingPrompt({
        key: "task-failure-analysis",
        objective: "分析失败任务、相关设备和告警，给出证据化原因范围与下一步调查方向。",
        evidenceRule: "输出前必须调用 get.devices.tasks.by_task_id；事件包含 device 时再调用 get.devices.by_id。",
        severity: "high",
        details: { failureCategory: "分类", taskId: "从任务资源复制" },
        actions: [
          { type: "open-resource", label: "查看任务", resourceRole: "task" },
          { type: "continue-agent", label: "继续询问 Agent", promptKey: "task-failure-followup" },
          { type: "dismiss", label: "忽略" }
        ],
        presentation: { icon: "task-error", sections: ["summary", "facts", "hypotheses", "details", "resources", "suggestedActions"], surfaces: ["attention", "task-detail"] }
      })
    },
    delivery: { surfaces: ["attention", "task-detail"], expiresAfterSeconds: 604_800 },
    limits: { maxConcurrentRuns: 10, maxRunsPerHour: 200 },
    presentation: { icon: "task-error", sections: ["summary", "facts", "hypotheses", "details", "resources", "suggestedActions"], surfaces: ["attention", "task-detail"] }
  },
  {
    key: "access-review-assistant",
    name: "设备接入审核助手",
    description: "为接入候选提供证据化批准、拒绝或补证建议。",
    version: 1,
    eventType: "omc.device.access-review-required.v1",
    dedupe: { keyTemplate: "${resource.candidate.id}", cooldownSeconds: 3_600 },
    rollout: { mode: "shadow", percentage: 100 },
    agent: {
      ...commonAgent,
      allowedOperations: ["get.device_access.candidates", "get.devices.by_id", "get.devices", "get.topology.nodes"],
      prompt: findingPrompt({
        key: "access-review-assistant",
        objective: "审查设备接入候选的身份、归属、网络位置和现有资产证据，只给出批准、拒绝或补证建议。",
        evidenceRule: "输出前必须调用 get.device_access.candidates 读取当前候选详情；不得代替人工批准或拒绝。",
        severity: "medium",
        details: { candidateId: "从候选资源复制", recommendation: "request-evidence", riskFactors: [] },
        actions: [
          { type: "open-resource", label: "打开接入复核", resourceRole: "candidate" },
          { type: "continue-agent", label: "继续核查", promptKey: "access-review-followup" },
          { type: "dismiss", label: "忽略" }
        ],
        presentation: { icon: "access-review", sections: ["summary", "facts", "hypotheses", "details", "resources", "suggestedActions"], surfaces: ["attention", "access-review"] }
      })
    },
    delivery: { surfaces: ["attention", "access-review"], expiresAfterSeconds: 259_200 },
    limits: { maxConcurrentRuns: 5, maxRunsPerHour: 100 },
    presentation: { icon: "access-review", sections: ["summary", "facts", "hypotheses", "details", "resources", "suggestedActions"], surfaces: ["attention", "access-review"] }
  },
  {
    key: "severe-alarm-explanation",
    name: "严重告警解释",
    description: "解释单条或 xOMC 已聚合的严重告警，并给出影响与调查方向。",
    version: 1,
    eventType: "omc.alarm.severe-raised.v1",
    match: { all: [{ field: "data.severity", op: "in", value: ["critical", "major"] }] },
    dedupe: { keyTemplate: "${resource.alarm.id}", cooldownSeconds: 1_800 },
    rollout: { mode: "shadow", percentage: 100 },
    agent: {
      ...commonAgent,
      allowedOperations: ["get.alarms.active", "get.devices.by_id", "get.devices", "get.pm.counters.aggregated"],
      prompt: findingPrompt({
        key: "severe-alarm-explanation",
        objective: "解释严重告警的当前含义、影响范围、相关设备状态和需要验证的原因。",
        evidenceRule: "输出前必须读取当前活动告警；存在 device 资源时读取设备详情。维护窗口和历史因果只能使用工具证据确认。",
        severity: "high",
        details: { alarmId: "从告警资源复制", probableCause: "待验证原因", affectedService: "影响范围" },
        actions: [
          { type: "open-resource", label: "查看告警", resourceRole: "alarm" },
          { type: "continue-agent", label: "继续调查", promptKey: "severe-alarm-followup" },
          { type: "dismiss", label: "忽略" }
        ],
        presentation: { icon: "alarm", sections: ["summary", "facts", "hypotheses", "details", "resources", "suggestedActions"], surfaces: ["attention", "alarm-detail", "device-detail"] }
      })
    },
    delivery: { surfaces: ["attention", "alarm-detail", "device-detail"], expiresAfterSeconds: 259_200 },
    limits: { maxConcurrentRuns: 5, maxRunsPerHour: 200 },
    presentation: { icon: "alarm", sections: ["summary", "facts", "hypotheses", "details", "resources", "suggestedActions"], surfaces: ["attention", "alarm-detail", "device-detail"] }
  },
  {
    key: "daily-operations-summary",
    name: "每日运维摘要",
    description: "提炼需关注的告警、失败任务、接入待办和性能变化。",
    version: 1,
    eventType: "omc.daily-operations-summary-requested.v1",
    dedupe: { keyTemplate: "${data.summaryDate}:${resource.ne_group.id}", cooldownSeconds: 82_800 },
    rollout: { mode: "disabled", percentage: 0 },
    agent: {
      ...commonAgent,
      allowedOperations: ["get.alarms.active", "get.devices", "get.device_access.candidates", "get.pm.counters.aggregated"],
      prompt: findingPrompt({
        key: "daily-operations-summary",
        objective: "生成固定统计窗口内的每日运维摘要，优先突出需要人工行动的告警、失败任务、接入待办和性能异常。",
        evidenceRule: "所有数量和趋势必须来自工具返回的同一冻结窗口；数据不完整时标记 completeness，不得用当前快照补写历史。",
        severity: "info",
        details: { summaryDate: "YYYY-MM-DD", highlights: [], completeness: "complete" },
        actions: [
          { type: "continue-agent", label: "继续查看重点", promptKey: "daily-summary-followup" },
          { type: "copy-summary", label: "复制摘要" },
          { type: "dismiss", label: "标记已读" }
        ],
        presentation: { icon: "daily-summary", sections: ["summary", "facts", "hypotheses", "details", "suggestedActions"], surfaces: ["dashboard", "message-center"] }
      })
    },
    delivery: { surfaces: ["dashboard", "message-center"], expiresAfterSeconds: 172_800 },
    limits: { maxConcurrentRuns: 2, maxRunsPerHour: 24 },
    presentation: { icon: "daily-summary", sections: ["summary", "facts", "hypotheses", "details", "suggestedActions"], surfaces: ["dashboard", "message-center"] }
  }
];

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
  return BUILTIN_SCENARIOS.find((scenario) => scenario.key === key);
}
