import { Router, type Request, type Response } from "express";

import { appConfig } from "../config.js";
import { createRequirePermission } from "../auth/permission-guard.js";
import { getDbClient } from "../db/client.js";
import { ZendeskIntegrationService } from "../integrations/zendesk/service.js";
import { createOrgSyncRouter } from "./org-sync-router.js";
import { DepartmentMembershipRepository, type DepartmentMembershipRepositoryDb } from "../persistence/department-membership-repository.js";
import { DepartmentRepository, type DepartmentRepositoryDb, type DepartmentTreeNode } from "../persistence/department-repository.js";
import { AdminAuditLogRepository } from "../persistence/admin-audit-log-repository.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import { UserRoleRepository } from "../persistence/user-role-repository.js";
import { SyncJobRepository, type SyncJobRepositoryDb } from "../persistence/sync-job-repository.js";
import { UserRepository, type UserRepositoryDb } from "../persistence/user-repository.js";
import { PermissionService } from "../rbac/permission-service.js";
import { createSystemSettingsRouter } from "../system-settings/router.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { SystemSettingsService } from "../system-settings/service.js";
import type { AlertEvaluationService } from "../operations/alert-evaluation-service.js";
import type { QuotaEvaluationService } from "../operations/quota-evaluation-service.js";

type AdminDb = UserRepositoryDb & DepartmentRepositoryDb & DepartmentMembershipRepositoryDb & SyncJobRepositoryDb;

type AdminRouterWithExtensions = Router & {
  systemSettingsRouter?: Router;
};

type UserRoleDbRow = {
  roleId: string;
  isPrimary: boolean;
  role?: {
    id: string;
    slug: string;
    name: string;
    isSystem: boolean;
    isActive: boolean;
  } | null;
};

type AdminRepositoryBundle = {
  users?: UserRepository;
  departments?: DepartmentRepository;
  memberships?: DepartmentMembershipRepository;
  syncJobs?: SyncJobRepository;
};

type AdminRouterOptions = {
  users: { count(): Promise<number> };
  threads: { count(): Promise<number> };
  sessions: { countActive(): Promise<number> };
  zendesk?: Pick<ZendeskIntegrationService, "getOverview">;
  db?: AdminDb;
  repositories?: AdminRepositoryBundle;
  monitoringRouter?: Router;
  syncService?: { run(input: { scopeType: "full" | "department" | "user"; scopeExternalId?: string; triggerType: "manual" | "scheduled"; triggeredByUserId?: string }): Promise<{ jobId: string; status: "succeeded" | "failed" }> };
  quotaChecks?: Pick<QuotaEvaluationService, "evaluate">;
  alerts?: Pick<AlertEvaluationService, "evaluateQuotaResult">;
  orgSyncConfig?: { enabled: boolean; intervalMinutes: number };
  broadcastRouter?: Router;
};

type UserRow = {
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
  lastSyncedAt: Date | string | null;
  dingtalkOpenId: string | null;
  dingtalkUserId: string | null;
  dingtalkCorpId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DepartmentRow = {
  id: string;
  organizationId: string | null;
  externalId: string;
  name: string;
  parentDepartmentId: string | null;
  sortOrder: number;
  status: string | null;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DepartmentMembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary: boolean;
  source: string;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AdminDetailUser = {
  id: string;
  synced: {
    displayName: string | null;
    email: string | null;
    dingtalkUserId: string | null;
    dingtalkOpenId: string | null;
    dingtalkCorpId: string | null;
    departmentIds: string[];
    primaryDepartmentId: string | null;
  };
  local: {
    role: string;
    manualDisabled: boolean;
    adminNote: string | null;
  };
  assignedRoles: Array<{
    roleId: string;
    slug: string;
    name: string;
    isPrimary: boolean;
  }>;
  primaryRole: {
    roleId: string;
    slug: string;
    name: string;
  } | null;
  effective: {
    status: string;
    statusSource: string;
    syncState: string;
    lastSyncedAt: string | null;
  };
};

const ADMIN_EDITABLE_ROLES = new Set(["employee", "admin"]);

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function isNotFoundError(error: unknown): boolean {
  const message = detailFromError(error).toLowerCase();
  return message.includes("不存在") || message.includes("not found");
}

async function resolveDepartmentExternalId(db: AdminDb, departmentId: string): Promise<string> {
  const row =
    (await db.department.findUnique({ where: { id: departmentId } })) ??
    (await db.department.findUnique({ where: { externalId: departmentId } }));
  return row?.externalId ?? departmentId;
}

async function buildUserDetail(db: AdminDb, row: UserRow): Promise<AdminDetailUser> {
  const memberships = (await db.departmentMembership.findMany({
    where: { userId: row.id },
    orderBy: { createdAt: "asc" }
  })) as DepartmentMembershipRow[];
  const departmentIds = [];
  let primaryDepartmentId: string | null = null;
  for (const membership of memberships) {
    const externalId = await resolveDepartmentExternalId(db, membership.departmentId);
    departmentIds.push(externalId);
    if (membership.isPrimary && !primaryDepartmentId) {
      primaryDepartmentId = externalId;
    }
  }

  const roleAssignments = typeof (db as AdminDb & { userRole?: { findMany(args: unknown): Promise<UserRoleDbRow[]> } }).userRole?.findMany === "function"
    ? await (db as AdminDb & { userRole: { findMany(args: unknown): Promise<UserRoleDbRow[]> } }).userRole.findMany({
        where: { userId: row.id },
        include: { role: true },
        orderBy: { createdAt: "asc" }
      })
    : [];
  const assignedRoles = roleAssignments
    .filter((assignment) => assignment.role)
    .map((assignment) => ({
      roleId: assignment.roleId,
      slug: assignment.role?.slug ?? "",
      name: assignment.role?.name ?? "",
      isPrimary: Boolean(assignment.isPrimary)
    }));
  const primaryAssignment = assignedRoles.find((assignment) => assignment.isPrimary) ?? null;

  return {
    id: row.id,
    synced: {
      displayName: trimOrUndefined(row.displayName) ?? null,
      email: trimOrUndefined(row.email) ?? null,
      dingtalkUserId: trimOrUndefined(row.dingtalkUserId) ?? null,
      dingtalkOpenId: trimOrUndefined(row.dingtalkOpenId) ?? null,
      dingtalkCorpId: trimOrUndefined(row.dingtalkCorpId) ?? null,
      departmentIds,
      primaryDepartmentId
    },
    local: {
      role: trimOrUndefined(row.role) ?? "employee",
      manualDisabled: Boolean(row.manualDisabled),
      adminNote: trimOrUndefined(row.adminNote) ?? null
    },
    assignedRoles,
    primaryRole: primaryAssignment
      ? {
          roleId: primaryAssignment.roleId,
          slug: primaryAssignment.slug,
          name: primaryAssignment.name
        }
      : null,
    effective: {
      status: trimOrUndefined(row.status) ?? "active",
      statusSource: trimOrUndefined(row.statusSource) ?? "sync",
      syncState: trimOrUndefined(row.syncState) ?? "active",
      lastSyncedAt: toIsoString(row.lastSyncedAt)
    }
  };
}

async function listUsers(db: AdminDb): Promise<AdminDetailUser[]> {
  const rows = (await db.user.findMany({ orderBy: { createdAt: "asc" } })) as UserRow[];
  const result: AdminDetailUser[] = [];
  for (const row of rows) {
    result.push(await buildUserDetail(db, row));
  }
  return result;
}

async function getUserById(db: AdminDb, userId: string): Promise<UserRow | null> {
  const normalized = trimOrUndefined(userId);
  if (!normalized) return null;
  return ((await db.user.findUnique({ where: { id: normalized } })) as UserRow | null) ?? null;
}

async function getDepartmentById(db: AdminDb, departmentId: string): Promise<DepartmentRow | null> {
  const normalized = trimOrUndefined(departmentId);
  if (!normalized) return null;
  return (
    ((await db.department.findUnique({ where: { id: normalized } })) as DepartmentRow | null) ??
    ((await db.department.findUnique({ where: { externalId: normalized } })) as DepartmentRow | null)
  );
}

async function attachMemberCount(db: AdminDb, node: DepartmentTreeNode): Promise<DepartmentTreeNode & { memberCount: number }> {
  const count = (await (db.departmentMembership as any).findMany({ where: { departmentId: { in: [node.id] } } })) as DepartmentMembershipRow[];
  const children = await Promise.all(node.children.map((child) => attachMemberCount(db, child)));
  return {
    ...node,
    memberCount: count.length,
    children
  };
}

async function listDepartmentUsers(db: AdminDb, departmentId: string): Promise<AdminDetailUser[]> {
  const memberships = (await (db.departmentMembership as any).findMany({
    where: { departmentId: { in: [departmentId] } },
    orderBy: { createdAt: "asc" }
  })) as DepartmentMembershipRow[];
  const users: AdminDetailUser[] = [];
  for (const membership of memberships) {
    const row = (await getUserById(db, membership.userId)) as UserRow | null;
    if (!row) continue;
    users.push(await buildUserDetail(db, row));
  }
  return users;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router() as AdminRouterWithExtensions;
  const zendesk = options.zendesk ?? new ZendeskIntegrationService();
  let cachedDb: AdminDb | null = options.db ?? null;
  let cachedRepositories: {
    users: UserRepository;
    departments: DepartmentRepository;
    memberships: DepartmentMembershipRepository;
    syncJobs: SyncJobRepository;
  } | null = options.repositories
    ? {
        users: options.repositories.users ?? new UserRepository((options.db ?? getDbClient()) as UserRepositoryDb),
        departments:
          options.repositories.departments ?? new DepartmentRepository((options.db ?? getDbClient()) as DepartmentRepositoryDb),
        memberships:
          options.repositories.memberships ??
          new DepartmentMembershipRepository((options.db ?? getDbClient()) as DepartmentMembershipRepositoryDb),
        syncJobs: options.repositories.syncJobs ?? new SyncJobRepository((options.db ?? getDbClient()) as SyncJobRepositoryDb)
      }
    : null;

  function getDbInstance(): AdminDb {
    cachedDb ??= options.db ?? (getDbClient() as unknown as AdminDb);
    return cachedDb;
  }

  function getRepositories() {
    if (!cachedRepositories) {
      const db = getDbInstance();
      cachedRepositories = {
        users: options.repositories?.users ?? new UserRepository(db as UserRepositoryDb),
        departments: options.repositories?.departments ?? new DepartmentRepository(db as DepartmentRepositoryDb),
        memberships:
          options.repositories?.memberships ?? new DepartmentMembershipRepository(db as DepartmentMembershipRepositoryDb),
        syncJobs: options.repositories?.syncJobs ?? new SyncJobRepository(db as SyncJobRepositoryDb)
      };
    }
    return cachedRepositories;
  }

  let systemSettingsRouter: Router | undefined;
  if (options.db || process.env.DATABASE_URL) {
    Object.defineProperty(router, "systemSettingsRouter", {
      configurable: true,
      enumerable: true,
      get() {
        if (!systemSettingsRouter) {
          const db = getDbInstance();
          const permissionService = new PermissionService({
            roles: new RoleRepository(db as never),
            userRoles: new UserRoleRepository(db as never),
            rolePermissions: new RolePermissionRepository(db as never)
          });
          const requirePermission = createRequirePermission(permissionService);
          systemSettingsRouter = createSystemSettingsRouter({
            service: new SystemSettingsService({
              repository: new SystemSettingsRepository(db as never),
              audits: new AdminAuditLogRepository(db as never)
            }),
            requirePermission
          });
        }
        return systemSettingsRouter;
      }
    });
  }

  router.get("/overview", async (_req: Request, res: Response) => {
    try {
      const [users, threads, activeSessions, zendeskOverview] = await Promise.all([
        options.users.count(),
        options.threads.count(),
        options.sessions.countActive(),
        zendesk.getOverview()
      ]);

      res.json({
        counts: {
          users,
          threads,
          activeSessions
        },
        integrations: {
          zendesk: {
            enabled: zendeskOverview.settings.enabled,
            ready: zendeskOverview.ready,
            missing: zendeskOverview.missing,
            hasZendeskApiToken: zendeskOverview.settings.hasZendeskApiToken,
            hasWebhookSigningSecret: zendeskOverview.settings.hasWebhookSigningSecret,
            lastValidatedAt: zendeskOverview.settings.lastValidatedAt ?? null
          }
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载管理概览失败";
      res.status(500).json({ detail });
    }
  });

  router.use(
    "/org-sync",
    createOrgSyncRouter({
      syncService: options.syncService,
      syncJobs: options.repositories?.syncJobs,
      db: options.db,
      quotaChecks: options.quotaChecks,
      alerts: options.alerts
    })
  );

  router.use(options.monitoringRouter ?? Router());

  router.get("/users", async (_req: Request, res: Response) => {
    try {
      res.json({ users: await listUsers(getDbInstance()) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/users/:userId", async (req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const row = await getUserById(db, req.params.userId);
      if (!row) {
        res.status(404).json({ detail: "user 不存在" });
        return;
      }
      res.json({ user: await buildUserDetail(db, row) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 500).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/users/:userId/local-settings", async (req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const repositories = getRepositories();
      const existing = await getUserById(db, req.params.userId);
      if (!existing) {
        res.status(404).json({ detail: "user 不存在" });
        return;
      }

      const role = trimOrUndefined(req.body?.role) ?? existing.role ?? "employee";
      if (!ADMIN_EDITABLE_ROLES.has(role)) {
        res.status(400).json({ detail: "role 不受支持" });
        return;
      }
      const manualDisabled =
        typeof req.body?.manualDisabled === "boolean" ? req.body.manualDisabled : Boolean(req.body?.manualDisabled);
      const adminNote = req.body?.adminNote === undefined ? existing.adminNote : req.body.adminNote;

      await repositories.users.updateLocalSettings({
        userId: existing.id,
        role,
        manualDisabled,
        adminNote
      });

      const updated = await getUserById(db, existing.id);
      if (!updated) {
        res.status(500).json({ detail: "user 更新后不可用" });
        return;
      }
      res.json({ user: await buildUserDetail(db, updated) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/departments/tree", async (_req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const repositories = getRepositories();
      const tree = await repositories.departments.listTree();
      const withCounts = await Promise.all(tree.map((node) => attachMemberCount(db, node)));
      res.json({ departments: withCounts });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/departments/:departmentId", async (req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const department = await getDepartmentById(db, req.params.departmentId);
      if (!department) {
        res.status(404).json({ detail: "department 不存在" });
        return;
      }
      const users = await listDepartmentUsers(db, department.id);
      res.json({ department, users });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/departments/:departmentId/users", async (req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const department = await getDepartmentById(db, req.params.departmentId);
      if (!department) {
        res.status(404).json({ detail: "department 不存在" });
        return;
      }
      res.json({ users: await listDepartmentUsers(db, department.id) });
    } catch (error) {
      res.status(isNotFoundError(error) ? 404 : 500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/org-sync/config", async (_req: Request, res: Response) => {
    res.json({
      orgSync: options.orgSyncConfig ?? appConfig.orgSync
    });
  });

  router.use(options.broadcastRouter ?? Router());

  return router;
}
