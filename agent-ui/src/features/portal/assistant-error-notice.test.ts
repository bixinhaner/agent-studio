import { describe, expect, it } from "vitest";
import { portalAssistantErrorMessageKey } from "./assistant-error-notice";

describe("portalAssistantErrorMessageKey", () => {
  it("uses stable error codes before inspecting server text", () => {
    expect(portalAssistantErrorMessageKey("任意服务端文案", "DEPLOYMENT_DRAIN")).toBe(
      "thread.errorDeploymentDrain"
    );
    expect(portalAssistantErrorMessageKey("任意服务端文案", "AI_SERVICE_BUSY")).toBe(
      "thread.errorAiServiceBusy"
    );
  });

  it("keeps legacy text matching for older API responses", () => {
    expect(portalAssistantErrorMessageKey("System is updating. Please retry in a few minutes.")).toBe(
      "thread.errorDeploymentDrain"
    );
  });

  it("falls back to a localized generic message key", () => {
    expect(portalAssistantErrorMessageKey("internal provider detail")).toBe("thread.errorGeneric");
  });
});
