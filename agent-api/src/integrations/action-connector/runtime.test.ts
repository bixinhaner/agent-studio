import { describe, expect, it, vi } from "vitest";

import { ActionConnectorRuntimeService, type AgentStreamEvent } from "./runtime.js";

const forbiddenTerms = [String.fromCharCode(103, 111, 111, 109, 99), String.fromCharCode(79, 77, 67)];

function createDbMock() {
  return {
    integrationInstance: {
      findUnique: vi.fn(async () => ({
        id: "connector-1",
        type: "action_connector",
        status: "active",
        name: "Operations System"
      })),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    integrationInstanceConfig: {
      findUnique: vi.fn(async () => ({
        id: "config-1",
        integrationInstanceId: "connector-1",
        config: {
          displayName: "Operations System",
          baseUrl: "https://ops.example.com",
          policy: {
            allowReadActions: true,
            allowLowRiskActions: false,
            allowHighRiskActions: false
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      upsert: vi.fn()
    },
    integrationInstanceSecret: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    integrationValidationRun: {
      findMany: vi.fn(),
      create: vi.fn()
    },
    integrationBindingRecord: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn()
    },
    $transaction: vi.fn()
  };
}

function connectorResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ret: 1, msg: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("ActionConnectorRuntimeService", () => {
  it("streams generic action events and forwards the delegation token", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.Authorization
      });
      if (String(url).endsWith("/actions/search")) {
        return connectorResponse([
          {
            id: "alarm.active_summary",
            title: "Read active alarms",
            description: "Read active alarm counts",
            risk: "read"
          }
        ]);
      }
      if (String(url).endsWith("/actions/describe")) {
        return connectorResponse({
          id: "alarm.active_summary",
          title: "Read active alarms",
          description: "Read active alarm counts",
          risk: "read"
        });
      }
      if (String(url).endsWith("/actions/preview")) {
        return connectorResponse({
          actionId: "alarm.active_summary",
          summary: "Read active alarm summary",
          risk: "read"
        });
      }
      if (String(url).endsWith("/actions/execute")) {
        return connectorResponse({
          actionId: "alarm.active_summary",
          status: "ok",
          result: { statistics: { total_active: 2 }, items: [] }
        });
      }
      return connectorResponse([]);
    }) as unknown as typeof fetch;
    const runtime = new ActionConnectorRuntimeService(createDbMock() as never, fetchImpl);
    const events: AgentStreamEvent[] = [];

    await runtime.streamChat({
      connectorId: "connector-1",
      delegationHeaderValue: "Bearer delegated",
      request: {
        message: "查看告警",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        context: {}
      },
      emit: (event) => events.push(event)
    });

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "delta",
      "tool_call",
      "action_preview",
      "tool_result",
      "delta",
      "done"
    ]);
    expect(calls.every((call) => call.auth === "Bearer delegated")).toBe(true);
    for (const term of forbiddenTerms) {
      expect(JSON.stringify(events)).not.toContain(term);
    }
  });

  it("blocks actions disabled by connector policy", async () => {
    const db = createDbMock();
    db.integrationInstanceConfig.findUnique = vi.fn(async () => ({
      id: "config-1",
      integrationInstanceId: "connector-1",
      config: {
        displayName: "Operations System",
        baseUrl: "https://ops.example.com",
        policy: {
          allowReadActions: false,
          allowLowRiskActions: false,
          allowHighRiskActions: false
        }
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/actions/search")) {
        return connectorResponse([{
          id: "system.health",
          title: "Read health",
          description: "Read health",
          risk: "read"
        }]);
      }
      if (String(url).endsWith("/actions/describe")) {
        return connectorResponse({
          id: "system.health",
          title: "Read health",
          description: "Read health",
          risk: "read"
        });
      }
      return connectorResponse([]);
    }) as unknown as typeof fetch;
    const runtime = new ActionConnectorRuntimeService(db as never, fetchImpl);

    await expect(
      runtime.streamChat({
        connectorId: "connector-1",
        delegationHeaderValue: "Bearer delegated",
        request: {
          message: "health",
          locale: "en-US",
          timezone: "UTC",
          context: {}
        },
        emit: () => undefined
      })
    ).rejects.toThrow(/not allowed/);
  });
});
