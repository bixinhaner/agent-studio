import { describe, expect, it, vi } from "vitest";

import {
  DEPLOYMENT_DRAIN_ERROR_CODE,
  assertDeploymentAllowsRuntimeStart
} from "./deployment-drain.js";

describe("Portal deployment drain admission", () => {
  it("allows runtime initialization when deployment drain is inactive", async () => {
    const getDrainReason = vi.fn(async () => undefined);

    await expect(assertDeploymentAllowsRuntimeStart(getDrainReason)).resolves.toBeUndefined();
    expect(getDrainReason).toHaveBeenCalledTimes(1);
  });

  it("blocks runtime initialization before a new Codex thread can start", async () => {
    await expect(
      assertDeploymentAllowsRuntimeStart(async () => "System is updating. Please retry in a few minutes.")
    ).rejects.toMatchObject({
      name: "DeploymentDrainError",
      code: DEPLOYMENT_DRAIN_ERROR_CODE,
      message: "System is updating. Please retry in a few minutes."
    });
  });
});
