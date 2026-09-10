import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DurableActionConnectorToolBridge } from "../proactive/durable-tool-bridge.js";
import { executeAssistant } from "./engine.js";
import { executionRequestSchema, planningResponseSchema, validatePlan } from "./contracts.js";
import { definition, planningInput } from "./fixtures.js";

function bridgeFixture(explore = true) {
  const runId = randomUUID();
  const create = vi.fn(async (_input: unknown) => ({}));
  const db = {
    proactiveAgentRun: { findUnique: vi.fn(async () => ({ status: "RUNNING", runAttempt: 1 })), updateMany: vi.fn(async () => ({})) },
    connectorToolInvocation: { create, findUnique: vi.fn(async () => ({ status: "SUCCEEDED", result: { output: { ok: true } } })) },
  };
  const bridge = new DurableActionConnectorToolBridge(db as never);
  bridge.prepareBackgroundRun({ connectorId: "c", runId, scenarioKey: "assistant:a", packageDigest: "p", handbookDigest: "h", resourceScope: [], traceId: "t", allowedOperations: ["get.devices"], timeoutSeconds: 30,
    ...(explore ? { allowDiscovery: true, operationGrants: [{ operationId: "get.pm.metrics", method: "GET" }, { operationId: "patch.products.by_id", method: "PATCH" }] } : {}) });
  const { bridgeToken } = bridge.registerRun({ connectorId: "c", runId, delegationHeaderValue: "x", emit: () => undefined });
  return { bridge, create, request: (operationId: string, method: string, path: string, body?: unknown) => bridge.request({ connectorId: "c", runId, bridgeToken, request: { operationId, method, path, body } }) };
}

describe("assistant API exploration", () => {
  it("discovers APIs outside planning hints and forwards configured writes without rewriting method/body", async () => {
    const f = bridgeFixture();
    await f.request("get.agent.catalog", "GET", "/api/v1/agent/catalog");
    await f.request("get.pm.metrics", "GET", "/api/v1/pm/metrics");
    await f.request("patch.products.by_id", "PATCH", "/api/v1/products/a", { label: "new" });
    expect(f.create.mock.calls.at(-1)?.[0]).toMatchObject({ data: { method: "PATCH", arguments: { body: { label: "new" } } } });
  });
  it("rejects method spoofing, ungranted operations and discovery writes before creating an invocation", async () => {
    const f = bridgeFixture();
    await expect(f.request("get.pm.metrics", "DELETE", "/api/v1/pm/metrics")).rejects.toThrow("policy");
    await expect(f.request("get.new_api", "GET", "/api/v1/new-api")).rejects.toThrow("policy");
    await expect(f.request("get.agent.catalog", "POST", "/api/v1/agent/catalog")).rejects.toThrow("policy");
    expect(f.create).not.toHaveBeenCalled();
  });
  it("does not widen legacy background registrations", async () => {
    const f = bridgeFixture(false);
    await expect(f.request("get.pm.metrics", "GET", "/api/v1/pm/metrics")).rejects.toThrow("policy");
    await expect(f.request("get.agent.catalog", "GET", "/api/v1/agent/catalog")).rejects.toThrow("policy");
    await expect(f.request("get.devices", "POST", "/api/v1/devices")).rejects.toThrow("policy");
    await f.request("get.devices", "GET", "/api/v1/devices");
  });
  it("allows fixed assistants to inspect contracts while retaining their business allowlist", async () => {
    const request = executionRequestSchema.parse({ contractVersion: "1.0", runId: randomUUID(), assistantId: randomUUID(), revision: 1, definition, definitionDigest: `sha256:${"1".repeat(64)}`, handbookDigest: "test", apiHandbook: {}, externalUserId: "u" });
    const bridge = { prepareBackgroundRun: vi.fn() };
    const result = { outcome: "insufficient_data", title: "No data", summary: "No business query", facts: [], hypotheses: [], nextSteps: [] };
    const runtime = { streamChat: async (input: {emit: (e: unknown) => void}) => input.emit({type:"delta", text:JSON.stringify(result)}) };
    await executeAssistant({ db: { connectorToolInvocation: { findMany: async () => [] } }, runtime, bridge, run: { runAttempt: 1 }, request, signal: new AbortController().signal } as never);
    expect(bridge.prepareBackgroundRun).toHaveBeenCalledWith(expect.objectContaining({ allowDiscovery: true, allowedOperations: definition.operations, operationGrants: undefined }));
  });
  it("permits deferred API discovery without inventing operation IDs", () => {
    const output = planningResponseSchema.parse({ reply: "Trial will inspect contracts", readiness: "ready", questions: [], missingCapabilities: [], definition: { ...definition, apiAccess: "discover", operations: [] } });
    expect(() => validatePlan(planningInput, output)).not.toThrow();
  });
  it("does not allow a planning hint to exceed task methods", () => {
    const input = { ...planningInput, capabilities: [{ operationId: "patch.products.by_id", method: "PATCH" as const, path: "/api/v1/products/:id", title: "Products", description: "Update", deviceScoped: false }] };
    const output = planningResponseSchema.parse({ reply: "Ready", readiness: "ready", questions: [], missingCapabilities: [], definition: { ...definition, apiAccess: "discover", operations: ["patch.products.by_id"] } });
    expect(() => validatePlan(input, output)).toThrow("METHOD_NOT_ALLOWED");
    output.definition!.allowedMethods = ["GET", "PATCH"];
    expect(() => validatePlan(input, output)).not.toThrow();
  });
  it("fails closed on missing new-protocol grants and stops blind write recovery", async () => {
    const request = executionRequestSchema.parse({ contractVersion: "1.1", runId: randomUUID(), assistantId: randomUUID(), revision: 1, definition: { ...definition, apiAccess: "discover" }, definitionDigest: `sha256:${"1".repeat(64)}`, handbookDigest: "test", apiHandbook: {}, externalUserId: "u" });
    const runtime = { streamChat: vi.fn() }; const bridge = { prepareBackgroundRun: vi.fn() };
    const args = { db: { connectorToolInvocation: { findFirst: vi.fn(async () => ({ id: "previous-write" })) } }, runtime, bridge, run: { runAttempt: 2 }, request, signal: new AbortController().signal };
    await expect(executeAssistant(args as never)).rejects.toThrow("RUN_GRANT_REQUIRED");
    request.toolGrants = [{ operationId: "get.devices", method: "GET" }];
    request.toolPolicy = { allowedMethods: ["GET"], blockedPathPrefixes: [], toolTimeoutSeconds: 30, maxResponseBytes: 262144 };
    await expect(executeAssistant(args as never)).rejects.toThrow("WRITE_RECOVERY_REVIEW_REQUIRED");
    expect(runtime.streamChat).not.toHaveBeenCalled(); expect(bridge.prepareBackgroundRun).not.toHaveBeenCalled();
  });
  it("does not treat catalog lookup as business evidence", async () => {
    const request = executionRequestSchema.parse({ contractVersion: "1.1", runId: randomUUID(), assistantId: randomUUID(), revision: 1, definition: { ...definition, apiAccess: "discover" }, definitionDigest: `sha256:${"1".repeat(64)}`, handbookDigest: "test", apiHandbook: {}, externalUserId: "u", toolGrants: [{ operationId: "get.devices", method: "GET" }], toolPolicy: { allowedMethods: ["GET"], blockedPathPrefixes: [], toolTimeoutSeconds: 30, maxResponseBytes: 262144 } });
    const args = { db: { connectorToolInvocation: { findMany: async () => [{ operationId: "get.agent.catalog" }] } }, runtime: { streamChat: async (input: { emit: (e: unknown) => void }) => input.emit({ type: "delta", text: JSON.stringify({ outcome: "no_change", title: "Normal", summary: "Normal", facts: [], hypotheses: [], nextSteps: [] }) }) }, bridge: { prepareBackgroundRun: () => undefined }, run: { runAttempt: 1 }, request, signal: new AbortController().signal };
    await expect(executeAssistant(args as never)).rejects.toThrow("NO_BUSINESS_EVIDENCE");
  });
});
