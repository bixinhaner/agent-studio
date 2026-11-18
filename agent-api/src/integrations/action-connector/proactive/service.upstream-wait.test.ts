import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionConnectorRuntimeService } from "../runtime.js";
import { ProactiveActionConnectorService } from "./service.js";
import { BUILTIN_SCENARIOS } from "./scenario-catalog.js";
import { XOMC_PACKAGE } from "./contracts.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  const spec = { ...BUILTIN_SCENARIOS[0]!, agent: { ...BUILTIN_SCENARIOS[0]!.agent, timeoutSeconds: 300 } };
  const resources = [{ type: "task", id: "task-1", role: "task" }];
  const finding = {
    schemaVersion: "1.0", scenarioKey: spec.key, scenarioVersion: spec.version,
    title: "Task review", summary: "Check the device connection.", severity: "high", confidence: 0.8,
    facts: [], hypotheses: [], resourceRefs: resources, details: {}, suggestedActions: [], presentation: {},
  };
  const input = {
    contractVersion: "1.0", eventId: "event-1", eventType: spec.eventType, source: "xomc",
    occurredAt: "2026-11-18T00:00:00.000Z", traceId: "trace-1", integrationPack: XOMC_PACKAGE,
    handbookDigest: "sha256:handbook", resources, data: {},
  };
  const run = { id: "run-1", connectorId: "connector-1", scenarioKey: spec.key, scenarioSnapshot: spec,
    runAttempt: 1, input, resourceScope: resources, rolloutMode: "active" };
  const db = {
    proactiveAgentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    proactiveAgentFinding: { create: vi.fn().mockResolvedValue({ id: "finding-1" }) },
    proactiveFindingDelivery: { create: vi.fn().mockResolvedValue({}) },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
  };
  const bridge = { prepareBackgroundRun: vi.fn(), disposeRun: vi.fn(), extendBackgroundRunDeadline: vi.fn() };
  const service = new ProactiveActionConnectorService(db as never, bridge as never, {} as never);
  const execute = () => (service as unknown as { execute(id: string, c: AbortController): Promise<void> }).execute(run.id, new AbortController());
  return { finding, db, bridge, execute };
}

describe("proactive run waiting on upstream model retries", () => {
  it("does not time out at the 300s budget while Codex waits out a capacity rejection", async () => {
    vi.useFakeTimers();
    const { finding, db, bridge, execute } = setup();
    vi.spyOn(ActionConnectorRuntimeService.prototype, "streamChat").mockImplementation(async ({ emit, signal, onUpstreamWait }) => {
      // Codex announces a retry, then waits ~5.5 minutes before the model answers.
      onUpstreamWait?.({ at: new Date().toISOString(), attempt: 1, maxAttempts: 5, kind: "serverOverloaded", message: "Reconnecting... 1/5" });
      await vi.advanceTimersByTimeAsync(330_000);
      signal?.throwIfAborted();
      emit({ type: "delta", text: JSON.stringify(finding) });
    });
    await execute();
    expect(bridge.extendBackgroundRunDeadline).toHaveBeenCalledWith("connector-1", "run-1", expect.any(Number));
    expect(db.proactiveFindingDelivery.create).toHaveBeenCalledOnce();
    expect(db.proactiveAgentRun.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("still times out at the budget when there is no upstream wait", async () => {
    vi.useFakeTimers();
    const { finding, db, execute } = setup();
    vi.spyOn(ActionConnectorRuntimeService.prototype, "streamChat").mockImplementation(async ({ emit, signal }) => {
      await vi.advanceTimersByTimeAsync(330_000);
      signal?.throwIfAborted();
      emit({ type: "delta", text: JSON.stringify(finding) });
    });
    await execute();
    expect(db.proactiveAgentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(db.proactiveFindingDelivery.create).not.toHaveBeenCalled();
  });
});
