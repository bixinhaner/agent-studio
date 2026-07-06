import { describe, expect, it, vi } from "vitest";

import { ActionConnectorIntegrationAdapter } from "./action-connector-adapter.js";

const forbiddenTerms = [String.fromCharCode(103, 111, 111, 109, 99), String.fromCharCode(79, 77, 67)];

describe("ActionConnectorIntegrationAdapter", () => {
  it("validates generic action connector config and health", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as unknown as typeof fetch;
    const adapter = new ActionConnectorIntegrationAdapter(fetchImpl);

    const result = await adapter.validate({
      displayName: "Operations System",
      baseUrl: "http://localhost:8081/",
      policy: {
        allowReadActions: true,
        allowLowRiskActions: false,
        allowHighRiskActions: false
      }
    });

    expect(result.status).toBe("success");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8081/healthz",
      expect.objectContaining({ method: "GET" })
    );
    for (const term of forbiddenTerms) {
      expect(JSON.stringify(result)).not.toContain(term);
    }
  });

  it("rejects invalid base URLs and paths", async () => {
    const adapter = new ActionConnectorIntegrationAdapter(vi.fn() as unknown as typeof fetch);

    const result = await adapter.validate({
      displayName: "Operations System",
      baseUrl: "not-a-url",
      actionExecutePath: "api/actions/execute"
    });

    expect(result.status).toBe("failed");
    expect(JSON.stringify(result.detail)).toContain("baseUrl");
    expect(JSON.stringify(result.detail)).toContain("actionExecutePath");
  });

  it("fails when the connector health check is not reachable", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const adapter = new ActionConnectorIntegrationAdapter(fetchImpl);

    const result = await adapter.validate({
      displayName: "Operations System",
      baseUrl: "https://ops.example.com"
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toBe("Action connector health check failed");
  });
});
