import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionConnectorRuntimeService } from "../runtime.js";
import { ProactiveActionConnectorService } from "./service.js";
import { BUILTIN_SCENARIOS } from "./scenario-catalog.js";
import { XOMC_PACKAGE } from "./contracts.js";

afterEach(() => vi.restoreAllMocks());

describe("system report language", () => {
  it.each([
    ["en-US", "en-US", "English"],
    ["zh-CN", "zh-CN", "Simplified Chinese"],
    [undefined, "zh-CN", "Simplified Chinese"],
  ])("uses event policy %s in the actual execution and saved finding", async (requested, locale, language) => {
    const spec = BUILTIN_SCENARIOS[0]!;
    const resources = [{ type: "task", id: "task-1", role: "task" }];
    const finding = {
      schemaVersion: "1.0", scenarioKey: spec.key, scenarioVersion: spec.version,
      title: "Task review", summary: "Check the device connection.", severity: "high", confidence: 0.8,
      facts: [], hypotheses: [], resourceRefs: resources, details: {}, suggestedActions: [], presentation: {},
    };
    const input = {
      contractVersion: "1.0", eventId: "event-1", eventType: spec.eventType, source: "xomc",
      occurredAt: "2026-09-18T00:00:00.000Z", traceId: "trace-1", integrationPack: XOMC_PACKAGE,
      handbookDigest: "sha256:handbook", resources, data: { reportLocale: requested },
    };
    const run = { id: "run-1", connectorId: "connector-1", scenarioKey: spec.key, scenarioSnapshot: spec,
      runAttempt: 1, input, resourceScope: resources, rolloutMode: "active" };
    const db = {
      proactiveAgentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      proactiveAgentFinding: { create: vi.fn().mockResolvedValue({ id: "finding-1" }) },
      proactiveFindingDelivery: { create: vi.fn().mockResolvedValue({}) },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    };
    const stream = vi.spyOn(ActionConnectorRuntimeService.prototype, "streamChat").mockImplementation(async ({ emit }) => {
      emit({ type: "delta", text: JSON.stringify(finding) });
    });
    const bridge = { prepareBackgroundRun: vi.fn(), disposeRun: vi.fn() };
    const service = new ProactiveActionConnectorService(db as never, bridge as never, {} as never);
    await (service as unknown as { execute(id: string, signal: AbortController): Promise<void> }).execute(run.id, new AbortController());
    expect(stream).toHaveBeenCalledOnce();
    expect(stream.mock.calls[0]![0].request.locale).toBe(locale);
    expect(stream.mock.calls[0]![0].request.message).toContain(`report field in ${language}`);
    expect(db.proactiveAgentFinding.create).toHaveBeenCalledWith({ data: expect.objectContaining({ presentation: { locale } }) });
    expect(db.proactiveFindingDelivery.create).toHaveBeenCalledOnce();
    expect(bridge.disposeRun).toHaveBeenCalledOnce();
  });
});
