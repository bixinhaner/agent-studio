import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import { createAdminRouter } from "../admin/router.js";
import { createAuthRouter } from "../auth/router.js";
import { createCurrentUserMiddleware } from "../auth/current-user.js";
import { createSessionCookieManager } from "../auth/session-cookie.js";
import type { AuthenticatedUser, UserRepositoryLike } from "../persistence/user-repository.js";
import { ResourcePolicyRepository } from "../persistence/resource-policy-repository.js";
import { createPortalRouter } from "../portal/router.js";
import { PolicyService } from "./policy-service.js";
import { createResourcesPortalRouter } from "./portal-router.js";

describe("resources portal router", () => {
  it("returns only authorized active workspaces and separates default vs optional knowledge sets", async () => {
    const { app, cookies, user } = buildPortalResourcesApp();

    const response = await request(app)
      .get("/api/portal/resources")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(200);
    expect(response.body.workspaces).toEqual([
      {
        id: "ws-docs",
        label: "Docs",
        slug: "docs",
        is_default: true,
        default_knowledge_sets: [{ id: "ks-faq", label: "FAQ", slug: "faq" }],
        optional_knowledge_sets: [{ id: "ks-runbook", label: "Runbooks", slug: "runbooks" }]
      }
    ]);
  });

  it("excludes unauthorized and inactive resources from the portal response", async () => {
    const { app, cookies, user } = buildPortalResourcesApp();

    const response = await request(app)
      .get("/api/portal/resources")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(200);
    expect(response.body.workspaces).toHaveLength(1);
    expect(response.body.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual(["ws-docs"]);
    expect(JSON.stringify(response.body.workspaces)).not.toContain("ks-secret");
    expect(JSON.stringify(response.body.workspaces)).not.toContain("ks-inactive");
  });

  it("keeps runtime-options working after registering the resources portal router", async () => {
    const { app, cookies, user } = buildPortalResourcesApp();

    const response = await request(app)
      .get("/api/portal/runtime-options")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      modes: [{ id: "standard", label: "通用助手" }],
      workspaces: [
        { id: "/workspace/default", label: "default", isDefault: true },
        { id: "/workspace/shared", label: "shared", isDefault: false }
      ],
      canUpload: true,
      defaults: {
        mode: "standard",
        workspace: "/workspace/default"
      }
    });
  });
});

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
    throw new Error("not used in portal router tests");
  }

  seed(user: AuthenticatedUser): void {
    this.users.set(user.id, user);
  }
}

type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  sourceType: string;
  rootPath?: string;
};

type KnowledgeSetRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  sourceType: string;
  rootPath?: string;
};

type WorkspaceBindingRecord = {
  workspaceId: string;
  knowledgeSetId: string;
  mountType: string;
};

class FakeWorkspaceRepository {
  constructor(readonly records: WorkspaceRecord[]) {}

  async list(): Promise<WorkspaceRecord[]> {
    return structuredClone(this.records);
  }
}

class FakeKnowledgeSetRepository {
  constructor(
    readonly records: KnowledgeSetRecord[],
    readonly bindings: WorkspaceBindingRecord[]
  ) {}

  async list(): Promise<KnowledgeSetRecord[]> {
    return structuredClone(this.records);
  }

  async listWorkspaceBindings(workspaceId: string): Promise<WorkspaceBindingRecord[]> {
    return structuredClone(this.bindings.filter((binding) => binding.workspaceId === workspaceId));
  }
}

class FakeResourcePolicyDb {
  constructor(
    readonly rows: Array<{
      id: string;
      organizationId: string | null;
      subjectType: "role" | "department" | "user";
      subjectId: string;
      resourceType: "workspace" | "knowledge_set";
      resourceId: string;
      effect: "allow" | "deny";
      createdAt: Date;
      updatedAt: Date;
    }>
  ) {}

  readonly resourcePolicy = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: {
        resourceType?: "workspace" | "knowledge_set";
        OR?: Array<{ subjectType: "role" | "department" | "user"; subjectId: string }>;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.rows.filter((item) => {
        if (where?.resourceType && item.resourceType !== where.resourceType) {
          return false;
        }
        if (where?.OR?.length) {
          return where.OR.some(
            (subject) => item.subjectType === subject.subjectType && item.subjectId === subject.subjectId
          );
        }
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    }
  };
}

function buildPortalResourcesApp() {
  const users = new FakeUserRepository();
  const user = makeUser({ id: "employee-1", role: "employee" });
  users.seed(user);

  const workspaces = new FakeWorkspaceRepository([
    { id: "ws-docs", name: "Docs", slug: "docs", status: "active", sourceType: "filesystem", rootPath: "/srv/docs" },
    { id: "ws-secret", name: "Secret", slug: "secret", status: "active", sourceType: "filesystem", rootPath: "/srv/secret" },
    { id: "ws-inactive", name: "Inactive", slug: "inactive", status: "inactive", sourceType: "filesystem", rootPath: "/srv/inactive" }
  ]);

  const knowledgeSets = new FakeKnowledgeSetRepository(
    [
      { id: "ks-faq", name: "FAQ", slug: "faq", status: "active", sourceType: "managed_upload" },
      { id: "ks-runbook", name: "Runbooks", slug: "runbooks", status: "active", sourceType: "managed_upload" },
      { id: "ks-secret", name: "Secret Docs", slug: "secret-docs", status: "active", sourceType: "managed_upload" },
      { id: "ks-inactive", name: "Inactive Docs", slug: "inactive-docs", status: "inactive", sourceType: "managed_upload" }
    ],
    [
      { workspaceId: "ws-docs", knowledgeSetId: "ks-faq", mountType: "default" },
      { workspaceId: "ws-docs", knowledgeSetId: "ks-runbook", mountType: "optional" },
      { workspaceId: "ws-docs", knowledgeSetId: "ks-secret", mountType: "optional" },
      { workspaceId: "ws-docs", knowledgeSetId: "ks-inactive", mountType: "optional" },
      { workspaceId: "ws-secret", knowledgeSetId: "ks-faq", mountType: "default" }
    ]
  );

  const policies = new PolicyService(
    new ResourcePolicyRepository(
      new FakeResourcePolicyDb([
        {
          id: "policy-ws-docs",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "ws-docs",
          effect: "allow",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        },
        {
          id: "policy-ws-secret",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "ws-secret",
          effect: "deny",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        },
        {
          id: "policy-ks-faq",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "knowledge_set",
          resourceId: "ks-faq",
          effect: "allow",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        },
        {
          id: "policy-ks-runbook",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "knowledge_set",
          resourceId: "ks-runbook",
          effect: "allow",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        },
        {
          id: "policy-ks-secret",
          organizationId: null,
          subjectType: "user",
          subjectId: "employee-1",
          resourceType: "knowledge_set",
          resourceId: "ks-secret",
          effect: "deny",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        },
        {
          id: "policy-ks-inactive",
          organizationId: null,
          subjectType: "role",
          subjectId: "employee",
          resourceType: "knowledge_set",
          resourceId: "ks-inactive",
          effect: "allow",
          createdAt: new Date("2026-03-27T00:00:00.000Z"),
          updatedAt: new Date("2026-03-27T00:00:00.000Z")
        }
      ]) as never
    )
  );

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
          throw new Error("not used in portal router tests");
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
          return { state: "state", nonce: "nonce", cookie: "agent_studio_session_oauth_state=state" };
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
      users: { count: async () => 0 },
      threads: { count: async () => 0 },
      sessions: { countActive: async () => 0 },
      zendesk: {
        async getOverview() {
          return {
            ready: false,
            missing: [],
            settings: {
              enabled: false,
              hasZendeskApiToken: false,
              hasWebhookSigningSecret: false,
              lastValidatedAt: null
            }
          } as never;
        }
      }
    }),
    portalRouter: createPortalRouter({
      workspaceWhitelist: ["/workspace/default", "/workspace/shared"],
      defaultWorkspace: "/workspace/default"
    }),
    resourcesPortalRouter: createResourcesPortalRouter({
      workspaces: workspaces as never,
      knowledgeSets: knowledgeSets as never,
      policies,
      listDepartmentIdsForUser: async () => []
    }),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: express.Router()
  });

  return { app, cookies, user };
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
