import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createAuthRouter } from "../auth/router.js";
import { createCurrentUserMiddleware } from "../auth/current-user.js";
import { createSessionCookieManager } from "../auth/session-cookie.js";
import { registerCommonApiRoutes } from "../app-routes.js";
import { createAdminRouter } from "./router.js";
import { ZendeskSettingsStore } from "../integrations/zendesk/settings-store.js";
import { ZendeskIntegrationService } from "../integrations/zendesk/service.js";
import { createPortalRouter } from "../portal/router.js";
import { IntegrationRepository } from "../persistence/integration-repository.js";
import type { AuthenticatedUser, UserRepositoryLike } from "../persistence/user-repository.js";

type RuntimeOptionResponse = {
  modes: Array<{
    id: string;
    label: string;
    description?: string;
    runtimeProfile: {
      id: string;
      name: string;
      slug: string;
      status: string;
      defaultModel: string;
      allowedModels: string[];
      defaultReasoningEffort: string;
      sandboxMode: string;
      approvalPolicy: string;
      networkAccessEnabled: boolean;
      webSearchMode: string;
    };
    allowDirectorySelection: boolean;
    skillPackages: Array<{ id: string; label: string }>;
    workspaces: Array<{
      id: string;
      label: string;
      isDefault: boolean;
      allowDirectorySelection: boolean;
      directoryScope: string;
      loadWorkspaceAgentsMd: boolean;
    }>;
    instructionSources: Array<{ sourceType: string; sourceRef: string; sortOrder: number }>;
  }>;
  workspaces: Array<{ id: string; label: string; isDefault: boolean }>;
  canUpload: boolean;
  defaults: { mode: string; workspace: string };
};

class FakeUserRepository implements UserRepositoryLike {
  constructor(private readonly users = new Map<string, AuthenticatedUser>()) {}

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    return this.users.get(id);
  }

  async getByExternalId(externalId: string): Promise<AuthenticatedUser | undefined> {
    for (const user of this.users.values()) {
      if (user.externalId === externalId) return user;
    }
    return undefined;
  }

  async upsertFromDingTalk(): Promise<AuthenticatedUser> {
    throw new Error("not used in admin router tests");
  }

  seed(user: AuthenticatedUser): void {
    this.users.set(user.id, user);
  }
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: overrides.id ?? "user-1",
    externalId: overrides.externalId ?? "ding-user-1",
    email: overrides.email ?? "user@example.com",
    displayName: overrides.displayName ?? "User One",
    role: overrides.role ?? "employee",
    status: overrides.status ?? "active",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString()
  };
}

type FakeIntegrationRow = {
  key: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

class FakeIntegrationDb {
  constructor(readonly rows: FakeIntegrationRow[] = []) {}

  readonly integrationConfig = {
    findUnique: async ({ where }: { where: { key: string } }) => {
      const row = this.rows.find((item) => item.key === where.key);
      return row ? JSON.parse(JSON.stringify(row)) : null;
    },
    upsert: async ({
      where,
      create,
      update
    }: {
      where: { key: string };
      create: { key: string; config: Record<string, unknown> };
      update: { config: Record<string, unknown> };
    }) => {
      const existing = this.rows.find((item) => item.key === where.key);
      if (existing) {
        existing.config = JSON.parse(JSON.stringify(update.config));
        existing.updatedAt = new Date();
        return JSON.parse(JSON.stringify(existing));
      }

      const row: FakeIntegrationRow = {
        key: create.key,
        config: JSON.parse(JSON.stringify(create.config)),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.rows.push(row);
      return JSON.parse(JSON.stringify(row));
    }
  };
}

function buildApp(options?: {
  user?: AuthenticatedUser;
  counts?: { users: number; threads: number; activeSessions: number };
  zendesk?: Pick<ZendeskIntegrationService, "getOverview">;
  runtimeOptions?: RuntimeOptionResponse;
}) {
  const users = new FakeUserRepository();
  const user = options?.user ?? makeUser();
  users.seed(user);

  const cookies = createSessionCookieManager({
    cookieName: "agent_studio_session",
    secret: "test-session-secret",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    secure: false,
    sameSite: "lax"
  });

  const app = express();
  app.use(express.json());
  registerCommonApiRoutes(app, {
    currentUserMiddleware: createCurrentUserMiddleware({ users, cookies }),
    authRouter: createAuthRouter({
      users,
      cookies,
      dingtalkClient: {
        async exchangeCode() {
          throw new Error("not used in admin router tests");
        }
      },
      dingtalkConfig: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://example.com/callback",
        scope: "openid"
      },
      oauthStates: {
        cookieName: "agent_studio_session_oauth_state",
        issue() {
          return {
            state: "state",
            nonce: "nonce",
            cookie: "agent_studio_session_oauth_state=state"
          };
        },
        clear() {
          return "agent_studio_session_oauth_state=; Max-Age=0";
        },
        read() {
          return undefined;
        }
      }
    }),
    adminRouter: createAdminRouter({
      users: { count: async () => options?.counts?.users ?? 0 },
      threads: { count: async () => options?.counts?.threads ?? 0 },
      sessions: { countActive: async () => options?.counts?.activeSessions ?? 0 },
      zendesk:
        options?.zendesk ??
        ({
          getOverview: async () => ({
            ready: false,
            missing: ["zendesk_base_url"],
            settings: {
              enabled: false,
              publicBaseUrl: "",
              zendeskBaseUrl: "",
              zendeskEmail: "",
              responseMode: "public_reply",
              fallbackMode: "internal_note",
              autoStatus: "pending",
              excludedTags: [],
              workspace: "/workspace/default",
              model: "gpt-4.1",
              reasoningEffort: "high",
              sandboxMode: "workspace-write",
              approvalPolicy: "never",
              networkAccessEnabled: true,
              webSearchMode: "disabled",
              additionalDirectories: [],
              maxCommentHistory: 12,
              systemPrompt: "system",
              hasZendeskApiToken: false,
              hasWebhookSigningSecret: false
            },
            setup: {
              webhookUrl: "",
              payloadExample: "",
              triggers: []
            },
            runs: []
          })
        } satisfies Pick<ZendeskIntegrationService, "getOverview">)
    }),
    portalRouter: createPortalRouter({
      runtimeOptions: {
        resolve: async () =>
          options?.runtimeOptions ?? {
            modes: [
              {
                id: "mode-code",
                label: "代码助手",
                description: "面向代码任务",
                runtimeProfile: {
                  id: "profile-code",
                  name: "Coding Default",
                  slug: "profile-code",
                  status: "active",
                  defaultModel: "gpt-5.4",
                  allowedModels: ["gpt-5.4"],
                  defaultReasoningEffort: "high",
                  sandboxMode: "workspace-write",
                  approvalPolicy: "never",
                  networkAccessEnabled: true,
                  webSearchMode: "disabled"
                },
                allowDirectorySelection: true,
                skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
                workspaces: [
                  {
                    id: "/workspace/default",
                    label: "default",
                    isDefault: true,
                    allowDirectorySelection: true,
                    directoryScope: "descendants_only",
                    loadWorkspaceAgentsMd: true
                  }
                ],
                instructionSources: []
              }
            ],
            workspaces: [{ id: "/workspace/default", label: "default", isDefault: true }],
            canUpload: true,
            defaults: {
              mode: "mode-code",
              workspace: "/workspace/default"
            }
          }
      },
      listDepartmentIdsForUser: async () => []
    }),
    serviceTokenMiddleware: (_req, _res, next) => {
      next();
    },
    zendeskRouter: express.Router()
  });

  return { app, cookies, user };
}

describe("admin and portal routers", () => {
  it("returns overview counts for an admin user", async () => {
    const integrationRepository = new IntegrationRepository(new FakeIntegrationDb() as never);
    await integrationRepository.upsertConfig("zendesk", {
      enabled: true,
      publicBaseUrl: "https://studio.example.com",
      zendeskBaseUrl: "https://example.zendesk.com",
      zendeskEmail: "bot@example.com"
    });
    const zendesk = new ZendeskIntegrationService(
      new ZendeskSettingsStore(integrationRepository),
      {} as never,
      { list: async () => [] } as never
    );

    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "admin-1", role: "admin" }),
      counts: { users: 7, threads: 13, activeSessions: 3 },
      zendesk
    });

    const response = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      },
      integrations: {
        zendesk: {
          enabled: true,
          ready: false,
          missing: ["zendesk_api_token", "webhook_signing_secret"],
          hasZendeskApiToken: false,
          hasWebhookSigningSecret: false,
          lastValidatedAt: null
        }
      }
    });
  });

  it("returns a controlled 500 response when zendesk overview loading fails", async () => {
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "admin-1", role: "admin" }),
      zendesk: {
        async getOverview() {
          throw new Error("zendesk store unavailable");
        }
      }
    });

    const response = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ detail: "zendesk store unavailable" });
  });

  it("rejects a non-admin user from admin overview", async () => {
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "employee-1", role: "employee" })
    });

    const response = await request(app)
      .get("/api/admin/overview")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "Forbidden" });
  });

  it("returns runtime options for a signed-in employee user", async () => {
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "employee-1", role: "employee" })
    });

    const response = await request(app)
      .get("/api/portal/runtime-options")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      modes: [
        {
          id: "mode-code",
          label: "代码助手",
          description: "面向代码任务",
          runtimeProfile: {
            id: "profile-code",
            name: "Coding Default",
            slug: "profile-code",
            status: "active",
            defaultModel: "gpt-5.4",
            allowedModels: ["gpt-5.4"],
            defaultReasoningEffort: "high",
            sandboxMode: "workspace-write",
            approvalPolicy: "never",
            networkAccessEnabled: true,
            webSearchMode: "disabled"
          },
          allowDirectorySelection: true,
          skillPackages: [{ id: "skill-package-code", label: "Code Tools" }],
          workspaces: [
            {
              id: "/workspace/default",
              label: "default",
              isDefault: true,
              allowDirectorySelection: true,
              directoryScope: "descendants_only",
              loadWorkspaceAgentsMd: true
            }
          ],
          instructionSources: []
        }
      ],
      workspaces: [
        {
          id: "/workspace/default",
          label: "default",
          isDefault: true
        }
      ],
      canUpload: true,
      defaults: {
        mode: "mode-code",
        workspace: "/workspace/default"
      }
    });
  });
});
