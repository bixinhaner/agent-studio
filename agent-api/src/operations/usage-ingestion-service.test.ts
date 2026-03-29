import { describe, expect, it } from "vitest";

import { CostProfileRepository } from "../persistence/cost-profile-repository.js";
import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { UsageEventRepository } from "../persistence/usage-event-repository.js";
import { UsageIngestionService } from "./usage-ingestion-service.js";

describe("UsageIngestionService", () => {
  it("calculates estimated and internal cost from a model cost profile", async () => {
    const db = new FakeOperationsDb();
    const costProfiles = new CostProfileRepository(db as never);
    await costProfiles.upsert({
      model: "gpt-5.4",
      inputTokenPrice: "0.001000",
      cachedInputTokenPrice: "0.000500",
      outputTokenPrice: "0.002000",
      internalCostMultiplier: "1.2500"
    });
    const service = new UsageIngestionService({
      usageEvents: new UsageEventRepository(db as never),
      costProfiles
    });

    const event = await service.record({
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 500
    });

    expect(Number(event.estimatedCost)).toBeGreaterThan(0);
    expect(Number(event.internalCost)).toBeGreaterThan(Number(event.estimatedCost));
  });
});
