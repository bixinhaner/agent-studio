import { describe, expect, it } from "vitest";
import { presentPortalFailure } from "./chat-failure-presentation.js";

describe("presentPortalFailure", () => {
  it("localizes deployment drain by stable error code", () => {
    const result = presentPortalFailure({
      payload: {
        detail: "System is updating. Please retry in a few minutes.",
        code: "DEPLOYMENT_DRAIN",
        reason_code: "deployment_drain"
      },
      locale: "zh-CN"
    });
    expect(result.userMessage).toBe("系统正在升级，请几分钟后重试。");
    expect(result.code).toBe("DEPLOYMENT_DRAIN");
  });

  it("keeps diagnostic detail separate from the user-safe message", () => {
    const result = presentPortalFailure({
      payload: { detail: "Chat stream failed" },
      rawDetail: "provider returned secret internal detail",
      locale: "en-US"
    });
    expect(result.userMessage).not.toContain("secret internal detail");
    expect(result.rawDetail).toBe("provider returned secret internal detail");
  });
});
