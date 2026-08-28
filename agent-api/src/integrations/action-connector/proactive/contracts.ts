import { z } from "zod";

export const resourceRefSchema = z.object({
  type: z.string().trim().min(1),
  id: z.string().trim().min(1),
  role: z.string().trim().min(1),
  label: z.string().optional()
});

export const connectorEventSchema = z.object({
  contractVersion: z.literal("1.0"),
  eventId: z.string().trim().min(1),
  eventType: z.string().trim().min(1),
  source: z.string().trim().min(1),
  occurredAt: z.string().datetime(),
  traceId: z.string().trim().min(1),
  integrationPack: z.object({
    key: z.string().trim().min(1), version: z.string().trim().min(1), digest: z.string().trim().min(1)
  }),
  handbookDigest: z.string().trim().min(1),
  tenantRef: z.string().optional(),
  resources: z.array(resourceRefSchema).min(1),
  data: z.record(z.string(), z.unknown())
});

export type ConnectorEventEnvelope = z.infer<typeof connectorEventSchema>;
export type ResourceRef = z.infer<typeof resourceRefSchema>;

export const findingSchema = z.object({
  schemaVersion: z.literal("1.0"),
  scenarioKey: z.string().trim().min(1),
  scenarioVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(4000),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  facts: z.array(z.object({
    id: z.string().min(1), text: z.string().min(1), evidenceRefs: z.array(z.string().min(1)).min(1)
  })),
  hypotheses: z.array(z.object({
    id: z.string().min(1), text: z.string().min(1), confidence: z.number().min(0).max(1),
    evidenceRefs: z.array(z.string().min(1)).min(1)
  })),
  resourceRefs: z.array(resourceRefSchema).min(1),
  details: z.record(z.string(), z.unknown()),
  suggestedActions: z.array(z.object({
    type: z.enum(["open-finding", "open-resource", "continue-agent", "dismiss", "copy-summary"]),
    label: z.string().min(1), resourceRole: z.string().optional(), promptKey: z.string().optional()
  })),
  presentation: z.record(z.string(), z.unknown()),
  expiresAt: z.string().datetime().optional()
});

export type AgentFindingPayload = z.infer<typeof findingSchema>;

export const XOMC_PACKAGE = {
  key: "com.baicells.xomc",
  version: "1.0.0",
  digest: "sha256:094a1ea9b43f83b92416c9c14933b54593d4cae9893495ae294c228d5bb43b06"
} as const;

export const TASK_FAILURE_SCENARIO = {
  key: "task-failure-analysis",
  eventType: "omc.task.failed.v1",
  allowedOperations: new Set(["get.devices.by_id", "get.devices.tasks.by_task_id"]),
  timeoutSeconds: 120,
  prompt: [
    "你是 xOMC 只读主动分析 Agent。分析本次任务失败，只能使用提供的 GET 操作读取事件资源范围内的数据。",
    "必须把工具证据支持的内容放入 facts；未证实判断放入 hypotheses，并给出独立 confidence。",
    "不得建议或执行自动修复、重试、配置变更。suggestedActions 只能使用 open-resource、continue-agent、dismiss、copy-summary。",
    "最终响应只能是符合 AgentFinding v1 的单个 JSON 对象，不要 Markdown 代码围栏或额外文字。"
  ].join("\n")
} as const;
