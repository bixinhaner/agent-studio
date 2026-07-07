import { describe, expect, it, vi } from "vitest";

import { ActionConnectorRuntimeService, type ActionConnectorCodexRunnerInput } from "./runtime.js";

const forbiddenTerms = [String.fromCharCode(103, 111, 111, 109, 99), String.fromCharCode(79, 77, 67)];

function createDbMock(overrides: {
  instance?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
} = {}) {
  return {
    integrationInstance: {
      findUnique: vi.fn(async () => overrides.instance ?? ({
        id: "connector-1",
        type: "action_connector",
        status: "active",
        name: "Operations System",
        slug: "external-agent-connector",
        organizationId: null
      })),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    integrationInstanceConfig: {
      findUnique: vi.fn(async () => ({
        id: "config-1",
        integrationInstanceId: "connector-1",
        config: overrides.config ?? {
          displayName: "Operations System",
          baseUrl: "https://ops.example.com",
          identityPath: "/identity",
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
  it("fails fast when the Codex-backed runner is not wired", async () => {
    const db = createDbMock();
    const runtime = new ActionConnectorRuntimeService(db as never);

    await expect(
      runtime.streamChat({
        connectorId: "connector-1",
        delegationHeaderValue: "Bearer delegated",
        request: {
          message: "show status",
          mode: "execute",
          locale: "en-US",
          timezone: "UTC",
          context: {}
        },
        emit: () => undefined
      })
    ).rejects.toThrow(/Codex-backed action connector runtime is not configured/);
    expect(db.integrationInstance.findUnique).not.toHaveBeenCalled();
  });

  it("loads the generic connector and delegates the turn to the Codex runner", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.Authorization
      });
      if (String(url).endsWith("/identity")) {
        return connectorResponse({
          externalUserId: "external-user-1",
          externalUserName: "External Operator"
        });
      }
      return connectorResponse([]);
    }) as unknown as typeof fetch;
    const runner = vi.fn(async (input: ActionConnectorCodexRunnerInput) => {
      input.emit({ type: "start", runId: "run-1", conversationId: input.request.conversationId ?? "conversation-1" });
      await input.client.identity(input.signal);
      input.emit({ type: "delta", text: "delegated to codex\n" });
      input.emit({ type: "done" });
    });
    const runtime = new ActionConnectorRuntimeService(createDbMock() as never, fetchImpl, runner);
    const events: unknown[] = [];

    await runtime.streamChat({
      connectorId: "connector-1",
      delegationHeaderValue: "Bearer delegated",
      request: {
        message: "show status",
        conversationId: "conversation-1",
        clientRunId: "run-1",
        mode: "execute",
        locale: "en-US",
        timezone: "UTC",
        context: { path: "/devices" }
      },
      emit: (event) => events.push(event)
    });

    expect(runner).toHaveBeenCalledOnce();
    const runnerInput = runner.mock.calls[0][0];
    expect(runnerInput.connector).toMatchObject({
      id: "connector-1",
      name: "Operations System",
      slug: "external-agent-connector"
    });
    expect(runnerInput.config).toMatchObject({
      displayName: "Operations System",
      baseUrl: "https://ops.example.com",
      agentModeId: "default"
    });
    expect(calls).toEqual([{ url: "https://ops.example.com/identity", auth: "Bearer delegated" }]);
    expect(events.map((event) => (event as { type: string }).type)).toEqual(["start", "delta", "done"]);
    for (const term of forbiddenTerms) {
      expect(JSON.stringify({ events, config: runnerInput.config })).not.toContain(term);
    }
  });

  it("rejects inactive or non-action connector instances before calling Codex", async () => {
    const runner = vi.fn(async () => undefined);
    const runtime = new ActionConnectorRuntimeService(
      createDbMock({
        instance: {
          id: "connector-1",
          type: "action_connector",
          status: "disabled",
          name: "Operations System"
        }
      }) as never,
      fetch,
      runner
    );

    await expect(
      runtime.streamChat({
        connectorId: "connector-1",
        delegationHeaderValue: "Bearer delegated",
        request: {
          message: "show status",
          mode: "execute",
          locale: "en-US",
          timezone: "UTC",
          context: {}
        },
        emit: () => undefined
      })
    ).rejects.toThrow(/action connector is not active/);
    expect(runner).not.toHaveBeenCalled();
  });
});
