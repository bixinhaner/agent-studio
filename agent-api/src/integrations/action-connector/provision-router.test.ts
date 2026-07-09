import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createServiceTokenMiddleware } from "../../service-token.js";
import { createActionConnectorProvisionRouter } from "./provision-router.js";

type InstanceRow = {
  id: string;
  organizationId: string | null;
  type: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  isSystemSingleton: boolean;
  createdAt: string;
  updatedAt: string;
};

type ConfigRow = {
  id: string;
  integrationInstanceId: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function createDbMock(seed: InstanceRow[] = []) {
  const now = "2026-07-07T00:00:00.000Z";
  const instances = [...seed];
  const configs: ConfigRow[] = [];
  const validations: unknown[] = [];

  const db: Record<string, unknown> = {};
  Object.assign(db, {
    integrationInstance: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        instances.find((item) => item.id === where.id) ?? null
      ),
      findMany: vi.fn(async (args?: { where?: { type?: string } }) =>
        args?.where?.type ? instances.filter((item) => item.type === args.where?.type) : instances
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: InstanceRow = {
          id: `connector-${instances.length + 1}`,
          organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
          type: String(data.type),
          slug: String(data.slug),
          name: String(data.name),
          description: typeof data.description === "string" ? data.description : null,
          status: typeof data.status === "string" ? data.status : "draft",
          isSystemSingleton: Boolean(data.isSystemSingleton),
          createdAt: now,
          updatedAt: now
        };
        instances.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = instances.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("integration instance not found");
        instances[index] = {
          ...instances[index],
          name: typeof data.name === "string" ? data.name : instances[index].name,
          description: data.description === undefined ? instances[index].description : typeof data.description === "string" ? data.description : null,
          status: typeof data.status === "string" ? data.status : instances[index].status,
          updatedAt: now
        };
        return instances[index];
      })
    },
    integrationInstanceConfig: {
      findUnique: vi.fn(async ({ where }: { where: { integrationInstanceId: string } }) =>
        configs.find((item) => item.integrationInstanceId === where.integrationInstanceId) ?? null
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update
        }: {
          where: { integrationInstanceId: string };
          create: { integrationInstanceId: string; config: Record<string, unknown> };
          update: { config: Record<string, unknown> };
        }) => {
          const existing = configs.find((item) => item.integrationInstanceId === where.integrationInstanceId);
          if (existing) {
            existing.config = update.config;
            existing.updatedAt = now;
            return existing;
          }
          const row = {
            id: `config-${configs.length + 1}`,
            integrationInstanceId: create.integrationInstanceId,
            config: create.config,
            createdAt: now,
            updatedAt: now
          };
          configs.push(row);
          return row;
        }
      )
    },
    integrationInstanceSecret: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn()
    },
    integrationValidationRun: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `validation-${validations.length + 1}`,
          integrationInstanceId: String(data.integrationInstanceId),
          triggerType: String(data.triggerType),
          status: String(data.status),
          summary: data.summary ?? null,
          detail: data.detail ?? null,
          triggeredByUserId: null,
          createdAt: now
        };
        validations.push(row);
        return row;
      })
    },
    integrationBindingRecord: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn()
    },
    $transaction: vi.fn(async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(db))
  });

  return {
    db,
    instances,
    configs,
    validations
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    slug: "external-ops",
    name: "External Operations",
    runtimeBaseUrl: "https://agent.example.com/",
    config: {
      displayName: "External Operations",
      policy: {
        allowReadActions: true,
        allowLowRiskActions: false,
        allowHighRiskActions: false,
        allowedMethods: ["GET"],
        blockedPathPrefixes: ["/api/v1/auth/*"],
        toolTimeoutSeconds: 30,
        maxResponseBytes: 262144
      }
    },
    ...overrides
  };
}

function buildApp(input: {
  token?: string;
  db: unknown;
  fetchImpl?: typeof fetch;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/integrations/action-connectors",
    createServiceTokenMiddleware(input.token),
    createActionConnectorProvisionRouter({
      db: input.db as never,
      fetchImpl: input.fetchImpl
    })
  );
  return app;
}

describe("Action connector provision router", () => {
  it("rejects requests without the service token", async () => {
    const db = createDbMock();
    const app = buildApp({ token: "expected-token", db: db.db });

    await request(app)
      .post("/api/integrations/action-connectors/provision")
      .send(payload())
      .expect(401);

    expect(db.instances).toHaveLength(0);
  });

  it("creates a generic action connector by slug", async () => {
    const db = createDbMock();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const app = buildApp({ token: "expected-token", db: db.db, fetchImpl });

    const response = await request(app)
      .post("/api/integrations/action-connectors/provision")
      .set("Authorization", "Bearer expected-token")
      .send(payload())
      .expect(200);

    expect(response.body).toMatchObject({
      connectorId: "connector-1",
      slug: "external-ops",
      status: "connected",
      runtimeStreamPath: "/api/action-connectors/connector-1/chat/stream",
      runtimeStreamUrl: "https://agent.example.com/api/action-connectors/connector-1/chat/stream"
    });
    expect(db.instances).toHaveLength(1);
    expect(db.instances[0].type).toBe("action_connector");
    expect(db.configs[0].config).toMatchObject({
      displayName: "External Operations",
      policy: {
        allowedMethods: ["GET"]
      }
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("updates an existing connector with the same slug", async () => {
    const db = createDbMock([
      {
        id: "connector-existing",
        organizationId: null,
        type: "action_connector",
        slug: "external-ops",
        name: "Old Name",
        description: null,
        status: "active",
        isSystemSingleton: false,
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z"
      }
    ]);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const app = buildApp({ token: "expected-token", db: db.db, fetchImpl });

    const response = await request(app)
      .post("/api/integrations/action-connectors/provision")
      .set("Authorization", "Bearer expected-token")
      .send(payload({ name: "New Name" }))
      .expect(200);

    expect(response.body.connectorId).toBe("connector-existing");
    expect(db.instances).toHaveLength(1);
    expect(db.instances[0].name).toBe("New Name");
  });

  it("preserves the selected agent mode and materializes the default runtime prompt", async () => {
    const db = createDbMock([
      {
        id: "connector-existing",
        organizationId: null,
        type: "action_connector",
        slug: "external-ops",
        name: "External Operations",
        description: null,
        status: "active",
        isSystemSingleton: false,
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z"
      }
    ]);
    db.configs.push({
      id: "config-existing",
      integrationInstanceId: "connector-existing",
      config: {
        displayName: "External Operations",
        agentModeId: "agent-mode-from-studio",
        runtimeInstruction: "Use the operations support skill."
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const app = buildApp({ token: "expected-token", db: db.db, fetchImpl });

    await request(app)
      .post("/api/integrations/action-connectors/provision")
      .set("Authorization", "Bearer expected-token")
      .send(payload())
      .expect(200);

    expect(db.configs[0].config).toMatchObject({
      agentModeId: "agent-mode-from-studio"
    });
    expect(db.configs[0].config.runtimePrompt).toContain("action-connector-cli");
    expect(db.configs[0].config).not.toHaveProperty("runtimeInstruction");
  });

  it("preserves a Studio-managed runtime prompt when reprovision omits it", async () => {
    const db = createDbMock([
      {
        id: "connector-existing",
        organizationId: null,
        type: "action_connector",
        slug: "external-ops",
        name: "External Operations",
        description: null,
        status: "active",
        isSystemSingleton: false,
        createdAt: "2026-07-06T00:00:00.000Z",
        updatedAt: "2026-07-06T00:00:00.000Z"
      }
    ]);
    db.configs.push({
      id: "config-existing",
      integrationInstanceId: "connector-existing",
      config: {
        displayName: "External Operations",
        agentModeId: "agent-mode-from-studio",
        runtimePrompt: "Studio-managed connector runtime prompt."
      },
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
    const app = buildApp({ token: "expected-token", db: db.db });

    await request(app)
      .post("/api/integrations/action-connectors/provision")
      .set("Authorization", "Bearer expected-token")
      .send(payload())
      .expect(200);

    expect(db.configs[0].config).toMatchObject({
      agentModeId: "agent-mode-from-studio",
      runtimePrompt: "Studio-managed connector runtime prompt."
    });
  });

  it("does not require inbound access to the external system during provision", async () => {
    const db = createDbMock();
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const app = buildApp({ token: "expected-token", db: db.db, fetchImpl });

    const response = await request(app)
      .post("/api/integrations/action-connectors/provision")
      .set("Authorization", "Bearer expected-token")
      .send(payload())
      .expect(200);

    expect(response.body.status).toBe("connected");
    expect(db.instances[0].status).toBe("active");
    expect(db.validations).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
