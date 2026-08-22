import { describe, expect, it, vi } from "vitest";

import { resolveDwsPortalCapabilities } from "./dws-capability.js";

describe("resolveDwsPortalCapabilities", () => {
  it("returns one localized automatic capability for the current eligible user", async () => {
    const isAvailableForUser = vi.fn(async () => true);

    const capabilities = await resolveDwsPortalCapabilities({
      userId: "user-dingtalk",
      locale: "zh-CN",
      isAvailableForUser
    });

    expect(isAvailableForUser).toHaveBeenCalledWith("user-dingtalk");
    expect(capabilities).toEqual([
      expect.objectContaining({
        id: "system:dingtalk",
        name: "dingtalk",
        label: "钉钉",
        automatic: true,
        presentation: expect.objectContaining({
          displayName: "钉钉",
          iconKey: "dingtalk",
          resolvedLocale: "zh-CN"
        })
      })
    ]);
  });

  it("uses Dingtalk for the English presentation", async () => {
    const capabilities = await resolveDwsPortalCapabilities({
      userId: "user-dingtalk",
      locale: "en-US",
      isAvailableForUser: async () => true
    });

    expect(capabilities[0]?.label).toBe("Dingtalk");
    expect(capabilities[0]?.presentation.displayName).toBe("Dingtalk");
    expect(capabilities[0]?.presentation.resolvedLocale).toBe("en");
  });

  it("fails closed when the current user is ineligible or readiness cannot be checked", async () => {
    await expect(resolveDwsPortalCapabilities({
      userId: "user-without-dingtalk",
      isAvailableForUser: async () => false
    })).resolves.toEqual([]);
    await expect(resolveDwsPortalCapabilities({
      userId: "user-check-failed",
      isAvailableForUser: async () => {
        throw new Error("readiness failed");
      }
    })).resolves.toEqual([]);
  });
});
