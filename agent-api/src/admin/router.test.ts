import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAuthRouter } from "../auth/router.js";
import { createCurrentUserMiddleware } from "../auth/current-user.js";
import { createSessionCookieManager } from "../auth/session-cookie.js";
import { registerCommonApiRoutes } from "../app-routes.js";
import { createAdminRouter } from "./router.js";
import { ZendeskSettingsStore } from "../integrations/zendesk/settings-store.js";
import { ZendeskIntegrationService } from "../integrations/zendesk/service.js";
import { createPortalRouter } from "../portal/router.js";
import { IntegrationRepository } from "../persistence/integration-repository.js";
import type { DingTalkClient } from "../auth/dingtalk.js";
import type { AuthenticatedUser, UserRecord, UserRepositoryLike } from "../persistence/user-repository.js";
import { DepartmentRepository } from "../persistence/department-repository.js";
import { DepartmentMembershipRepository } from "../persistence/department-membership-repository.js";
import { SyncJobRepository } from "../persistence/sync-job-repository.js";
import { UserRepository } from "../persistence/user-repository.js";
import { createMonitoringRouter } from "./monitoring-router.js";
import { createModeAdminRouter } from "../resources/mode-admin-router.js";

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

  async updateLocalSettings(input: {
    userId: string;
    role: string;
    manualDisabled: boolean;
    adminNote?: string | null;
  }): Promise<UserRecord> {
    const existing = this.users.get(input.userId);
    if (!existing) {
      throw new Error("user 不存在");
    }

    const updated: AuthenticatedUser = {
      ...existing,
      role: input.role,
      status: input.manualDisabled ? "disabled" : "active",
      updatedAt: new Date().toISOString()
    };
    this.users.set(updated.id, updated);

    return {
      ...updated,
      statusSource: input.manualDisabled ? "manual_disable" : "sync",
      syncState: input.manualDisabled ? "disabled" : "active",
      manualDisabled: input.manualDisabled,
      adminNote: input.adminNote ?? undefined,
      lastSyncedAt: undefined
    };
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
  modeAdminRouter?: Router;
}) {
  const dingtalkClient: DingTalkClient = {
    async exchangeCode() {
      throw new Error("not used in admin router tests");
    },
    async listDepartments() {
      throw new Error("not used in admin router tests");
    },
    async listDepartmentUsers() {
      throw new Error("not used in admin router tests");
    },
    async getUser() {
      throw new Error("not used in admin router tests");
    }
  };
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
      dingtalkClient,
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
    modeAdminRouter: options?.modeAdminRouter,
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

type FakeAdminUserRow = {
  id: string;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  status: string | null;
  statusSource: string | null;
  syncState: string | null;
  manualDisabled: boolean;
  adminNote: string | null;
  lastSyncedAt: Date | null;
  dingtalkOpenId: string | null;
  dingtalkUserId: string | null;
  dingtalkCorpId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeAdminDepartmentRow = {
  id: string;
  organizationId: string | null;
  externalId: string;
  name: string;
  parentDepartmentId: string | null;
  sortOrder: number;
  status: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeAdminMembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary: boolean;
  source: string;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeAdminSyncJobRow = {
  id: string;
  organizationId: string | null;
  provider: string;
  scopeType: string;
  scopeExternalId: string | null;
  status: string;
  triggerType: string;
  triggeredByUserId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  summary: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type FakeAdminSyncEventRow = {
  id: string;
  syncJobId: string;
  level: string;
  eventType: string;
  message: string;
  payload: unknown;
  createdAt: Date;
};

type FakeAdminSyncSnapshotRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  scopeType: string;
  scopeExternalId: string | null;
  snapshotPayload: unknown;
  createdAt: Date;
};

type FakeAdminSyncDiffRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  entityExternalId: string | null;
  changeType: string;
  beforePayload: unknown;
  afterPayload: unknown;
  createdAt: Date;
};

type FakeAdminSeed = {
  users?: FakeAdminUserRow[];
  roles?: Array<{ id: string; slug: string; name: string; isSystem: boolean; isActive: boolean }>;
  userRoles?: Array<{ userId: string; roleId: string; isPrimary: boolean; createdAt?: Date }>;
  departments?: FakeAdminDepartmentRow[];
  memberships?: FakeAdminMembershipRow[];
  jobs?: FakeAdminSyncJobRow[];
  events?: FakeAdminSyncEventRow[];
  snapshots?: FakeAdminSyncSnapshotRow[];
  diffs?: FakeAdminSyncDiffRow[];
};

class FakeAdminDb {
  private userCounter = 0;
  private departmentCounter = 0;
  private membershipCounter = 0;
  private jobCounter = 0;
  private eventCounter = 0;
  private snapshotCounter = 0;
  private diffCounter = 0;

  constructor(
    readonly users: FakeAdminUserRow[] = [],
    readonly roles: Array<{ id: string; slug: string; name: string; isSystem: boolean; isActive: boolean }> = [],
    readonly userRoles: Array<{ userId: string; roleId: string; isPrimary: boolean; createdAt: Date }> = [],
    readonly departments: FakeAdminDepartmentRow[] = [],
    readonly memberships: FakeAdminMembershipRow[] = [],
    readonly jobs: FakeAdminSyncJobRow[] = [],
    readonly events: FakeAdminSyncEventRow[] = [],
    readonly snapshots: FakeAdminSyncSnapshotRow[] = [],
    readonly diffs: FakeAdminSyncDiffRow[] = []
  ) {}

  static fromSeed(seed: FakeAdminSeed = {}): FakeAdminDb {
    return new FakeAdminDb(
      seed.users ? structuredClone(seed.users) : [],
      seed.roles ? structuredClone(seed.roles) : [],
      (seed.userRoles ?? []).map((item) => ({
        ...structuredClone(item),
        createdAt: item.createdAt ?? new Date("2026-03-29T00:00:00.000Z")
      })),
      seed.departments ? structuredClone(seed.departments) : [],
      seed.memberships ? structuredClone(seed.memberships) : [],
      seed.jobs ? structuredClone(seed.jobs) : [],
      seed.events ? structuredClone(seed.events) : [],
      seed.snapshots ? structuredClone(seed.snapshots) : [],
      seed.diffs ? structuredClone(seed.diffs) : []
    );
  }

  readonly user = {
    count: async () => this.users.length,
    findUnique: async ({ where }: { where: { id?: string; externalId?: string; email?: string; dingtalkUserId?: string } }) => {
      const row = this.users.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        if (where.email) return item.email === where.email;
        if (where.dingtalkUserId) return item.dingtalkUserId === where.dingtalkUserId;
        return false;
      });
      return row ? structuredClone(row) : null;
    },
    findMany: async ({ where, orderBy }: { where?: { status?: string; role?: string }; orderBy?: { createdAt?: "asc" | "desc" } } = {}) => {
      const rows = this.users.filter((item) => {
        if (where?.status && item.status !== where.status) return false;
        if (where?.role && item.role !== where.role) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAdminUserRow = {
        id: typeof data.id === "string" ? data.id : `user-${++this.userCounter}`,
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        email: typeof data.email === "string" ? data.email : null,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        role: typeof data.role === "string" ? data.role : null,
        status: typeof data.status === "string" ? data.status : null,
        statusSource: typeof data.statusSource === "string" ? data.statusSource : null,
        syncState: typeof data.syncState === "string" ? data.syncState : null,
        manualDisabled: typeof data.manualDisabled === "boolean" ? data.manualDisabled : false,
        adminNote: typeof data.adminNote === "string" ? data.adminNote : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        dingtalkOpenId: typeof data.dingtalkOpenId === "string" ? data.dingtalkOpenId : null,
        dingtalkUserId: typeof data.dingtalkUserId === "string" ? data.dingtalkUserId : null,
        dingtalkCorpId: typeof data.dingtalkCorpId === "string" ? data.dingtalkCorpId : null,
        createdAt: now,
        updatedAt: now
      };
      this.users.push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.users.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("user not found");
      }
      Object.assign(row, structuredClone(data));
      row.updatedAt = new Date();
      return structuredClone(row);
    }
  };

  readonly userRole = {
    findMany: async ({
      where,
      include,
      orderBy
    }: {
      where?: { userId?: string; roleId?: string };
      include?: { role?: boolean };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.userRoles
        .filter((item) => {
          if (where?.userId && item.userId !== where.userId) return false;
          if (where?.roleId && item.roleId !== where.roleId) return false;
          return true;
        })
        .map((item) => ({
          ...item,
          role: include?.role ? this.roles.find((role) => role.id === item.roleId) ?? null : undefined
        }));
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    }
  };

  readonly department = {
    findUnique: async ({ where }: { where: { id?: string; externalId?: string } }) => {
      const row = this.departments.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        return false;
      });
      return row ? structuredClone(row) : null;
    },
    findMany: async ({ orderBy }: { orderBy?: { sortOrder?: "asc" | "desc"; createdAt?: "asc" | "desc" } } = {}) => {
      const rows = [...this.departments];
      rows.sort((left, right) => {
        if (orderBy?.sortOrder && left.sortOrder !== right.sortOrder) {
          const diff = left.sortOrder - right.sortOrder;
          return orderBy.sortOrder === "asc" ? diff : -diff;
        }
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAdminDepartmentRow = {
        id: typeof data.id === "string" ? data.id : `department-${++this.departmentCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        externalId: typeof data.externalId === "string" ? data.externalId : "",
        name: typeof data.name === "string" ? data.name : "",
        parentDepartmentId: typeof data.parentDepartmentId === "string" ? data.parentDepartmentId : null,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
        status: typeof data.status === "string" ? data.status : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        createdAt: now,
        updatedAt: now
      };
      this.departments.push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.departments.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("department not found");
      }
      Object.assign(row, structuredClone(data));
      row.updatedAt = new Date();
      return structuredClone(row);
    }
  };

  readonly departmentMembership = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { userId?: string; departmentId?: { in: string[] } };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) => {
      const rows = this.memberships.filter((item) => {
        if (where?.userId && item.userId !== where.userId) return false;
        if (where?.departmentId?.in && !where.departmentId.in.includes(item.departmentId)) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    deleteMany: async ({
      where
    }: {
      where: { userId: string; source?: string; departmentId?: { in: string[] } };
    }) => {
      const before = this.memberships.length;
      this.memberships.splice(
        0,
        this.memberships.length,
        ...this.memberships.filter((item) => {
          if (item.userId !== where.userId) return true;
          if (where.source && item.source !== where.source) return true;
          if (where.departmentId?.in && !where.departmentId.in.includes(item.departmentId)) return true;
          return false;
        })
      );
      return { count: before - this.memberships.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAdminMembershipRow = {
        id: typeof data.id === "string" ? data.id : `membership-${++this.membershipCounter}`,
        userId: typeof data.userId === "string" ? data.userId : "",
        departmentId: typeof data.departmentId === "string" ? data.departmentId : "",
        isPrimary: typeof data.isPrimary === "boolean" ? data.isPrimary : false,
        source: typeof data.source === "string" ? data.source : "sync",
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        createdAt: now,
        updatedAt: now
      };
      this.memberships.push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.memberships.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("membership not found");
      }
      Object.assign(row, structuredClone(data));
      row.updatedAt = new Date();
      return structuredClone(row);
    }
  };

  readonly syncJob = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      return row ? structuredClone(row) : null;
    },
    findMany: async ({ orderBy, take }: { orderBy?: { createdAt?: "asc" | "desc" }; take?: number } = {}) => {
      const rows = [...this.jobs];
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "asc" ? diff : -diff;
      });
      return structuredClone(typeof take === "number" ? rows.slice(0, take) : rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAdminSyncJobRow = {
        id: typeof data.id === "string" ? data.id : `sync-job-${++this.jobCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        provider: typeof data.provider === "string" ? data.provider : "dingtalk",
        scopeType: typeof data.scopeType === "string" ? data.scopeType : "",
        scopeExternalId: typeof data.scopeExternalId === "string" ? data.scopeExternalId : null,
        status: typeof data.status === "string" ? data.status : "pending",
        triggerType: typeof data.triggerType === "string" ? data.triggerType : "",
        triggeredByUserId: typeof data.triggeredByUserId === "string" ? data.triggeredByUserId : null,
        startedAt: data.startedAt instanceof Date ? data.startedAt : null,
        finishedAt: data.finishedAt instanceof Date ? data.finishedAt : null,
        summary: data.summary,
        createdAt: now,
        updatedAt: now
      };
      this.jobs.push(row);
      return structuredClone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("sync job not found");
      }
      Object.assign(row, structuredClone(data));
      row.updatedAt = new Date();
      return structuredClone(row);
    }
  };

  readonly syncJobEvent = {
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.events.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeAdminSyncEventRow = {
        id: typeof data.id === "string" ? data.id : `sync-event-${++this.eventCounter}`,
        syncJobId: typeof data.syncJobId === "string" ? data.syncJobId : "",
        level: typeof data.level === "string" ? data.level : "",
        eventType: typeof data.eventType === "string" ? data.eventType : "",
        message: typeof data.message === "string" ? data.message : "",
        payload: data.payload,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.events.push(row);
      return structuredClone(row);
    }
  };

  readonly syncSnapshot = {
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.snapshots.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    deleteMany: async ({ where }: { where: { syncJobId: string } }) => {
      const before = this.snapshots.length;
      this.snapshots.splice(0, this.snapshots.length, ...this.snapshots.filter((item) => item.syncJobId !== where.syncJobId));
      return { count: before - this.snapshots.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeAdminSyncSnapshotRow = {
        id: typeof data.id === "string" ? data.id : `sync-snapshot-${++this.snapshotCounter}`,
        syncJobId: typeof data.syncJobId === "string" ? data.syncJobId : "",
        entityType: typeof data.entityType === "string" ? data.entityType : "",
        scopeType: typeof data.scopeType === "string" ? data.scopeType : "",
        scopeExternalId: typeof data.scopeExternalId === "string" ? data.scopeExternalId : null,
        snapshotPayload: data.snapshotPayload,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.snapshots.push(row);
      return structuredClone(row);
    }
  };

  readonly syncDiff = {
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.diffs.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return structuredClone(rows);
    },
    deleteMany: async ({ where }: { where: { syncJobId: string } }) => {
      const before = this.diffs.length;
      this.diffs.splice(0, this.diffs.length, ...this.diffs.filter((item) => item.syncJobId !== where.syncJobId));
      return { count: before - this.diffs.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeAdminSyncDiffRow = {
        id: typeof data.id === "string" ? data.id : `sync-diff-${++this.diffCounter}`,
        syncJobId: typeof data.syncJobId === "string" ? data.syncJobId : "",
        entityType: typeof data.entityType === "string" ? data.entityType : "",
        entityExternalId: typeof data.entityExternalId === "string" ? data.entityExternalId : null,
        changeType: typeof data.changeType === "string" ? data.changeType : "",
        beforePayload: data.beforePayload,
        afterPayload: data.afterPayload,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.diffs.push(row);
      return structuredClone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeAdminDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function makeAdminSeedUser(overrides: Partial<AuthenticatedUser> = {}): FakeAdminUserRow {
  const now = new Date("2026-03-29T00:00:00.000Z");
  return {
    id: overrides.id ?? "user-1",
    externalId: overrides.externalId ?? "ding-user-1",
    email: overrides.email ?? "user@example.com",
    displayName: overrides.displayName ?? "User One",
    role: overrides.role ?? "employee",
    status: overrides.status ?? "active",
    statusSource: (overrides as { statusSource?: string }).statusSource ?? "sync",
    syncState: (overrides as { syncState?: string }).syncState ?? "active",
    manualDisabled: (overrides as { manualDisabled?: boolean }).manualDisabled ?? false,
    adminNote: (overrides as { adminNote?: string }).adminNote ?? null,
    lastSyncedAt: now,
    dingtalkOpenId: (overrides as { dingtalkOpenId?: string }).dingtalkOpenId ?? "ding-open-1",
    dingtalkUserId: (overrides as { dingtalkUserId?: string }).dingtalkUserId ?? "ding-user-1",
    dingtalkCorpId: (overrides as { dingtalkCorpId?: string }).dingtalkCorpId ?? "ding-corp-1",
    createdAt: now,
    updatedAt: now
  };
}

function makeAdminSeedUserFromAuth(user: AuthenticatedUser): FakeAdminUserRow {
  return makeAdminSeedUser({
    id: user.id,
    externalId: user.externalId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status
  });
}

function makeAdminDepartmentSeed(
  id: string,
  externalId: string,
  name: string,
  parentDepartmentId: string | null = null
): FakeAdminDepartmentRow {
  const now = new Date("2026-03-29T00:00:00.000Z");
  return {
    id,
    organizationId: null,
    externalId,
    name,
    parentDepartmentId,
    sortOrder: 0,
    status: "active",
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function makeAdminMembershipSeed(
  id: string,
  userId: string,
  departmentId: string,
  isPrimary = false,
  source = "sync"
): FakeAdminMembershipRow {
  const now = new Date("2026-03-29T00:00:00.000Z");
  return {
    id,
    userId,
    departmentId,
    isPrimary,
    source,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function makeAdminJobSeed(): FakeAdminSyncJobRow {
  const now = new Date("2026-03-29T01:00:00.000Z");
  return {
    id: "job-1",
    organizationId: null,
    provider: "dingtalk",
    scopeType: "full",
    scopeExternalId: null,
    status: "succeeded",
    triggerType: "manual",
    triggeredByUserId: "admin-1",
    startedAt: now,
    finishedAt: new Date("2026-03-29T01:01:00.000Z"),
    summary: { total: 1 },
    createdAt: now,
    updatedAt: new Date("2026-03-29T01:01:00.000Z")
  };
}

function buildAdminApp(options?: {
  user?: AuthenticatedUser;
  seed?: FakeAdminSeed;
  counts?: { users: number; threads: number; activeSessions: number };
  syncResult?: { jobId: string; status: "succeeded" | "failed" };
  syncError?: Error;
  orgSyncConfig?: { enabled: boolean; intervalMinutes: number };
}) {
  const seed = options?.seed ?? {};
  const adminUser = options?.user ?? makeUser({ id: "admin-1", role: "admin" });
  const seedUsers = [...(seed.users ?? [makeAdminSeedUser()])];
  if (!seedUsers.some((row) => row.id === adminUser.id)) {
    seedUsers.unshift(makeAdminSeedUserFromAuth(adminUser));
  }
  const db = FakeAdminDb.fromSeed({
    users: seedUsers,
    roles: seed.roles ?? [],
    userRoles: seed.userRoles ?? [],
    departments: seed.departments ?? [makeAdminDepartmentSeed("department-1", "dept-1", "研发")],
    memberships:
      seed.memberships ?? [makeAdminMembershipSeed("membership-1", "user-1", "department-1", true)],
    jobs: seed.jobs ?? [makeAdminJobSeed()],
    events:
      seed.events ?? [
        {
          id: "event-1",
          syncJobId: "job-1",
          level: "info",
          eventType: "remote_fetch_started",
          message: "Organization fetch started",
          payload: { scopeType: "full" },
          createdAt: new Date("2026-03-29T01:00:01.000Z")
        }
      ],
    snapshots: seed.snapshots ?? [],
    diffs:
      seed.diffs ?? [
        {
          id: "diff-1",
          syncJobId: "job-1",
          entityType: "user",
          entityExternalId: "ding-u1",
          changeType: "updated",
          beforePayload: { status: "disabled" },
          afterPayload: { status: "active" },
          createdAt: new Date("2026-03-29T01:00:02.000Z")
        }
      ]
  });

  const users = new UserRepository(db as never);
  const departments = new DepartmentRepository(db as never);
  const memberships = new DepartmentMembershipRepository(db as never);
  const syncJobs = new SyncJobRepository(db as never);
  const cookies = createSessionCookieManager({
    cookieName: "agent_studio_session",
    secret: "test-session-secret",
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    secure: false,
    sameSite: "lax"
  });

  const app = express();
  app.use(express.json());

  const syncRun = vi.fn().mockImplementation(async () => {
    if (options?.syncError) {
      throw options.syncError;
    }
    return options?.syncResult ?? { jobId: "job-1", status: "succeeded" as const };
  });

  const adminRouterOptions: any = {
    users: { count: async () => options?.counts?.users ?? db.users.length },
    threads: { count: async () => options?.counts?.threads ?? 0 },
    sessions: { countActive: async () => options?.counts?.activeSessions ?? 0 },
    zendesk: {
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
        setup: { webhookUrl: "", payloadExample: "", triggers: [] },
        runs: []
      })
    },
    repositories: {
      users,
      departments,
      memberships,
      syncJobs
    },
    db,
    syncService: { run: syncRun },
    quotaChecks: {
      evaluate: async () => ({ decision: "allow", observedValue: 0 })
    },
    alerts: {
      evaluateQuotaResult: async () => undefined
    },
    orgSyncConfig: options?.orgSyncConfig ?? { enabled: true, intervalMinutes: 24 * 60 }
  };

  registerCommonApiRoutes(app, {
    currentUserMiddleware: createCurrentUserMiddleware({ users, cookies }),
    authRouter: createAuthRouter({
      users,
      cookies,
      dingtalkClient: {
        async exchangeCode() {
          throw new Error("not used in admin router tests");
        },
        async listDepartments() {
          throw new Error("not used in admin router tests");
        },
        async listDepartmentUsers() {
          throw new Error("not used in admin router tests");
        },
        async getUser() {
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
    adminRouter: createAdminRouter(adminRouterOptions),
    portalRouter: createPortalRouter({
      runtimeOptions: {
        resolve: async () => ({
          modes: [],
          workspaces: [],
          canUpload: false,
          defaults: { mode: "mode-code", workspace: "/workspace/default" }
        })
      },
      listDepartmentIdsForUser: async () => []
    }),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: express.Router()
  });

  return {
    app,
    cookies,
    user: adminUser,
    db,
    users,
    departments,
    memberships,
    syncJobs,
    syncRun
  };
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

  it("mounts monitoring admin routes directly from the admin router without disturbing overview", async () => {
    const user = makeUser({ id: "admin-1", role: "admin" });

    const monitoringRouter = createMonitoringRouter({
      requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
      resourceAccessLogs: { list: async () => [] },
      usageEvents: { list: async () => [] },
      usageRollups: { list: async () => [] },
      quotaPolicies: {
        list: async () => [],
        upsert: async (input: Record<string, unknown>) => ({ id: "policy-1", ...input }),
        getById: async () => null,
        update: async ({ changes }: { id: string; changes: Record<string, unknown> }) => ({ id: "policy-1", ...changes })
      },
      costProfiles: {
        listActive: async () => [],
        upsert: async (input: Record<string, unknown>) => ({ id: "profile-1", ...input }),
        getById: async () => null,
        update: async ({ changes }: { id: string; changes: Record<string, unknown> }) => ({ id: "profile-1", ...changes })
      },
      alertRules: {
        list: async () => [],
        create: async (input: Record<string, unknown>) => ({ id: "rule-1", ...input }),
        getById: async () => null,
        update: async ({ changes }: { id: string; changes: Record<string, unknown> }) => ({ id: "rule-1", ...changes })
      },
      alertEvents: {
        list: async () => [],
        getById: async () => null,
        update: async ({ changes }: { id: string; changes: Record<string, unknown> }) => ({ id: "event-1", ...changes })
      },
      notificationRecords: { list: async () => [] }
    } as any);

    const appWithMonitoring = express();
    appWithMonitoring.use(express.json());
    registerCommonApiRoutes(appWithMonitoring, {
      currentUserMiddleware: (req, _res, next) => {
        req.currentUser = {
          id: user.id,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };
        next();
      },
      authRouter: Router(),
      adminRouter: createAdminRouter({
        users: { count: async () => 1 },
        threads: { count: async () => 2 },
        sessions: { countActive: async () => 3 },
        zendesk: {
          getOverview: async () => ({
            ready: false,
            missing: [],
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
            setup: { webhookUrl: "", payloadExample: "", triggers: [] },
            runs: []
          })
        },
        monitoringRouter
      }),
      portalRouter: Router(),
      serviceTokenMiddleware: (_req, _res, next) => next(),
      zendeskRouter: Router()
    });

    await request(appWithMonitoring).get("/api/admin/overview").expect(200);
    const monitoringResponse = await request(appWithMonitoring).get("/api/admin/monitoring/overview");

    expect(monitoringResponse.status).toBe(200);
    expect(monitoringResponse.body.overview.totalEstimatedCost).toBeDefined();
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

  it("keeps mode admin routes behind the admin auth guard", async () => {
    const { app, cookies, user } = buildApp({
      user: makeUser({ id: "employee-1", role: "employee" }),
      modeAdminRouter: createModeAdminRouter({
        runProfiles: {
          list: async () => [],
          create: async () => ({ id: "run-profile-1" }),
          get: async () => undefined,
          update: async () => ({ id: "run-profile-1" })
        } as never,
        skillPackages: {
          list: async () => [],
          create: async () => ({ id: "skill-package-1" }),
          get: async () => undefined,
          update: async () => ({ id: "skill-package-1" }),
          replaceItems: async () => ({ id: "skill-package-1" })
        } as never,
        agentModes: {
          list: async () => [],
          create: async () => ({ id: "agent-mode-1" }),
          get: async () => undefined,
          update: async () => ({ id: "agent-mode-1" }),
          replaceSkillPackages: async () => ({ id: "agent-mode-1" }),
          replaceWorkspaceRules: async () => ({ id: "agent-mode-1" }),
          replaceInstructionSources: async () => ({ id: "agent-mode-1" })
        } as never
      })
    });

    const response = await request(app).get("/api/admin/run-profiles").set("Cookie", cookies.create(user.id));

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

  it("triggers a full org sync for admin users", async () => {
    const { app, cookies, user, syncRun } = buildAdminApp();

    const response = await request(app)
      .post("/api/admin/org-sync/jobs")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(202);
    expect(syncRun).toHaveBeenCalledWith({
      scopeType: "full",
      triggerType: "manual",
      triggeredByUserId: user.id
    });
  });

  it("updates only local user settings", async () => {
    const { app, cookies, user } = buildAdminApp();

    const response = await request(app)
      .patch("/api/admin/users/user-1/local-settings")
      .set("Cookie", cookies.create(user.id))
      .send({
        role: "admin",
        manualDisabled: true,
        adminNote: "temporary hold"
      });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      local: {
        role: "admin",
        manualDisabled: true,
        adminNote: "temporary hold"
      }
    });
  });

  it.each(["super_admin", "team_lead"])("rejects unsupported local user role %s", async (role) => {
    const { app, cookies, user } = buildAdminApp();

    const response = await request(app)
      .patch("/api/admin/users/user-1/local-settings")
      .set("Cookie", cookies.create(user.id))
      .send({
        role,
        manualDisabled: false
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ detail: "role 不受支持" });
  });

  it("returns persisted user detail with synced, local, effective, and assigned roles", async () => {
    const { app, cookies, user } = buildAdminApp({
      seed: {
        roles: [{ id: "role-admin", slug: "admin", name: "Admin", isSystem: true, isActive: true }],
        userRoles: [{ userId: "user-1", roleId: "role-admin", isPrimary: true }]
      }
    });

    const response = await request(app)
      .get("/api/admin/users/user-1")
      .set("Cookie", cookies.create(user.id));

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual(
      expect.objectContaining({
        assignedRoles: [{ roleId: "role-admin", slug: "admin", name: "Admin", isPrimary: true }],
        primaryRole: { roleId: "role-admin", slug: "admin", name: "Admin" },
        synced: expect.objectContaining({
          primaryDepartmentId: "dept-1"
        }),
        local: expect.any(Object),
        effective: expect.any(Object)
      })
    );
  });

  it("returns department tree, department detail, department users, and org sync config", async () => {
    const { app, cookies, user } = buildAdminApp({
      seed: {
        departments: [
          makeAdminDepartmentSeed("department-1", "dept-1", "研发"),
          makeAdminDepartmentSeed("department-2", "dept-2", "平台", "department-1")
        ],
        memberships: [
          makeAdminMembershipSeed("membership-1", "user-1", "department-1", true),
          makeAdminMembershipSeed("membership-2", "admin-1", "department-2", true)
        ]
      }
    });

    const treeResponse = await request(app)
      .get("/api/admin/departments/tree")
      .set("Cookie", cookies.create(user.id));
    expect(treeResponse.status).toBe(200);
    expect(treeResponse.body.departments).toEqual([
      expect.objectContaining({
        id: "department-1",
        memberCount: 1,
        children: [
          expect.objectContaining({
            id: "department-2",
            memberCount: 1
          })
        ]
      })
    ]);

    const detailResponse = await request(app)
      .get("/api/admin/departments/department-1")
      .set("Cookie", cookies.create(user.id));
    expect(detailResponse.status).toBe(200);

    const usersResponse = await request(app)
      .get("/api/admin/departments/department-1/users")
      .set("Cookie", cookies.create(user.id));
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body.users).toEqual([
      expect.objectContaining({
        id: "user-1",
        synced: expect.objectContaining({
          primaryDepartmentId: "dept-1"
        })
      })
    ]);

    const configResponse = await request(app)
      .get("/api/admin/org-sync/config")
      .set("Cookie", cookies.create(user.id));
    expect(configResponse.status).toBe(200);
  });
});
