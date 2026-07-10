import { describe, expect, it } from "vitest";

import { UsageIngestionService } from "./usage-ingestion-service.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";
import type { CreateUsageEventInput } from "../persistence/usage-event-repository.js";

const profile: CostProfileRecord = {
  id: "profile-gpt-54",
  model: "gpt-5.4",
  inputTokenPrice: "2.500000",
  cachedInputTokenPrice: "0.250000",
  cacheWriteTokenPrice: "0.000000",
  outputTokenPrice: "15.000000",
  internalCostMultiplier: "1.2000",
  isActive: true,
  createdAt: "2026-04-15T00:00:00.000Z",
  updatedAt: "2026-04-15T00:00:00.000Z"
};

describe("UsageIngestionService", () => {
  it("calculates costs from prices configured per 1M tokens", async () => {
    let createdInput: (CreateUsageEventInput & { estimatedCost: string; internalCost: string }) | undefined;
    const service = new UsageIngestionService({
      costProfiles: {
        async getActiveByModel() {
          return profile;
        }
      },
      usageEvents: {
        async list() {
          return [];
        },
        async create(input) {
          createdInput = input as CreateUsageEventInput & { estimatedCost: string; internalCost: string };
          return {
            id: "usage-1",
            organizationId: input.organizationId,
            userId: input.userId,
            departmentIdSnapshot: input.departmentIdSnapshot,
            threadId: input.threadId,
            sessionId: input.sessionId,
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-04-15T00:00:00.000Z"
          };
        }
      }
    });

    await service.record({
      organizationId: "org-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000
    });

    expect(createdInput?.estimatedCost).toBe("15.250000");
    expect(createdInput?.internalCost).toBe("18.300000");
    expect(createdInput?.metadata).toMatchObject({
      _costProfile: {
        matched: true,
        profileId: "profile-gpt-54",
        model: "gpt-5.4",
        inputTokenPrice: "2.500000",
        cachedInputTokenPrice: "0.250000",
        outputTokenPrice: "15.000000",
        internalCostMultiplier: "1.2000"
      }
    });
  });

  it("prices GPT-5.6 cache writes separately when runtime telemetry provides them", async () => {
    const gpt56Profile: CostProfileRecord = {
      ...profile,
      id: "profile-gpt-56-terra",
      model: "gpt-5.6-terra",
      cacheWriteTokenPrice: "3.125000"
    };
    let createdInput: (CreateUsageEventInput & { estimatedCost: string; internalCost: string }) | undefined;
    const service = new UsageIngestionService({
      costProfiles: { async getActiveByModel() { return gpt56Profile; } },
      usageEvents: {
        async list() { return []; },
        async create(input) {
          createdInput = input as CreateUsageEventInput & { estimatedCost: string; internalCost: string };
          return {
            id: "usage-cache-write",
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            cacheWriteTokens: input.cacheWriteTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-07-10T00:00:00.000Z"
          };
        }
      }
    });

    await service.record({
      model: "gpt-5.6-terra",
      featureType: "chat",
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      cacheWriteTokens: 100_000,
      outputTokens: 100_000
    });

    expect(createdInput?.estimatedCost).toBe("3.612500");
    expect(createdInput?.cacheWriteTokens).toBe(100_000);
    expect(createdInput?.metadata).toMatchObject({
      _costProfile: { costCompleteness: "complete" }
    });
  });

  it("marks GPT-5.6 cost as partial when app-server omits cache-write telemetry", async () => {
    const gpt56Profile: CostProfileRecord = {
      ...profile,
      id: "profile-gpt-56-sol",
      model: "gpt-5.6-sol",
      cacheWriteTokenPrice: "6.250000"
    };
    let metadata: unknown;
    const service = new UsageIngestionService({
      costProfiles: { async getActiveByModel() { return gpt56Profile; } },
      usageEvents: {
        async list() { return []; },
        async create(input) {
          metadata = input.metadata;
          return {
            id: "usage-partial",
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-07-10T00:00:00.000Z"
          };
        }
      }
    });

    await service.record({
      model: "gpt-5.6-sol",
      featureType: "chat",
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 100
    });

    expect(metadata).toMatchObject({
      _costProfile: { costCompleteness: "partial_missing_cache_write_tokens" }
    });
  });

  it("applies configured long-context multipliers in the shared pricing path", async () => {
    const longContextProfile = {
      ...profile,
      id: "profile-gpt-56-terra-long-context",
      model: "gpt-5.6-terra",
      longContextThresholdTokens: 272_000,
      longContextInputMultiplier: "2.0000",
      longContextOutputMultiplier: "1.5000"
    } as CostProfileRecord;
    let createdInput: (CreateUsageEventInput & { estimatedCost: string; metadata?: unknown }) | undefined;
    const service = new UsageIngestionService({
      costProfiles: { async getActiveByModel() { return longContextProfile; } },
      usageEvents: {
        async list() { return []; },
        async create(input) {
          createdInput = input as CreateUsageEventInput & { estimatedCost: string; metadata?: unknown };
          return {
            id: "usage-long-context",
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-07-10T00:00:00.000Z"
          };
        }
      }
    });

    await service.record({
      model: "gpt-5.6-terra",
      featureType: "chat",
      inputTokens: 300_000,
      outputTokens: 100_000
    });

    expect(createdInput?.estimatedCost).toBe("3.750000");
    expect(createdInput?.metadata).toMatchObject({
      _costProfile: { longContextApplied: true }
    });
  });

  it("bounds cached input tokens before storing and billing", async () => {
    let createdInput: (CreateUsageEventInput & { estimatedCost: string; internalCost: string }) | undefined;
    const service = new UsageIngestionService({
      costProfiles: {
        async getActiveByModel() {
          return profile;
        }
      },
      usageEvents: {
        async list() {
          return [];
        },
        async create(input) {
          createdInput = input as CreateUsageEventInput & { estimatedCost: string; internalCost: string };
          return {
            id: "usage-1",
            organizationId: input.organizationId,
            userId: input.userId,
            departmentIdSnapshot: input.departmentIdSnapshot,
            threadId: input.threadId,
            sessionId: input.sessionId,
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-04-15T00:00:00.000Z"
          };
        }
      }
    });

    await service.record({
      organizationId: "org-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1000,
      cachedInputTokens: 2000,
      outputTokens: 100
    });

    expect(createdInput?.inputTokens).toBe(1000);
    expect(createdInput?.cachedInputTokens).toBe(1000);
    expect(createdInput?.outputTokens).toBe(100);
    expect(createdInput?.estimatedCost).toBe("0.001750");
  });

  it("records Codex runtime cumulative snapshots as per-turn deltas", async () => {
    const createdInputs: Array<CreateUsageEventInput & { estimatedCost: string; internalCost: string }> = [];
    const service = new UsageIngestionService({
      costProfiles: {
        async getActiveByModel() {
          return profile;
        }
      },
      usageEvents: {
        async list() {
          return createdInputs
            .map((input, index) => ({
              id: `usage-${index + 1}`,
              organizationId: input.organizationId,
              userId: input.userId,
              departmentIdSnapshot: input.departmentIdSnapshot,
              threadId: input.threadId,
              sessionId: input.sessionId,
              model: input.model,
              featureType: input.featureType,
              inputTokens: input.inputTokens ?? 0,
              cachedInputTokens: input.cachedInputTokens ?? 0,
              outputTokens: input.outputTokens ?? 0,
              estimatedCost: input.estimatedCost,
              internalCost: input.internalCost,
              resultStatus: input.resultStatus,
              metadata: input.metadata,
              createdAt: `2026-04-15T00:00:0${index}.000Z`
            }))
            .reverse();
        },
        async create(input) {
          const createdInput = input as CreateUsageEventInput & { estimatedCost: string; internalCost: string };
          createdInputs.push(createdInput);
          return {
            id: `usage-${createdInputs.length}`,
            organizationId: input.organizationId,
            userId: input.userId,
            departmentIdSnapshot: input.departmentIdSnapshot,
            threadId: input.threadId,
            sessionId: input.sessionId,
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-04-15T00:00:00.000Z"
          };
        }
      }
    });

    await service.recordCodexRuntimeUsage({
      sessionId: "session-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1000,
      cachedInputTokens: 300,
      outputTokens: 100,
      metadata: { source: "chat_stream" }
    });
    await service.recordCodexRuntimeUsage({
      sessionId: "session-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1800,
      cachedInputTokens: 900,
      outputTokens: 250,
      metadata: { source: "chat_stream" }
    });

    expect(createdInputs).toHaveLength(2);
    expect(createdInputs[0]).toMatchObject({
      inputTokens: 1000,
      cachedInputTokens: 300,
      outputTokens: 100
    });
    expect(createdInputs[1]).toMatchObject({
      inputTokens: 800,
      cachedInputTokens: 600,
      outputTokens: 150
    });
    expect(createdInputs[1].metadata).toMatchObject({
      source: "chat_stream",
      _codexRuntimeUsage: {
        version: 1,
        kind: "cumulative_snapshot",
        inputTokens: 1800,
        cachedInputTokens: 900,
        outputTokens: 250
      }
    });
  });

  it("uses the current snapshot when a Codex runtime counter resets", async () => {
    const service = new UsageIngestionService({
      costProfiles: {
        async getActiveByModel() {
          return profile;
        }
      },
      usageEvents: {
        async list() {
          return [{
            id: "usage-previous",
            sessionId: "session-1",
            model: "gpt-5.4",
            featureType: "chat",
            inputTokens: 9000,
            cachedInputTokens: 8000,
            outputTokens: 700,
            estimatedCost: "0.000000",
            internalCost: "0.000000",
            resultStatus: "success",
            metadata: {
              _codexRuntimeUsage: {
                version: 1,
                kind: "cumulative_snapshot",
                inputTokens: 9000,
                cachedInputTokens: 8000,
                outputTokens: 700
              }
            },
            createdAt: "2026-04-15T00:00:00.000Z"
          }];
        },
        async create(input) {
          return {
            id: "usage-next",
            organizationId: input.organizationId,
            userId: input.userId,
            departmentIdSnapshot: input.departmentIdSnapshot,
            threadId: input.threadId,
            sessionId: input.sessionId,
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-04-15T00:00:01.000Z"
          };
        }
      }
    });

    const created = await service.recordCodexRuntimeUsage({
      sessionId: "session-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 500,
      cachedInputTokens: 100,
      outputTokens: 50
    });

    expect(created.inputTokens).toBe(500);
    expect(created.cachedInputTokens).toBe(100);
    expect(created.outputTokens).toBe(50);
  });

  it("stores Codex per-turn usage without applying another delta", async () => {
    const service = new UsageIngestionService({
      costProfiles: {
        async getActiveByModel() {
          return profile;
        }
      },
      usageEvents: {
        async list() {
          return [{
            id: "usage-previous",
            sessionId: "session-1",
            model: "gpt-5.4",
            featureType: "chat",
            inputTokens: 9000,
            cachedInputTokens: 8000,
            outputTokens: 700,
            estimatedCost: "0.000000",
            internalCost: "0.000000",
            resultStatus: "success",
            metadata: {
              codexThreadId: "codex-thread-1",
              _codexRuntimeUsage: {
                version: 1,
                kind: "cumulative_snapshot",
                inputTokens: 9000,
                cachedInputTokens: 8000,
                outputTokens: 700,
                codexThreadId: "codex-thread-1"
              }
            },
            createdAt: "2026-04-15T00:00:00.000Z"
          }];
        },
        async create(input) {
          return {
            id: "usage-next",
            organizationId: input.organizationId,
            userId: input.userId,
            departmentIdSnapshot: input.departmentIdSnapshot,
            threadId: input.threadId,
            sessionId: input.sessionId,
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-04-15T00:00:01.000Z"
          };
        }
      }
    });

    const created = await service.recordCodexRuntimeUsage({
      sessionId: "session-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1200,
      cachedInputTokens: 800,
      outputTokens: 90,
      codexRuntimeUsageKind: "turn_delta",
      codexRuntimeCumulativeUsage: {
        inputTokens: 10_200,
        cachedInputTokens: 8800,
        outputTokens: 790
      },
      codexThreadId: "codex-thread-1"
    });

    expect(created.inputTokens).toBe(1200);
    expect(created.cachedInputTokens).toBe(800);
    expect(created.outputTokens).toBe(90);
    expect(created.metadata).toMatchObject({
      codexThreadId: "codex-thread-1",
      _codexRuntimeUsage: {
        kind: "turn_delta",
        inputTokens: 1200,
        cachedInputTokens: 800,
        outputTokens: 90,
        codexThreadId: "codex-thread-1",
        cumulative: {
          inputTokens: 10_200,
          cachedInputTokens: 8800,
          outputTokens: 790
        }
      }
    });
  });

  it("starts a new delta segment when the Codex thread id changes", async () => {
    const service = new UsageIngestionService({
      costProfiles: {
        async getActiveByModel() {
          return profile;
        }
      },
      usageEvents: {
        async list() {
          return [{
            id: "usage-previous",
            sessionId: "session-1",
            model: "gpt-5.4",
            featureType: "chat",
            inputTokens: 1000,
            cachedInputTokens: 600,
            outputTokens: 100,
            estimatedCost: "0.000000",
            internalCost: "0.000000",
            resultStatus: "success",
            metadata: {
              codexThreadId: "codex-thread-old",
              _codexRuntimeUsage: {
                version: 1,
                kind: "cumulative_snapshot",
                inputTokens: 10_000,
                cachedInputTokens: 8000,
                outputTokens: 900,
                codexThreadId: "codex-thread-old"
              }
            },
            createdAt: "2026-04-15T00:00:00.000Z"
          }];
        },
        async create(input) {
          return {
            id: "usage-next",
            organizationId: input.organizationId,
            userId: input.userId,
            departmentIdSnapshot: input.departmentIdSnapshot,
            threadId: input.threadId,
            sessionId: input.sessionId,
            model: input.model,
            featureType: input.featureType,
            inputTokens: input.inputTokens ?? 0,
            cachedInputTokens: input.cachedInputTokens ?? 0,
            outputTokens: input.outputTokens ?? 0,
            estimatedCost: input.estimatedCost ?? "0.000000",
            internalCost: input.internalCost ?? "0.000000",
            resultStatus: input.resultStatus,
            metadata: input.metadata,
            createdAt: "2026-04-15T00:00:01.000Z"
          };
        }
      }
    });

    const created = await service.recordCodexRuntimeUsage({
      sessionId: "session-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 3000,
      cachedInputTokens: 2000,
      outputTokens: 200,
      codexThreadId: "codex-thread-new"
    });

    expect(created.inputTokens).toBe(3000);
    expect(created.cachedInputTokens).toBe(2000);
    expect(created.outputTokens).toBe(200);
  });
});
