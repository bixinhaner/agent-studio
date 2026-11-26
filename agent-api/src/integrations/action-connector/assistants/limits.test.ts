import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DurableActionConnectorToolBridge } from "../proactive/durable-tool-bridge.js";
import { executeAssistant } from "./engine.js";
import { assistantRunBudget, DEFAULT_ASSISTANT_TIMEOUT_SECONDS, executionRequestSchema } from "./contracts.js";
import { connectorDb, definition } from "./fixtures.js";

const base = () => ({ contractVersion: "1.0", runId: randomUUID(), assistantId: randomUUID(), revision: 1, definition, definitionDigest: `sha256:${"1".repeat(64)}`, handbookDigest: "test", apiHandbook: {}, externalUserId: "u" });

describe("assistant run limits are owned by Agent Studio", () => {
  it("applies the Agent Studio default and no tool-call cap when the source sends none", () => {
    for (const limits of [undefined, {}, { timeoutSeconds: 0, maxToolCalls: 0 }, { timeoutSeconds: null, maxToolCalls: null }]) {
      const request = executionRequestSchema.parse({ ...base(), ...(limits === undefined ? {} : { limits }) });
      expect(assistantRunBudget(request.limits)).toEqual({ timeoutSeconds: DEFAULT_ASSISTANT_TIMEOUT_SECONDS });
      expect(request.limits.maxOutputBytes).toBe(32768);
    }
  });

  it("still honours a source deadline and tool-call cap, including values above the old 300s/40 ceiling", () => {
    expect(assistantRunBudget(executionRequestSchema.parse({ ...base(), limits: { timeoutSeconds: 120, maxToolCalls: 20 } }).limits)).toEqual({ timeoutSeconds: 120, maxToolCalls: 20 });
    expect(assistantRunBudget(executionRequestSchema.parse({ ...base(), limits: { timeoutSeconds: 1800, maxToolCalls: 200 } }).limits)).toEqual({ timeoutSeconds: 1800, maxToolCalls: 200 });
    expect(() => executionRequestSchema.parse({ ...base(), limits: { timeoutSeconds: 5 } })).toThrow();
    expect(() => executionRequestSchema.parse({ ...base(), limits: { timeoutSeconds: 7200 } })).toThrow();
  });

  it("keeps an unchanged request identical so replayed submissions keep their fingerprint", () => {
    const raw = { ...base(), limits: { timeoutSeconds: 120, maxToolCalls: 20 } };
    expect(executionRequestSchema.parse(raw).limits).toEqual({ timeoutSeconds: 120, maxToolCalls: 20, maxOutputBytes: 32768 });
  });

  it.each([
    { limits: {}, timeout: DEFAULT_ASSISTANT_TIMEOUT_SECONDS, calls: Number.POSITIVE_INFINITY, prompt: `${DEFAULT_ASSISTANT_TIMEOUT_SECONDS} seconds.` },
    { limits: { timeoutSeconds: 120, maxToolCalls: 20 }, timeout: 120, calls: 20, prompt: "120 seconds and 20 tool calls." },
  ])("passes the effective budget to the tool bridge and the model: $limits", async ({ limits, timeout, calls, prompt }) => {
    const request = executionRequestSchema.parse({ ...base(), limits });
    const prepareBackgroundRun = vi.fn();
    let message = "";
    const result = { outcome: "no_change", title: "OK", summary: "Checked", facts: [{ text: "Devices checked", evidenceRefs: ["tool:get.devices"] }], hypotheses: [], nextSteps: [] };
    await executeAssistant({
      db: { ...connectorDb(), connectorToolInvocation: { findMany: async () => [{ operationId: "get.devices" }] } },
      runtime: { streamChat: async (input: { request: { message: string }; emit: (e: unknown) => void }) => { message = input.request.message; input.emit({ type: "delta", text: JSON.stringify(result) }); } },
      bridge: { prepareBackgroundRun, extendBackgroundRunDeadline: () => undefined },
      run: { id: request.runId, runAttempt: 1, connectorId: "c" }, request, signal: new AbortController().signal,
    } as never);
    expect(prepareBackgroundRun).toHaveBeenCalledWith(expect.objectContaining({ timeoutSeconds: timeout, maxToolCalls: calls }));
    expect(message).toContain(`Total execution budget, including discovery: ${prompt}`);
  });

  it("does not stop an uncapped run at the old 18-call bridge default", async () => {
    const runId = randomUUID();
    const db = {
      proactiveAgentRun: { findUnique: vi.fn(async () => ({ status: "RUNNING", runAttempt: 1 })), updateMany: vi.fn(async () => ({})) },
      connectorToolInvocation: { create: vi.fn(async () => ({})), findUnique: vi.fn(async () => ({ status: "SUCCEEDED", result: { output: { ok: true } } })) },
    };
    const bridge = new DurableActionConnectorToolBridge(db as never);
    bridge.prepareBackgroundRun({ connectorId: "c", runId, scenarioKey: "assistant:a", packageDigest: "p", handbookDigest: "h", resourceScope: [], traceId: "t", allowedOperations: ["get.devices"], timeoutSeconds: 60, maxToolCalls: Number.POSITIVE_INFINITY });
    const { bridgeToken } = bridge.registerRun({ connectorId: "c", runId, delegationHeaderValue: "x", emit: () => undefined });
    for (let i = 0; i < 25; i += 1) {
      await expect(bridge.request({ connectorId: "c", runId, bridgeToken, request: { operationId: "get.devices", method: "GET", path: "/api/v1/devices" } })).resolves.toMatchObject({ status: "ok" });
    }
  });
});
