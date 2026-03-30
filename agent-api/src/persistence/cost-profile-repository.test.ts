import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { CostProfileRepository } from "./cost-profile-repository.js";

describe("CostProfileRepository", () => {
  it("upserts and lists active cost profiles", async () => {
    const repository = new CostProfileRepository(new FakeOperationsDb() as never);

    await repository.upsert({
      model: "gpt-5.4",
      inputTokenPrice: "0.001000",
      cachedInputTokenPrice: "0.000500",
      outputTokenPrice: "0.002000",
      internalCostMultiplier: "1.2500"
    });

    const profiles = await repository.listActive();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.model).toBe("gpt-5.4");
  });

  it("lists inactive and organization-scoped cost profiles for admin views", async () => {
    const repository = new CostProfileRepository(new FakeOperationsDb() as never);

    await repository.upsert({
      model: "gpt-5.4",
      inputTokenPrice: "0.001000",
      cachedInputTokenPrice: "0.000500",
      outputTokenPrice: "0.002000",
      internalCostMultiplier: "1.2500"
    });
    await repository.upsert({
      organizationId: "org-1",
      model: "claude-code",
      inputTokenPrice: "0.002000",
      cachedInputTokenPrice: "0.001000",
      outputTokenPrice: "0.003000",
      internalCostMultiplier: "1.1000",
      isActive: false
    });

    const profiles = await repository.list();

    expect(profiles).toHaveLength(2);
    expect(profiles.map((item) => item.model)).toEqual(["gpt-5.4", "claude-code"]);
    expect(profiles[1]?.organizationId).toBe("org-1");
    expect(profiles[1]?.isActive).toBe(false);
  });
});
