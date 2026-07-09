import { describe, expect, it } from "vitest";

import { ActionConnectorIntegrationAdapter } from "./action-connector-adapter.js";

const forbiddenTerms = [String.fromCharCode(103, 111, 111, 109, 99), String.fromCharCode(79, 77, 67)];

describe("ActionConnectorIntegrationAdapter", () => {
  it("validates generic outbound bridge config", async () => {
    const adapter = new ActionConnectorIntegrationAdapter();

    const result = await adapter.validate({
      displayName: "Operations System",
      policy: {
        allowReadActions: true,
        allowLowRiskActions: false,
        allowHighRiskActions: false,
        allowedMethods: ["GET"],
        blockedPathPrefixes: [],
        toolTimeoutSeconds: 30,
        maxResponseBytes: 262144
      }
    });

    expect(result.status).toBe("success");
    for (const term of forbiddenTerms) {
      expect(JSON.stringify(result)).not.toContain(term);
    }
  });

  it("ignores legacy inbound connector fields", async () => {
    const adapter = new ActionConnectorIntegrationAdapter();

    const result = await adapter.validate({
      displayName: "Operations System",
      baseUrl: "not-a-url",
      delegationHeader: "",
      healthPath: "/api/v1/agent/health",
      actionExecutePath: "/api/v1/agent-actions/actions/execute"
    });

    expect(result.status).toBe("success");
    expect(JSON.stringify(result.detail)).not.toContain("baseUrl");
    expect(JSON.stringify(result.detail)).not.toContain("delegationHeader");
    expect(JSON.stringify(result.detail)).not.toContain("actionExecutePath");
  });

  it("does not require external endpoint fields", async () => {
    const adapter = new ActionConnectorIntegrationAdapter();

    const result = await adapter.validate({
      displayName: "Operations System"
    });

    expect(result.status).toBe("success");
  });
});
