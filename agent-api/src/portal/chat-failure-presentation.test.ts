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

  it("explains runs interrupted by a system update and keeps the code for retry handling", () => {
    const result = presentPortalFailure({
      payload: {
        detail: "Interrupted by a system update",
        code: "SYSTEM_UPDATE_INTERRUPTED",
        reason_code: "system_update"
      },
      locale: "en-US"
    });
    expect(result.userMessage).toContain("interrupted by a system update");
    expect(result.code).toBe("SYSTEM_UPDATE_INTERRUPTED");
    expect(
      presentPortalFailure({ payload: { detail: "x", code: "SYSTEM_UPDATE_INTERRUPTED" }, locale: "zh-CN" }).userMessage
    ).toContain("系统更新");
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
