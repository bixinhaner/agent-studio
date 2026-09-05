import { z } from "zod";

// Business vocabulary and available operations come from the connector, never
// from a scenario-name switch in Agent Studio.
export const capabilitySchema = z.object({
  operationId: z.string().min(1).max(160),
  title: z.string().max(240),
  description: z.string().max(4000),
  path: z.string().startsWith("/api/v1/"),
  deviceScoped: z.boolean().default(false),
});
export const conditionSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(["eq", "ne", "in", "gte", "lte"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()).max(20)]),
});
export const triggerSchema = z.object({
  kind: z.enum(["manual", "interval", "schedule", "event"]),
  intervalMinutes: z.number().int().min(5).max(10080).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().max(100).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  eventType: z.string().max(160).optional(),
  conditions: z.array(conditionSchema).max(10).default([]),
});
export const definitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  goal: z.string().trim().min(1).max(8000),
  scope: z.object({
    kind: z.enum(["visible", "device"]),
    deviceId: z.string().uuid().optional(),
    label: z.string().max(240).optional(),
  }),
  trigger: triggerSchema,
  operations: z.array(z.string().min(1).max(160)).min(1).max(24),
  notify: z.enum(["always", "findings"]),
  cooldownMinutes: z.number().int().min(0).max(10080),
});
export const planningRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  definition: definitionSchema.nullable().optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).max(20).default([]),
  capabilities: z.array(capabilitySchema).max(300),
  events: z.array(z.object({ type: z.string(), title: z.string(), fields: z.array(z.string()) })).max(30).default([]),
  locale: z.string().max(30).default("en-US"),
  timezone: z.string().max(100).default("UTC"),
  externalUserId: z.string().min(1).max(160),
});
export const planningResponseSchema = z.object({
  reply: z.string().min(1).max(8000),
  readiness: z.enum(["ready", "needs_input", "unsupported"]),
  questions: z.array(z.string().min(1).max(500)).max(3),
  missingCapabilities: z.array(z.string().max(500)).max(10),
  definition: definitionSchema.nullable(),
});
export const executionRequestSchema = z.object({
  contractVersion: z.literal("1.0"),
  runId: z.string().uuid(),
  assistantId: z.string().uuid(),
  revision: z.number().int().positive(),
  definition: definitionSchema,
  definitionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  handbookDigest: z.string().min(1).max(200),
  apiHandbook: z.record(z.unknown()),
  locale: z.string().max(30).default("en-US"),
  timezone: z.string().max(100).default("UTC"),
  externalUserId: z.string().min(1).max(160),
  triggerContext: z.record(z.unknown()).default({}),
  limits: z.object({
    timeoutSeconds: z.number().int().min(10).max(300).default(120),
    maxToolCalls: z.number().int().min(1).max(40).default(18),
    maxOutputBytes: z.number().int().min(1024).max(65536).default(32768),
  }).default({}),
});
export const resultSchema = z.object({
  outcome: z.enum(["finding", "no_change", "insufficient_data"]),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(8000),
  facts: z.array(z.object({ text: z.string().max(2000), evidenceRefs: z.array(z.string().max(180)).min(1).max(20) })).max(30),
  hypotheses: z.array(z.string().max(2000)).max(20),
  nextSteps: z.array(z.string().max(1000)).max(15),
});
export type AssistantDefinition = z.infer<typeof definitionSchema>;
export type PlanningRequest = z.infer<typeof planningRequestSchema>;
export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export type AssistantResult = z.infer<typeof resultSchema>;

export function parseModelJSON(text: string): unknown {
  // A JSON fence is harmless presentation, but no prose or multiple objects is
  // accepted. Never eval, execute, or silently repair a model-generated plan.
  const raw = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) throw new Error("ASSISTANT_INVALID_MODEL_OUTPUT");
  return JSON.parse(raw);
}

export function validatePlan(input: PlanningRequest, output: z.infer<typeof planningResponseSchema>): void {
  if (output.readiness !== "ready") return;
  if (!output.definition || output.questions.length || output.missingCapabilities.length) throw new Error("ASSISTANT_PLAN_NOT_READY");
  const plan = output.definition;
  const catalog = new Map(input.capabilities.map((item) => [item.operationId, item]));
  if (plan.operations.some((id) => !catalog.has(id))) throw new Error("ASSISTANT_UNKNOWN_CAPABILITY");
  if (plan.scope.kind === "device" && (!plan.scope.deviceId || plan.operations.some((id) => !catalog.get(id)?.deviceScoped))) {
    throw new Error("ASSISTANT_SCOPE_NOT_RESOLVED");
  }
  const trigger = plan.trigger;
  if (trigger.kind === "interval" && !trigger.intervalMinutes) throw new Error("ASSISTANT_INVALID_SCHEDULE");
  if (trigger.kind === "schedule") {
    if (!trigger.time || !trigger.timezone || !trigger.weekdays?.length) throw new Error("ASSISTANT_INVALID_SCHEDULE");
    new Intl.DateTimeFormat("en", { timeZone: trigger.timezone }).format();
  }
  if (trigger.kind === "event") {
    const event = input.events.find((item) => item.type === trigger.eventType);
    if (!event || trigger.conditions.some((item) => !event.fields.includes(item.field))) throw new Error("ASSISTANT_UNKNOWN_EVENT");
  }
}
