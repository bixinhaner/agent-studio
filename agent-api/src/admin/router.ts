import { Router, type Request, type Response } from "express";

import { appConfig } from "../config.js";
import { createRequirePermission } from "../auth/permission-guard.js";
import { getDbClient } from "../db/client.js";
import { ZendeskIntegrationService } from "../integrations/zendesk/service.js";
import { createOrgSyncRouter } from "./org-sync-router.js";
import { createConversationAuditRouter } from "./conversation-audit-router.js";
import { createSubscriptionRouter } from "./subscription-router.js";
import { DepartmentMembershipRepository, type DepartmentMembershipRepositoryDb } from "../persistence/department-membership-repository.js";
import { DepartmentRepository, type DepartmentRepositoryDb, type DepartmentTreeNode } from "../persistence/department-repository.js";
import { AdminAuditLogRepository } from "../persistence/admin-audit-log-repository.js";
import { RolePermissionRepository } from "../persistence/role-permission-repository.js";
import { RoleRepository } from "../persistence/role-repository.js";
import { UserRoleRepository } from "../persistence/user-role-repository.js";
import type { OrganizationMembershipRepositoryDb } from "../persistence/organization-membership-repository.js";
import { OrganizationRepository, type OrganizationRepositoryDb, type OrganizationRecord } from "../persistence/organization-repository.js";
import { SyncJobRepository, type SyncJobRepositoryDb } from "../persistence/sync-job-repository.js";
import { UserRepository, type UserRepositoryDb } from "../persistence/user-repository.js";
import { PermissionService } from "../rbac/permission-service.js";
import { createSystemSettingsRouter } from "../system-settings/router.js";
import { SystemSettingsRepository } from "../system-settings/repository.js";
import { SystemSettingsService } from "../system-settings/service.js";
import { BrandingAssetStorage } from "../system-settings/branding-assets.js";
import { ExternalWebAccessService } from "../external-web-access.js";
import type { AlertEvaluationService } from "../operations/alert-evaluation-service.js";
import type { QuotaEvaluationService } from "../operations/quota-evaluation-service.js";
import { createSecurityDomainAdminRouter } from "../security-domains/admin-router.js";
import type { SecurityDomainService } from "../security-domains/service.js";
import type { SecurityDomainAccessControl } from "../security-domains/access-control.js";

type AdminDb =
  UserRepositoryDb &
  DepartmentRepositoryDb &
  DepartmentMembershipRepositoryDb &
  SyncJobRepositoryDb &
  OrganizationRepositoryDb &
  OrganizationMembershipRepositoryDb & {
    enterpriseUserProfile?: {
      findFirst(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    };
  };

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
  organizations?: OrganizationRepository;
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
  recoveryRouter?: Router;
  securityDomains?: SecurityDomainService;
  securityDomainAccess?: SecurityDomainAccessControl;
  isThreadActive?: (threadId: string) => boolean | Promise<boolean>;
};

type UserRow = {
  id: string;
  userType: string | null;
  primaryOrganizationId: string | null;
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

type AuthIdentityRow = {
  provider: string;
  email: string | null;
  lastLoginAt: Date | string | null;
};

type UserOrganizationMembershipRow = {
  organizationId: string;
  membershipType: string | null;
  status: string | null;
  organization?: {
    id: string;
    slug: string;
    name: string;
    type: string | null;
    status: string | null;
  } | null;
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
  position: string | null;
  sortOrder: number | null;
  isLeader: boolean | null;
  source: string;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type EnterpriseUserProfileRow = {
  userId: string;
  employeeNo: string | null;
  title: string | null;
  mobile: string | null;
  telephone: string | null;
  avatarUrl: string | null;
  workPlace: string | null;
  hiredAt: Date | string | null;
  managerDingTalkUserId: string | null;
  managerUserId: string | null;
  isAdmin: boolean | null;
  isBoss: boolean | null;
  isLeader: boolean | null;
  departmentPositionsJson?: unknown;
  lastSyncedAt: Date | string | null;
};

type OrganizationMembershipCountRow = {
  organizationId: string;
};

type OrganizationInviteCountRow = {
  organizationId: string;
};

type AdminCustomerOrganization = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  ownerUserId: string | null;
  memberCount: number;
  pendingInviteCount: number;
  createdAt: string;
  updatedAt: string;
};

type AdminDetailUser = {
  id: string;
  source: {
    userType: string;
    primaryOrganizationId: string | null;
    identities: Array<{
      provider: string;
      email: string | null;
      lastLoginAt: string | null;
    }>;
    organizations: Array<{
      organizationId: string;
      organizationSlug: string | null;
      organizationName: string | null;
      organizationType: string | null;
      membershipType: string;
      status: string;
    }>;
  };
  synced: {
    displayName: string | null;
    email: string | null;
    dingtalkUserId: string | null;
    dingtalkOpenId: string | null;
    dingtalkCorpId: string | null;
    departmentIds: string[];
    primaryDepartmentId: string | null;
  };
  enterprise: {
    title: string | null;
    employeeNo: string | null;
    mobileMasked: string | null;
    telephoneMasked: string | null;
    avatarUrl: string | null;
    workPlace: string | null;
    hiredAt: string | null;
    manager: {
      displayName: string | null;
      email: string | null;
    } | null;
    isAdmin: boolean | null;
    isBoss: boolean | null;
    isLeader: boolean | null;
    departmentPositions: Array<{
      departmentId: string;
      position: string | null;
      isPrimary: boolean;
      isLeader: boolean | null;
    }>;
    lastSyncedAt: string | null;
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
const ADMIN_EDITABLE_CUSTOMER_ORG_STATUSES = new Set(["active", "disabled"]);

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

function slugifyOrganizationName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "customer";
}

async function ensureUniqueOrganizationSlug(repository: OrganizationRepository, baseName: string): Promise<string> {
  const base = slugifyOrganizationName(baseName);
  let candidate = base;
  let sequence = 2;
  while (await repository.getBySlug(candidate)) {
    candidate = `${base}-${sequence}`;
    sequence += 1;
  }
  return candidate;
}

function toAdminCustomerOrganization(
  organization: OrganizationRecord,
  memberCount: number,
  pendingInviteCount: number
): AdminCustomerOrganization {
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    type: organization.type,
    status: organization.status,
    ownerUserId: organization.ownerUserId ?? null,
    memberCount,
    pendingInviteCount,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt
  };
}

async function decorateCustomerOrganizations(
  db: AdminDb,
  organizations: OrganizationRecord[]
): Promise<AdminCustomerOrganization[]> {
  if (!organizations.length) {
    return [];
  }

  const organizationIds = organizations.map((organization) => organization.id);
  const membershipRows =
    typeof (
      db as AdminDb & {
        organizationMembership?: {
          findMany(args: unknown): Promise<OrganizationMembershipCountRow[]>;
        };
      }
    ).organizationMembership?.findMany === "function"
      ? await (
          db as AdminDb & {
            organizationMembership: {
              findMany(args: unknown): Promise<OrganizationMembershipCountRow[]>;
            };
          }
        ).organizationMembership.findMany({
          where: {
            organizationId: { in: organizationIds },
            status: "active"
          }
        })
      : [];
  const pendingInviteRows =
    typeof (
      db as AdminDb & {
        organizationInvite?: {
          findMany(args: unknown): Promise<OrganizationInviteCountRow[]>;
        };
      }
    ).organizationInvite?.findMany === "function"
      ? await (
          db as AdminDb & {
            organizationInvite: {
              findMany(args: unknown): Promise<OrganizationInviteCountRow[]>;
            };
          }
        ).organizationInvite.findMany({
          where: {
            organizationId: { in: organizationIds },
            status: "pending"
          }
        })
      : [];

  const memberCountByOrganizationId = new Map<string, number>();
  for (const membership of membershipRows) {
    memberCountByOrganizationId.set(
      membership.organizationId,
      (memberCountByOrganizationId.get(membership.organizationId) ?? 0) + 1
    );
  }

  const pendingInviteCountByOrganizationId = new Map<string, number>();
  for (const invite of pendingInviteRows) {
    pendingInviteCountByOrganizationId.set(
      invite.organizationId,
      (pendingInviteCountByOrganizationId.get(invite.organizationId) ?? 0) + 1
    );
  }

  return organizations.map((organization) =>
    toAdminCustomerOrganization(
      organization,
      memberCountByOrganizationId.get(organization.id) ?? 0,
      pendingInviteCountByOrganizationId.get(organization.id) ?? 0
    )
  );
}

async function resolveDepartmentExternalId(db: AdminDb, departmentId: string): Promise<string> {
  const row =
    (await db.department.findUnique({ where: { id: departmentId } })) ??
    (await db.department.findUnique({ where: { externalId: departmentId } }));
  return row?.externalId ?? departmentId;
}

function maskPhone(value: string | null | undefined): string | null {
  const normalized = trimOrUndefined(value ?? undefined);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  }
  if (normalized.length <= 2) return "*".repeat(normalized.length);
  return `${normalized.slice(0, 1)}${"*".repeat(Math.max(normalized.length - 2, 1))}${normalized.slice(-1)}`;
}

async function getEnterpriseProfileForUser(db: AdminDb, userId: string): Promise<EnterpriseUserProfileRow | null> {
  if (typeof db.enterpriseUserProfile?.findFirst !== "function") {
    return null;
  }
  return (await db.enterpriseUserProfile.findFirst({ where: { userId } })) as EnterpriseUserProfileRow | null;
}

async function resolveEnterpriseManager(
  db: AdminDb,
  profile: EnterpriseUserProfileRow | null
): Promise<{ displayName: string | null; email: string | null } | null> {
  if (!profile) return null;
  const managerUserId = trimOrUndefined(profile.managerUserId ?? undefined);
  const managerDingTalkUserId = trimOrUndefined(profile.managerDingTalkUserId ?? undefined);
  if (!managerUserId && !managerDingTalkUserId) return null;

  const userClient = db.user as unknown as {
    findUnique(args: { where: Record<string, unknown> }): Promise<UserRow | null>;
  };
  const manager = managerUserId
    ? await userClient.findUnique({ where: { id: managerUserId } })
    : managerDingTalkUserId
      ? await userClient.findUnique({ where: { dingtalkUserId: managerDingTalkUserId } })
      : null;
  if (!manager) return null;
  return {
    displayName: trimOrUndefined(manager.displayName) ?? null,
    email: trimOrUndefined(manager.email) ?? null
  };
}

async function buildUserDetail(db: AdminDb, row: UserRow): Promise<AdminDetailUser> {
  const memberships = (await db.departmentMembership.findMany({
    where: { userId: row.id },
    orderBy: { createdAt: "asc" }
  })) as DepartmentMembershipRow[];
  const departmentIds: string[] = [];
  let primaryDepartmentId: string | null = null;
  for (const membership of memberships) {
    const externalId = await resolveDepartmentExternalId(db, membership.departmentId);
    departmentIds.push(externalId);
    if (membership.isPrimary && !primaryDepartmentId) {
      primaryDepartmentId = externalId;
    }
  }
  const departmentPositions = memberships.map((membership, index) => ({
    departmentId: departmentIds[index] ?? membership.departmentId,
    position: trimOrUndefined(membership.position) ?? null,
    isPrimary: Boolean(membership.isPrimary),
    isLeader: membership.isLeader ?? null
  }));

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
  const identityRows = typeof (db as AdminDb & { authIdentity?: { findMany(args: unknown): Promise<AuthIdentityRow[]> } }).authIdentity?.findMany === "function"
    ? await (db as AdminDb & { authIdentity: { findMany(args: unknown): Promise<AuthIdentityRow[]> } }).authIdentity.findMany({
        where: { userId: row.id },
        orderBy: { createdAt: "asc" }
      })
    : [];
  const organizationMembershipRows =
    typeof (db as AdminDb & { organizationMembership?: { findMany(args: unknown): Promise<UserOrganizationMembershipRow[]> } }).organizationMembership?.findMany === "function"
      ? await (db as AdminDb & {
          organizationMembership: { findMany(args: unknown): Promise<UserOrganizationMembershipRow[]> };
        }).organizationMembership.findMany({
          where: { userId: row.id },
          include: { organization: true },
          orderBy: { createdAt: "asc" }
        })
      : [];
  const enterpriseProfile = await getEnterpriseProfileForUser(db, row.id);
  const enterpriseManager = await resolveEnterpriseManager(db, enterpriseProfile);

  return {
    id: row.id,
    source: {
      userType: trimOrUndefined(row.userType) ?? "internal_employee",
      primaryOrganizationId: trimOrUndefined(row.primaryOrganizationId) ?? null,
      identities: identityRows.map((identity) => ({
        provider: identity.provider,
        email: trimOrUndefined(identity.email) ?? null,
        lastLoginAt: toIsoString(identity.lastLoginAt)
      })),
      organizations: organizationMembershipRows.map((membership) => ({
        organizationId: membership.organizationId,
        organizationSlug: trimOrUndefined(membership.organization?.slug) ?? null,
        organizationName: trimOrUndefined(membership.organization?.name) ?? null,
        organizationType: trimOrUndefined(membership.organization?.type) ?? null,
        membershipType: trimOrUndefined(membership.membershipType) ?? "customer_member",
        status: trimOrUndefined(membership.status) ?? "active"
      }))
    },
    synced: {
      displayName: trimOrUndefined(row.displayName) ?? null,
      email: trimOrUndefined(row.email) ?? null,
      dingtalkUserId: trimOrUndefined(row.dingtalkUserId) ?? null,
      dingtalkOpenId: trimOrUndefined(row.dingtalkOpenId) ?? null,
      dingtalkCorpId: trimOrUndefined(row.dingtalkCorpId) ?? null,
      departmentIds,
      primaryDepartmentId
    },
    enterprise: {
      title: trimOrUndefined(enterpriseProfile?.title) ?? null,
      employeeNo: trimOrUndefined(enterpriseProfile?.employeeNo) ?? null,
      mobileMasked: maskPhone(enterpriseProfile?.mobile),
      telephoneMasked: maskPhone(enterpriseProfile?.telephone),
      avatarUrl: trimOrUndefined(enterpriseProfile?.avatarUrl) ?? null,
      workPlace: trimOrUndefined(enterpriseProfile?.workPlace) ?? null,
      hiredAt: toIsoString(enterpriseProfile?.hiredAt),
      manager: enterpriseManager,
      isAdmin: enterpriseProfile?.isAdmin ?? null,
      isBoss: enterpriseProfile?.isBoss ?? null,
      isLeader: enterpriseProfile?.isLeader ?? null,
      departmentPositions,
      lastSyncedAt: toIsoString(enterpriseProfile?.lastSyncedAt)
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
    organizations: OrganizationRepository;
    syncJobs: SyncJobRepository;
  } | null = options.repositories
    ? {
        users: options.repositories.users ?? new UserRepository((options.db ?? getDbClient()) as UserRepositoryDb),
        departments:
          options.repositories.departments ?? new DepartmentRepository((options.db ?? getDbClient()) as DepartmentRepositoryDb),
        memberships:
          options.repositories.memberships ??
          new DepartmentMembershipRepository((options.db ?? getDbClient()) as DepartmentMembershipRepositoryDb),
        organizations:
          options.repositories.organizations ??
          new OrganizationRepository((options.db ?? getDbClient()) as OrganizationRepositoryDb),
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
        organizations: options.repositories?.organizations ?? new OrganizationRepository(db as OrganizationRepositoryDb),
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
            requirePermission,
            assetStorage: new BrandingAssetStorage(appConfig.brandingAssetRoot),
            externalWebAccess: new ExternalWebAccessService(
              db as never,
              new AdminAuditLogRepository(db as never)
            )
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

  router.use(
    createConversationAuditRouter({
      getDb: () => getDbInstance() as never,
      isThreadActive: options.isThreadActive
    })
  );

  router.use(
    createSubscriptionRouter({
      getDb: () => getDbInstance() as never
    })
  );

  if (options.securityDomains && options.securityDomainAccess) {
    router.use("/security-domains", createSecurityDomainAdminRouter(options.securityDomains, options.securityDomainAccess));
  }

  router.use(options.recoveryRouter ?? Router());

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

  router.get("/customer-organizations", async (_req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const repositories = getRepositories();
      const organizations = await repositories.organizations.list({ type: "customer" });
      res.json({
        organizations: await decorateCustomerOrganizations(db, organizations)
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/customer-organizations", async (req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const repositories = getRepositories();
      const name = trimOrUndefined(req.body?.name);
      if (!name) {
        res.status(400).json({ detail: "name is required" });
        return;
      }

      const requestedStatus = trimOrUndefined(req.body?.status) ?? "active";
      if (!ADMIN_EDITABLE_CUSTOMER_ORG_STATUSES.has(requestedStatus)) {
        res.status(400).json({ detail: "status 不受支持" });
        return;
      }

      const created = await repositories.organizations.create({
        slug: await ensureUniqueOrganizationSlug(repositories.organizations, name),
        name,
        type: "customer",
        status: requestedStatus,
        ownerUserId: req.currentUser?.id ?? null
      });
      const [organization] = await decorateCustomerOrganizations(db, [created]);
      res.status(201).json({ organization });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/customer-organizations/:organizationId", async (req: Request, res: Response) => {
    try {
      const db = getDbInstance();
      const repositories = getRepositories();
      const organizationId = trimOrUndefined(req.params.organizationId);
      if (!organizationId) {
        res.status(400).json({ detail: "organizationId is required" });
        return;
      }

      const existing = await repositories.organizations.getById(organizationId);
      if (!existing || existing.type !== "customer") {
        res.status(404).json({ detail: "customer organization 不存在" });
        return;
      }

      const nextName = req.body?.name === undefined ? undefined : trimOrUndefined(req.body?.name);
      if (req.body?.name !== undefined && !nextName) {
        res.status(400).json({ detail: "name is required" });
        return;
      }

      const nextStatus = req.body?.status === undefined ? undefined : trimOrUndefined(req.body?.status);
      if (nextStatus !== undefined && !ADMIN_EDITABLE_CUSTOMER_ORG_STATUSES.has(nextStatus)) {
        res.status(400).json({ detail: "status 不受支持" });
        return;
      }

      const updated = await repositories.organizations.update(existing.id, {
        name: nextName,
        status: nextStatus
      });
      const [organization] = await decorateCustomerOrganizations(db, [updated]);
      res.json({ organization });
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
