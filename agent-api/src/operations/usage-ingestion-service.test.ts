import { describe, expect, it } from "vitest";

import { UsageIngestionService } from "./usage-ingestion-service.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";
import type { CreateUsageEventInput } from "../persistence/usage-event-repository.js";

const profile: CostProfileRecord = {
  id: "profile-gpt-54",
  model: "gpt-5.4",
  inputTokenPrice: "2.500000",
  cachedInputTokenPrice: "0.250000",
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

    expect(createdInput?.estimatedCost).toBe("17.750000");
    expect(createdInput?.internalCost).toBe("21.300000");
  });
});
