import { describe, expect, it, vi } from "vitest";

import { ActionConnectorIntegrationAdapter } from "./action-connector-adapter.js";

const forbiddenTerms = [String.fromCharCode(103, 111, 111, 109, 99), String.fromCharCode(79, 77, 67)];

describe("ActionConnectorIntegrationAdapter", () => {
  it("validates generic outbound bridge config without inbound health access", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as unknown as typeof fetch;
    const adapter = new ActionConnectorIntegrationAdapter(fetchImpl);

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
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const term of forbiddenTerms) {
      expect(JSON.stringify(result)).not.toContain(term);
    }
  });

  it("rejects invalid optional base URLs and bridge headers", async () => {
    const adapter = new ActionConnectorIntegrationAdapter(vi.fn() as unknown as typeof fetch);

    const result = await adapter.validate({
      displayName: "Operations System",
      baseUrl: "not-a-url",
      delegationHeader: ""
    });

    expect(result.status).toBe("failed");
    expect(JSON.stringify(result.detail)).toContain("baseUrl");
    expect(JSON.stringify(result.detail)).toContain("delegationHeader");
  });

  it("does not fail when the external system is unreachable", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const adapter = new ActionConnectorIntegrationAdapter(fetchImpl);

    const result = await adapter.validate({
      displayName: "Operations System",
      baseUrl: "https://ops.example.com"
    });

    expect(result.status).toBe("success");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
