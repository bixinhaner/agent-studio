import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { registerCommonApiRoutes } from "./app-routes.js";
import { createBroadcastAdminRouter } from "./admin/broadcast-router.js";
import { createAdminRouter } from "./admin/router.js";
import { createMonitoringRouter } from "./admin/monitoring-router.js";
import { createRbacRouter } from "./admin/rbac-router.js";
import { createAuthRouter } from "./auth/router.js";
import { createCurrentUserMiddleware } from "./auth/current-user.js";
import { createRequirePermission } from "./auth/permission-guard.js";
import { createDingTalkClient } from "./auth/dingtalk.js";
import { createAuthEmailSender } from "./auth/email.js";
import { createOAuthStateCookieManager, createSessionCookieManager } from "./auth/session-cookie.js";
import { BroadcastService } from "./collaboration/broadcast-service.js";
import { InboxProjectionService } from "./collaboration/inbox-projection-service.js";
import { createCollaborationRouter } from "./collaboration/router.js";
import { ThreadCollaborationService } from "./collaboration/thread-collaboration-service.js";
import { appConfig, resolveWorkspace } from "./config.js";
import { CodexRuntime } from "./codex-runtime.js";
import { getDbClient } from "./db/client.js";
import { DepartmentRepository, type DepartmentRepositoryDb } from "./persistence/department-repository.js";
import {
  DepartmentMembershipRepository,
  type DepartmentMembershipRepositoryDb
} from "./persistence/department-membership-repository.js";
import {
  CostProfileRepository,
  type CostProfileRepositoryDb
} from "./persistence/cost-profile-repository.js";
import { QuotaPolicyRepository, type QuotaPolicyRepositoryDb } from "./persistence/quota-policy-repository.js";
import {
  ResourceAccessLogRepository,
  type ResourceAccessLogRepositoryDb
} from "./persistence/resource-access-log-repository.js";
import { SyncJobRepository, type SyncJobRepositoryDb } from "./persistence/sync-job-repository.js";
import { BroadcastRepository, type BroadcastRepositoryDb } from "./persistence/broadcast-repository.js";
import { createZendeskAdminRouter, handleZendeskWebhookRequest, ZendeskIntegrationService } from "./integrations/zendesk/index.js";
import {
  ensureThreadUploadInRunConfig,
  replaceLiveRuntimeSession,
  stripInternalRunConfigMetadata,
  startLiveRuntimeSession,
  streamRuntimeCompletionWithBestEffortUsage
} from "./live-runtime-session.js";
import { REASONING_EFFORT_VALUES, normalizeModel, normalizeReasoningEffortForModel } from "./model-config.js";
import { importLegacyThreadsFromJson } from "./persistence/json-import.js";
import { SessionRepository, type SessionRecord, type SessionRepositoryDb } from "./persistence/session-repository.js";
import {
  ThreadCollaborationRepository,
  type ThreadCollaborationRepositoryDb
} from "./persistence/thread-collaboration-repository.js";
import { ThreadCommentRepository, type ThreadCommentRepositoryDb } from "./persistence/thread-comment-repository.js";
import {
  ThreadRepository,
  type ReasoningEffort,
  type ThreadRecord,
  type ThreadRepositoryDb
} from "./persistence/thread-repository.js";
import {
  ThreadPublicShareRepository,
  type ThreadPublicShareRepositoryDb
} from "./persistence/thread-public-share-repository.js";
import { ThreadShareRepository, type ThreadShareRepositoryDb } from "./persistence/thread-share-repository.js";
import { InboxItemRepository, type InboxItemRepositoryDb } from "./persistence/inbox-item-repository.js";
import { UsageEventRepository, type UsageEventRepositoryDb } from "./persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "./persistence/usage-rollup-repository.js";
import { OrganizationRepository, type OrganizationRepositoryDb } from "./persistence/organization-repository.js";
import {
  OrganizationMembershipRepository,
  type OrganizationMembershipRepositoryDb
} from "./persistence/organization-membership-repository.js";
import { AuthIdentityRepository, type AuthIdentityRepositoryDb } from "./persistence/auth-identity-repository.js";
import { OrganizationInviteRepository, type OrganizationInviteRepositoryDb } from "./persistence/organization-invite-repository.js";
import { LoginChallengeRepository, type LoginChallengeRepositoryDb } from "./persistence/login-challenge-repository.js";
import { UserRepository, type UserRepositoryDb } from "./persistence/user-repository.js";
import { RoleRepository, type RoleRepositoryDb } from "./persistence/role-repository.js";
import { PermissionRepository, type PermissionRepositoryDb } from "./persistence/permission-repository.js";
import { UserRoleRepository, type UserRoleRepositoryDb } from "./persistence/user-role-repository.js";
import { RolePermissionRepository, type RolePermissionRepositoryDb } from "./persistence/role-permission-repository.js";
import { AdminAuditLogRepository, type AdminAuditLogRepositoryDb } from "./persistence/admin-audit-log-repository.js";
import { AlertEventRepository, type AlertEventRepositoryDb } from "./persistence/alert-event-repository.js";
import { AlertRuleRepository, type AlertRuleRepositoryDb } from "./persistence/alert-rule-repository.js";
import { KnowledgeSetRepository, type KnowledgeSetRepositoryDb } from "./persistence/knowledge-set-repository.js";
import { NotificationRecordRepository, type NotificationRecordRepositoryDb } from "./persistence/notification-record-repository.js";
import { ResourcePolicyRepository, type ResourcePolicyRepositoryDb } from "./persistence/resource-policy-repository.js";
import { RunProfileRepository, type RunProfileRepositoryDb } from "./persistence/run-profile-repository.js";
import { SkillPackageRepository, type SkillPackageRepositoryDb } from "./persistence/skill-package-repository.js";
import { AgentModeRepository, type AgentModeRepositoryDb } from "./persistence/agent-mode-repository.js";
import type { IntegrationInstanceRepositoryDb } from "./persistence/integration-instance-repository.js";
import { createIntegrationCenterRouter } from "./integrations/center/router.js";
import { createIntegrationCenterService, type IntegrationCenterDb } from "./integrations/center/service.js";
import { createOpenAICompatibleRouter } from "./integrations/openai-compatible-router.js";
import { createPortalRouter } from "./portal/router.js";
import { PortalRuntimeOptionService } from "./portal/runtime-option-service.js";
import { DingTalkOrgProvider } from "./org-sync/dingtalk-org-provider.js";
import { AlertEvaluationService } from "./operations/alert-evaluation-service.js";
import { NotificationDispatchService } from "./operations/notification-dispatch-service.js";
import { OrgSyncScheduler } from "./org-sync/org-sync-scheduler.js";
import { OrgSyncService } from "./org-sync/org-sync-service.js";
import { resolveWorkspaceAgentsMdContent } from "./agent-mode/workspace-agents-md.js";
import { ResourceAccessLogService } from "./operations/resource-access-log-service.js";
import { QuotaEvaluationService } from "./operations/quota-evaluation-service.js";
import { UsageIngestionService } from "./operations/usage-ingestion-service.js";
import { PermissionService } from "./rbac/permission-service.js";
import { createResourcesAdminRouter } from "./resources/admin-router.js";
import { createModeAdminRouter } from "./resources/mode-admin-router.js";
import { createResourcesPortalRouter } from "./resources/portal-router.js";
import { RuntimeKnowledgeSetService } from "./resources/runtime-knowledge-set-service.js";
import { FilesystemKnowledgeSetStorage } from "./resources/storage/filesystem-knowledge-set-storage.js";
import { PolicyService } from "./resources/policy-service.js";
import { SystemSettingsRepository } from "./system-settings/repository.js";
import { initSSE, sendSSE } from "./sse.js";
import {
  buildThreadPublicShareSnapshot,
  buildThreadPublicShareSnapshotFromLeadMessageIds,
  snapshotHasStructuredProcessRows,
  type ThreadPublicShareSnapshot
} from "./public-share/thread-public-share-snapshot.js";

const app = express();
const runtime = new CodexRuntime();
const db = getDbClient();
const sessions = new SessionRepository(db as unknown as SessionRepositoryDb, appConfig.sessionTtlMs);
const threads = new ThreadRepository(db as unknown as ThreadRepositoryDb);
const organizations = new OrganizationRepository(db as unknown as OrganizationRepositoryDb);
const organizationMemberships = new OrganizationMembershipRepository(db as unknown as OrganizationMembershipRepositoryDb);
const authIdentities = new AuthIdentityRepository(db as unknown as AuthIdentityRepositoryDb);
const organizationInvites = new OrganizationInviteRepository(db as unknown as OrganizationInviteRepositoryDb);
const loginChallenges = new LoginChallengeRepository(db as unknown as LoginChallengeRepositoryDb);
const users = new UserRepository(db as unknown as UserRepositoryDb);
const roles = new RoleRepository(db as unknown as RoleRepositoryDb);
const permissions = new PermissionRepository(db as unknown as PermissionRepositoryDb);
const userRoles = new UserRoleRepository(db as unknown as UserRoleRepositoryDb);
const rolePermissions = new RolePermissionRepository(db as unknown as RolePermissionRepositoryDb);
const adminAuditLogs = new AdminAuditLogRepository(db as unknown as AdminAuditLogRepositoryDb);
const alertRules = new AlertRuleRepository(db as unknown as AlertRuleRepositoryDb);
const alertEvents = new AlertEventRepository(db as unknown as AlertEventRepositoryDb);
const departmentMemberships = new DepartmentMembershipRepository(db as unknown as DepartmentMembershipRepositoryDb);
const departments = new DepartmentRepository(db as unknown as DepartmentRepositoryDb);
const notificationRecords = new NotificationRecordRepository(db as unknown as NotificationRecordRepositoryDb);
const syncJobs = new SyncJobRepository(db as unknown as SyncJobRepositoryDb);
const broadcasts = new BroadcastRepository(db as unknown as BroadcastRepositoryDb);
const resourceAccessLogRepository = new ResourceAccessLogRepository(db as unknown as ResourceAccessLogRepositoryDb);
const threadPublicShares = new ThreadPublicShareRepository(db as unknown as ThreadPublicShareRepositoryDb);
const threadShares = new ThreadShareRepository(db as unknown as ThreadShareRepositoryDb);
const threadComments = new ThreadCommentRepository(db as unknown as ThreadCommentRepositoryDb);
const threadCollaboration = new ThreadCollaborationRepository(db as unknown as ThreadCollaborationRepositoryDb);
const inboxItems = new InboxItemRepository(db as unknown as InboxItemRepositoryDb);
const usageEventRepository = new UsageEventRepository(db as unknown as UsageEventRepositoryDb);
const usageRollupRepository = new UsageRollupRepository(db as unknown as UsageRollupRepositoryDb);
const costProfiles = new CostProfileRepository(db as unknown as CostProfileRepositoryDb);
const quotaPolicies = new QuotaPolicyRepository(db as unknown as QuotaPolicyRepositoryDb);
const knowledgeSets = new KnowledgeSetRepository(db as unknown as KnowledgeSetRepositoryDb);
const resourcePolicies = new ResourcePolicyRepository(db as unknown as ResourcePolicyRepositoryDb);
const runProfiles = new RunProfileRepository(db as unknown as RunProfileRepositoryDb);
const skillPackages = new SkillPackageRepository(db as unknown as SkillPackageRepositoryDb);
const agentModes = new AgentModeRepository(db as unknown as AgentModeRepositoryDb);
const systemSettings = new SystemSettingsRepository(db as never);
const dingtalkClient = createDingTalkClient(appConfig.dingtalk);
const authEmailSender = createAuthEmailSender(appConfig.authEmail);
const zendesk = new ZendeskIntegrationService();
const knowledgeSetStorage = new FilesystemKnowledgeSetStorage(appConfig.knowledgeSetStorageRoot);
const policyService = new PolicyService(resourcePolicies);
const integrationCenter = createIntegrationCenterService({
  db: db as unknown as IntegrationCenterDb,
  policies: resourcePolicies as never,
  policyService,
  usageEvents: usageEventRepository,
  zendesk,
  accessResolver: {
    getRoleIdsForUser: async (userId) => (await userRoles.listForUser(userId)).map((assignment) => assignment.roleId),
    getDepartmentIdsForUser: async (userId) => departmentMemberships.listIdsForUser(userId)
  }
});
const resourceAccessLogs = new ResourceAccessLogService(resourceAccessLogRepository);
const usageIngestion = new UsageIngestionService({
  usageEvents: usageEventRepository,
  costProfiles
});
const notificationDispatch = new NotificationDispatchService({
  notifications: notificationRecords,
  dingtalk: ({ message }) => {
    if (!dingtalkClient.sendWorkNotice) {
      throw new Error("DingTalk work notice sender is not available");
    }
    return dingtalkClient.sendWorkNotice({ message });
  },
  broadcastDingtalk: ({ recipientUserIds, message }) => {
    if (!dingtalkClient.sendWorkNotice) {
      throw new Error("DingTalk work notice sender is not available");
    }
    return dingtalkClient.sendWorkNotice({
      userIds: recipientUserIds,
      message
    });
  }
});
const alertEvaluation = new AlertEvaluationService({
  alertRules,
  alertEvents,
  notifications: notificationDispatch
});
const quotaEvaluation = new QuotaEvaluationService({
  policies: quotaPolicies,
  rollups: usageRollupRepository
});
const permissionService = new PermissionService({
  roles,
  userRoles,
  rolePermissions
});

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
}

async function listActiveUserIds(): Promise<string[]> {
  const rows = (await (db as unknown as { user: { findMany(args: unknown): Promise<Array<{ id: string }>> } }).user.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" }
  })) as Array<{ id: string }>;
  return uniqueStrings(rows.map((row) => row.id));
}

async function listUserIdsForDepartment(departmentId: string): Promise<string[]> {
  const rows = (await (
    db as unknown as {
      departmentMembership: { findMany(args: unknown): Promise<Array<{ userId: string }>> };
    }
  ).departmentMembership.findMany({
    where: { departmentId: { in: [departmentId] } },
    orderBy: { createdAt: "asc" }
  })) as Array<{ userId: string }>;
  return uniqueStrings(rows.map((row) => row.userId));
}

async function listUserIdsForRole(roleId: string): Promise<string[]> {
  const rows = (await (db as unknown as { userRole: { findMany(args: unknown): Promise<Array<{ userId: string }>> } }).userRole.findMany({
    where: { roleId },
    orderBy: { createdAt: "asc" }
  })) as Array<{ userId: string }>;
  return uniqueStrings(rows.map((row) => row.userId));
}

async function ensureUsersExist(userIds: string[]): Promise<void> {
  for (const userId of uniqueStrings(userIds)) {
    if (!(await users.getById(userId))) {
      throw new Error("user not found");
    }
  }
}

async function hasUserPermission(userId: string, permissionKey: string): Promise<boolean> {
  const user = await users.getById(userId);
  return permissionService.hasPermission({
    userId,
    legacyRole: user?.role,
    permissionKey
  });
}

function createThreadCollaborationAuthorizer(permissionKey: "collaboration.read" | "collaboration.comment" | "collaboration.share" | "collaboration.assign" | "collaboration.capture_mark.write") {
  return {
    canReadThreadCollaboration: async ({ actorUserId }: { actorUserId: string }) =>
      permissionKey === "collaboration.read" ? hasUserPermission(actorUserId, permissionKey) : false,
    canCommentThreadCollaboration: async ({ actorUserId }: { actorUserId: string }) =>
      permissionKey === "collaboration.comment" ? hasUserPermission(actorUserId, permissionKey) : false,
    canManageThreadCollaboration: async ({ actorUserId }: { actorUserId: string }) =>
      permissionKey === "collaboration.share" ||
      permissionKey === "collaboration.assign" ||
      permissionKey === "collaboration.capture_mark.write"
        ? hasUserPermission(actorUserId, permissionKey)
        : false
  };
}

const inboxProjection = new InboxProjectionService({
  inbox: inboxItems,
  alerts: {
    listAllUserIds: listActiveUserIds,
    listUserIdsForDepartment
  }
});
const collaborationReadService = new ThreadCollaborationService({
  threads,
  shares: threadShares,
  comments: threadComments,
  collaboration: threadCollaboration,
  inboxProjection,
  directory: {
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId),
    listUserIdsForDepartment,
    ensureUsersExist
  },
  authorizer: createThreadCollaborationAuthorizer("collaboration.read")
});
const collaborationCommentService = new ThreadCollaborationService({
  threads,
  shares: threadShares,
  comments: threadComments,
  collaboration: threadCollaboration,
  inboxProjection,
  directory: {
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId),
    listUserIdsForDepartment,
    ensureUsersExist
  },
  authorizer: createThreadCollaborationAuthorizer("collaboration.comment")
});
const collaborationShareService = new ThreadCollaborationService({
  threads,
  shares: threadShares,
  comments: threadComments,
  collaboration: threadCollaboration,
  inboxProjection,
  directory: {
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId),
    listUserIdsForDepartment,
    ensureUsersExist
  },
  authorizer: createThreadCollaborationAuthorizer("collaboration.share")
});
const collaborationAssignService = new ThreadCollaborationService({
  threads,
  shares: threadShares,
  comments: threadComments,
  collaboration: threadCollaboration,
  inboxProjection,
  directory: {
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId),
    listUserIdsForDepartment,
    ensureUsersExist
  },
  authorizer: createThreadCollaborationAuthorizer("collaboration.assign")
});
const collaborationCaptureService = new ThreadCollaborationService({
  threads,
  shares: threadShares,
  comments: threadComments,
  collaboration: threadCollaboration,
  inboxProjection,
  directory: {
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId),
    listUserIdsForDepartment,
    ensureUsersExist
  },
  authorizer: createThreadCollaborationAuthorizer("collaboration.capture_mark.write")
});
const broadcastService = new BroadcastService({
  broadcasts,
  inboxProjection,
  recipientDirectory: {
    listAllUserIds: listActiveUserIds,
    listUserIdsForDepartment,
    listUserIdsForRole
  },
  notifications: {
    dispatchBroadcast: ({ broadcast, recipientUserIds }) => notificationDispatch.dispatchBroadcast({ broadcast, recipientUserIds })
  },
  authorizer: {
    canCreateBroadcast: async ({ actorUserId }) => hasUserPermission(actorUserId, "collaboration.broadcast.publish"),
    canUpdateBroadcast: async ({ actorUserId }) => hasUserPermission(actorUserId, "collaboration.broadcast.publish"),
    canPublishBroadcast: async ({ actorUserId }) => hasUserPermission(actorUserId, "collaboration.broadcast.publish")
  }
});

const requirePermission = createRequirePermission(permissionService, {
  resourceAccessLogs,
  listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId),
  securityAlerts: alertEvaluation,
  countRecentDeniedPermissionsForUser: async (userId, permissionKey) => {
    const rows = await resourceAccessLogRepository.list({
      userId,
      resourceType: "permission",
      resourceId: permissionKey,
      actionType: "deny",
      resultStatus: "denied",
      take: 3
    });
    return rows.length;
  }
});
const portalRuntimeOptions = new PortalRuntimeOptionService({
  modes: agentModes,
  runProfiles,
  skillPackages,
  policies: policyService
});
const runtimeKnowledgeSets = new RuntimeKnowledgeSetService({
  knowledgeSets,
  policies: policyService,
  storage: knowledgeSetStorage,
  resourceAccessLogs,
  securityAlerts: alertEvaluation
});
const dingtalkOrgProvider = new DingTalkOrgProvider(dingtalkClient);
const orgSyncService = new OrgSyncService({
  provider: dingtalkOrgProvider,
  departments,
  users,
  memberships: departmentMemberships,
  jobs: syncJobs,
  resourceAccessLogs
});
const orgSyncScheduler = new OrgSyncScheduler(orgSyncService, syncJobs, {
  enabled: appConfig.orgSync.enabled,
  intervalMinutes: appConfig.orgSync.intervalMinutes
});
const sessionCookies = createSessionCookieManager({
  cookieName: appConfig.sessionCookie.name,
  secret: appConfig.sessionCookie.secret,
  maxAgeMs: appConfig.sessionCookie.maxAgeMs,
  secure: appConfig.sessionCookie.secure,
  sameSite: "lax"
});
const oauthStates = createOAuthStateCookieManager({
  cookieName: `${appConfig.sessionCookie.name}_oauth_state`,
  secret: appConfig.sessionCookie.secret,
  maxAgeMs: 10 * 60 * 1000,
  secure: appConfig.sessionCookie.secure,
  sameSite: "lax"
});
const reasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);
type LiveRuntimeThread = Awaited<ReturnType<CodexRuntime["startThreadWithOptions"]>>;
const liveRuntimeThreads = new Map<string, LiveRuntimeThread>();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractCodexThreadIdFromRuntimeEvent(event: { type?: string; raw?: unknown }): string | undefined {
  if (event.type !== "thread.started") return undefined;
  const raw = asRecord(event.raw);
  const threadId = typeof raw?.thread_id === "string" ? raw.thread_id.trim() : "";
  return threadId || undefined;
}

async function restoreLiveRuntimeThread(session: SessionRecord): Promise<LiveRuntimeThread | undefined> {
  const cached = liveRuntimeThreads.get(session.sessionId);
  if (cached) {
    return cached;
  }

  const codexThreadId = trimOrUndefined(session.codexThreadId);
  if (!codexThreadId) {
    return undefined;
  }

  try {
    const liveThread = await runtime.resumeThreadWithOptions({
      threadId: codexThreadId,
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      workspace: session.workspace,
      codexRunConfig: stripInternalRunConfigMetadata(session.codexRunConfig)
    });
    liveRuntimeThreads.set(session.sessionId, liveThread);
    return liveThread;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("failed to resume codex thread", {
      sessionId: session.sessionId,
      codexThreadId,
      detail
    });
    return undefined;
  }
}

async function persistSessionCodexThreadId(session: SessionRecord, codexThreadId: string): Promise<SessionRecord> {
  const normalized = trimOrUndefined(codexThreadId);
  if (!normalized) {
    return session;
  }
  if (trimOrUndefined(session.codexThreadId) === normalized) {
    return session;
  }
  try {
    return await sessions.update(session.sessionId, { codexThreadId: normalized });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("failed to persist codex thread id", {
      sessionId: session.sessionId,
      codexThreadId: normalized,
      detail
    });
    return session;
  }
}

const createSessionSchema = z.object({
  session_id: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const streamSchema = z.object({
  session_id: z.string().min(1),
  thread_id: z.string().min(1).optional(),
  message: z.string().min(1)
});

const createThreadSchema = z.object({
  title: z.string().optional(),
  external_id: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const patchThreadSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const ensureThreadSessionSchema = z.object({
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  codex_run_config: z.record(z.unknown()).optional()
});

const appendMessageSchema = z.object({
  parent_id: z.string().nullable().optional(),
  message: z.unknown(),
  run_config: z.record(z.unknown()).optional()
});

const replaceMessagesSchema = z.object({
  head_id: z.string().nullable().optional(),
  messages: z.array(appendMessageSchema)
});

const feedbackSchema = z.object({
  type: z.enum(["positive", "negative"]),
  message_id: z.string().optional(),
  content_preview: z.string().optional()
});

const createThreadPublicShareSchema = z.object({
  selected_turn_ids: z.array(z.string().min(1)).min(1)
});

const browseDirectoriesSchema = z.object({
  path: z.string().optional()
});

const threadFileContentQuerySchema = z
  .object({
    relative_path: z.string().optional(),
    path: z.string().optional()
  })
  .refine((value) => Boolean(trimOrUndefined(value.relative_path) || trimOrUndefined(value.path)), {
    message: "必须提供 relative_path 或 path"
  });

type SessionOptions = {
  userId: string;
  organizationId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
};

type ModeSelection = {
  modeId: string;
  workspaceRootPath: string;
};

type CurrentActor = {
  id: string;
  role?: string;
  organizationId: string;
  organizationSlug?: string;
  organizationType?: string;
};

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, (_key, currentValue) => {
      if (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) {
        const record = currentValue as Record<string, unknown>;
        const sorted = Object.keys(record)
          .sort((left, right) => left.localeCompare(right))
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = record[key];
            return acc;
          }, {});
        return sorted;
      }
      return currentValue;
    });
  } catch {
    return String(value);
  }
}

function sessionOut(session: {
  sessionId: string;
  organizationId?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    session_id: session.sessionId,
    organization_id: session.organizationId ?? null,
    model: session.model,
    reasoning_effort: session.reasoningEffort,
    workspace: session.workspace,
    created_at: session.createdAt,
    updated_at: session.updatedAt
  };
}

function threadOut(thread: ThreadRecord) {
  return {
    id: thread.id,
    organization_id: thread.organizationId ?? null,
    status: thread.status,
    title: thread.title,
    external_id: thread.externalId,
    model: thread.model,
    reasoning_effort: thread.reasoningEffort,
    workspace: thread.workspace,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt
  };
}

function threadPublicShareOut(share: {
  id: string;
  token: string;
  title: string;
  selectedTurnCount: number;
  snapshot: unknown;
  createdAt: string;
  updatedAt: string;
  userDisplayName?: string;
}) {
  return {
    id: share.id,
    token: share.token,
    title: share.title,
    selected_turn_count: share.selectedTurnCount,
    public_path: `/share/${encodeURIComponent(share.token)}`,
    snapshot: share.snapshot,
    user_display_name: share.userDisplayName,
    created_at: share.createdAt,
    updated_at: share.updatedAt
  };
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function createThreadPublicShareToken(): string {
  return randomBytes(18).toString("base64url");
}

async function resolveThreadPublicShareUserDisplayName(userId?: string): Promise<string | undefined> {
  const normalizedUserId = trimOrUndefined(userId);
  if (!normalizedUserId) return undefined;
  const user = await users.getById(normalizedUserId);
  return trimOrUndefined(user?.displayName) ?? trimOrUndefined(user?.email);
}

async function resolveThreadPublicShareSnapshotForRead<
  T extends {
    threadId: string;
    title: string;
    selectedTurnCount: number;
    snapshot: ThreadPublicShareSnapshot;
  }
>(share: T): Promise<T> {
  if (snapshotHasStructuredProcessRows(share.snapshot)) {
    return share;
  }

  const leadMessageIds = share.snapshot.turns
    .map((turn) => trimOrUndefined(turn.leadMessageId))
    .filter((value): value is string => Boolean(value));
  if (leadMessageIds.length === 0) {
    return share;
  }

  const thread = await threads.get(share.threadId);
  if (!thread) {
    return share;
  }

  try {
    const rebuilt = buildThreadPublicShareSnapshotFromLeadMessageIds({
      thread,
      repository: { messages: thread.messages },
      selectedLeadMessageIds: leadMessageIds
    });
    return {
      ...share,
      title: rebuilt.title,
      selectedTurnCount: rebuilt.selectedTurnCount,
      snapshot: rebuilt.snapshot
    } as T;
  } catch {
    return share;
  }
}

function modeIdFromRunConfig(codexRunConfig?: Record<string, unknown>): string | undefined {
  const raw = codexRunConfig?.mode;
  return typeof raw === "string" ? trimOrUndefined(raw) : undefined;
}

function withRunConfigMode(
  codexRunConfig: Record<string, unknown> | undefined,
  modeId: string
): Record<string, unknown> {
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  next.mode = modeId;
  return next;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function formatSessionDateSegment(value: Date = new Date()): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveSessionWorkspaceRoot(input: string | null | undefined): string | undefined {
  const raw = trimOrUndefined(input);
  if (!raw) return undefined;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

async function resolveEffectiveSessionWorkspaceRootPath(): Promise<string> {
  try {
    const published = await systemSettings.getCurrentPublished();
    const configured = resolveSessionWorkspaceRoot(published?.payload.platformDefaults.sessionWorkspaceRoot);
    if (configured) {
      return configured;
    }
  } catch {
    // Fall back to static config when system settings are unavailable.
  }
  return appConfig.sessionWorkspaceRoot;
}

function buildThreadWorkspacePath(
  rootPath: string,
  organizationKey: string,
  userId: string,
  threadId: string,
  createdAt?: string
): string {
  const parsedCreatedAt = createdAt ? new Date(createdAt) : undefined;
  const dateSegment = formatSessionDateSegment(
    parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime()) ? parsedCreatedAt : new Date()
  );
  return path.join(
    rootPath,
    sanitizePathSegment(organizationKey, "organization"),
    sanitizePathSegment(userId, "user"),
    dateSegment,
    `thread-${sanitizePathSegment(threadId, "thread")}`
  );
}

function buildDetachedSessionWorkspacePath(rootPath: string, organizationKey: string, userId: string): string {
  const suffix = `${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const dateSegment = formatSessionDateSegment();
  return path.join(
    rootPath,
    sanitizePathSegment(organizationKey, "organization"),
    sanitizePathSegment(userId, "user"),
    dateSegment,
    `session-${suffix}`
  );
}

function currentActorFromRequest(req: Request): CurrentActor {
  if (!req.currentUser || !req.currentOrganization) {
    throw new Error("current actor is not available");
  }
  return {
    id: req.currentUser.id,
    role: req.currentUser.role,
    organizationId: req.currentOrganization.id,
    organizationSlug: req.currentOrganization.slug,
    organizationType: req.currentOrganization.type
  };
}

async function listDepartmentIdsForActor(actor: CurrentActor): Promise<string[]> {
  if (trimOrUndefined(actor.organizationType) !== "internal") {
    return [];
  }
  return departmentMemberships.listIdsForUser(actor.id);
}

function roleIdsForActor(actor: CurrentActor): string[] {
  return [actor.role ?? "employee"];
}

async function resolveModeSelection(input: {
  currentUser: CurrentActor;
  modeHint?: string;
}): Promise<ModeSelection> {
  const roleIds = roleIdsForActor(input.currentUser);
  const departmentIds = await listDepartmentIdsForActor(input.currentUser);
  const runtimeOptions = await portalRuntimeOptions.resolve({
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    roleIds,
    departmentIds
  });
  if (!runtimeOptions.modes.length) {
    throw new Error("当前账号无可用 Agent 模式");
  }

  const requestedModeId = trimOrUndefined(input.modeHint);
  const selectedMode =
    runtimeOptions.modes.find((mode) => mode.id === requestedModeId) ||
    runtimeOptions.modes.find((mode) => mode.id === runtimeOptions.defaults.mode) ||
    runtimeOptions.modes[0];
  if (!selectedMode) {
    throw new Error("当前账号无可用 Agent 模式");
  }

  return {
    modeId: selectedMode.id,
    workspaceRootPath: await resolveEffectiveSessionWorkspaceRootPath()
  };
}

async function allocateThreadWorkspacePath(input: {
  currentUser: CurrentActor;
  threadId: string;
  modeHint?: string;
}): Promise<ModeSelection & { workspacePath: string }> {
  const selection = await resolveModeSelection({
    currentUser: input.currentUser,
    modeHint: input.modeHint
  });
  const workspacePath = buildThreadWorkspacePath(
    selection.workspaceRootPath,
    input.currentUser.organizationSlug ?? input.currentUser.organizationId,
    input.currentUser.id,
    input.threadId
  );
  await fs.mkdir(workspacePath, { recursive: true });
  return {
    ...selection,
    workspacePath
  };
}

async function allocateDetachedSessionWorkspacePath(input: {
  currentUser: CurrentActor;
  modeHint?: string;
}): Promise<ModeSelection & { workspacePath: string }> {
  const selection = await resolveModeSelection({
    currentUser: input.currentUser,
    modeHint: input.modeHint
  });
  const workspacePath = buildDetachedSessionWorkspacePath(
    selection.workspaceRootPath,
    input.currentUser.organizationSlug ?? input.currentUser.organizationId,
    input.currentUser.id
  );
  await fs.mkdir(workspacePath, { recursive: true });
  return {
    ...selection,
    workspacePath
  };
}

function getThreadUploadTempDir(threadId: string): string {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9_-]/g, "_").trim() || "thread";
  return path.join(appConfig.uploadTempRoot, safeThreadId);
}

function getThreadWorkspaceUploadDir(workspacePath: string): string {
  return path.join(workspacePath, ".uploads");
}

function ensureThreadUploadDirsInRunConfig(
  codexRunConfig: Record<string, unknown> | undefined,
  threadId: string,
  workspacePath: string
): Record<string, unknown> {
  const withWorkspaceUpload = ensureThreadUploadInRunConfig(codexRunConfig, getThreadWorkspaceUploadDir(workspacePath));
  return ensureThreadUploadInRunConfig(withWorkspaceUpload, getThreadUploadTempDir(threadId));
}

async function createSession(options: SessionOptions, threadId?: string) {
  if (threadId) {
    await fs.mkdir(getThreadWorkspaceUploadDir(options.workspace), { recursive: true });
  }

  const sessionCodexRunConfig = threadId
    ? ensureThreadUploadDirsInRunConfig(options.codexRunConfig, threadId, options.workspace)
    : options.codexRunConfig;

  const started = await startLiveRuntimeSession({
    runtime,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: sessionCodexRunConfig
  });
  const codexRunConfig = started.codexRunConfig;
  const codexThreadId = started.codexThreadId;
  const session = await sessions.create({
    organizationId: options.organizationId,
    userId: options.userId,
    threadId,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig,
    codexThreadId
  });
  liveRuntimeThreads.set(session.sessionId, started.liveThread);
  return session;
}

async function resolveKnowledgeSetRunConfig(input: {
  currentUser: CurrentActor;
  workspacePath: string;
  knowledgeSetIds?: string[];
  codexRunConfig?: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> {
  return runtimeKnowledgeSets.mergeSelectedKnowledgeSetsIntoRunConfig({
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    roleIds: roleIdsForActor(input.currentUser),
    departmentIds: await listDepartmentIdsForActor(input.currentUser),
    workspacePath: input.workspacePath,
    knowledgeSetIds: input.knowledgeSetIds,
    codexRunConfig: input.codexRunConfig
  });
}

async function resolveWorkspaceAgentsMdContentForMode(modeId: string): Promise<string | undefined> {
  const normalizedModeId = trimOrUndefined(modeId);
  if (!normalizedModeId) return undefined;

  const agentMode = await agentModes.get(normalizedModeId);
  if (!agentMode) {
    return undefined;
  }

  const source = agentMode.instructionSources.find(
    (item) => item.sourceType === "workspace_agents_md" && trimOrUndefined(item.sourceRef)
  );
  if (!source) {
    return undefined;
  }
  return resolveWorkspaceAgentsMdContent(source.sourceRef);
}

async function applyWorkspaceAgentsMdForMode(modeId: string, workspacePath: string): Promise<void> {
  const content = await resolveWorkspaceAgentsMdContentForMode(modeId);
  if (!content) return;
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(path.join(workspacePath, "AGENTS.md"), content, "utf8");
}

async function resolveSessionOptions(
  input: {
    model?: string;
    reasoning_effort?: ReasoningEffort;
    knowledge_set_ids?: string[];
    codex_run_config?: Record<string, unknown>;
  },
  currentUser: CurrentActor,
  workspacePath: string,
  modeId: string
): Promise<SessionOptions> {
  const model = normalizeModel(input.model || appConfig.defaultModel);
  const reasoningEffort = normalizeReasoningEffortForModel(
    model,
    input.reasoning_effort || appConfig.defaultReasoningEffort
  );
  const sourceCodexRunConfig = withRunConfigMode(input.codex_run_config, modeId);
  await applyWorkspaceAgentsMdForMode(modeId, workspacePath);
  return {
    userId: currentUser.id,
    organizationId: currentUser.organizationId,
    model,
    reasoningEffort,
    workspace: workspacePath,
    codexRunConfig: await resolveKnowledgeSetRunConfig({
      currentUser,
      workspacePath,
      knowledgeSetIds: input.knowledge_set_ids,
      codexRunConfig: sourceCodexRunConfig
    })
  };
}

async function assertQuotaAllowsNewSession(input: {
  currentUser: CurrentActor;
  model: string;
  featureType: "chat";
}): Promise<void> {
  const departmentId =
    trimOrUndefined(input.currentUser.organizationType) === "internal"
      ? await departmentMemberships.getPreferredDepartmentIdForUser(input.currentUser.id)
      : undefined;
  const decision = await quotaEvaluation.evaluate({
    organizationId: input.currentUser.organizationId,
    departmentId: departmentId ?? undefined,
    model: input.model,
    featureType: input.featureType,
    rollupDate: new Date()
  });
  if (decision.decision === "soft_block") {
    if (decision.policy && decision.thresholdValue !== undefined) {
      await alertEvaluation.evaluateQuotaResult({
        scopeType: decision.policy.scopeType,
        scopeId: decision.policy.scopeId,
        metricType: decision.policy.metricType,
        triggeredValue: decision.observedValue,
        thresholdValue: decision.thresholdValue
      });
    }
    throw new Error("当前配额已超限，无法创建新的会话");
  }
}

async function ensureThreadSession(
  currentUser: CurrentActor,
  threadId: string,
  patch?: {
    model?: string;
    reasoning_effort?: ReasoningEffort;
    knowledge_set_ids?: string[];
    codex_run_config?: Record<string, unknown>;
  }
) {
  const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
  if (!thread) throw new Error("thread 不存在");

  const sourceCodexRunConfig = patch?.codex_run_config ?? thread.codexRunConfig;
  const modeHint = modeIdFromRunConfig(sourceCodexRunConfig);
  const modeSelection = await resolveModeSelection({
    currentUser,
    modeHint
  });
  const workspacePath =
    trimOrUndefined(thread.workspace) ||
    buildThreadWorkspacePath(
      modeSelection.workspaceRootPath,
      currentUser.organizationSlug ?? currentUser.organizationId,
      currentUser.id,
      threadId,
      thread.createdAt
    );
  await fs.mkdir(workspacePath, { recursive: true });
  const normalizedSourceCodexRunConfig = withRunConfigMode(sourceCodexRunConfig, modeSelection.modeId);
  const desiredModel = normalizeModel(patch?.model || thread.model || appConfig.defaultModel);
  const desiredReasoning = normalizeReasoningEffortForModel(
    desiredModel,
    patch?.reasoning_effort || thread.reasoningEffort || appConfig.defaultReasoningEffort
  );
  const desiredBaseCodexRunConfig = await resolveKnowledgeSetRunConfig({
    currentUser,
    workspacePath,
    knowledgeSetIds: patch?.knowledge_set_ids,
    codexRunConfig: normalizedSourceCodexRunConfig
  });
  await applyWorkspaceAgentsMdForMode(modeSelection.modeId, workspacePath);
  const desiredCodexRunConfig = ensureThreadUploadDirsInRunConfig(desiredBaseCodexRunConfig, threadId, workspacePath);

  const desired: SessionOptions = {
    organizationId: currentUser.organizationId,
    userId: thread.userId ?? currentUser.id,
    model: desiredModel,
    reasoningEffort: desiredReasoning,
    workspace: workspacePath,
    codexRunConfig: desiredCodexRunConfig
  };

  const shouldPersistNormalizedThread =
    thread.model !== desired.model ||
    thread.reasoningEffort !== desired.reasoningEffort ||
    thread.workspace !== desired.workspace ||
    stableJson(thread.codexRunConfig) !== stableJson(desiredBaseCodexRunConfig);

  if (
    patch?.model ||
    patch?.reasoning_effort ||
    patch?.knowledge_set_ids ||
    patch?.codex_run_config ||
    shouldPersistNormalizedThread
  ) {
    await threads.update(threadId, {
      model: desired.model,
      reasoningEffort: desired.reasoningEffort,
      workspace: desired.workspace,
      codexRunConfig: desiredBaseCodexRunConfig
    });
  }

  const active = thread.sessionId ? await sessions.get(thread.sessionId) : undefined;
  const hasLiveRuntime = active
    ? liveRuntimeThreads.has(active.sessionId) || Boolean(await restoreLiveRuntimeThread(active))
    : false;
  const changed =
    !active ||
    !hasLiveRuntime ||
    active.model !== desired.model ||
    active.reasoningEffort !== desired.reasoningEffort ||
    active.workspace !== desired.workspace ||
    stableJson(active.codexRunConfig) !== stableJson(desired.codexRunConfig);

  if (!changed && active) {
    return active;
  }

  await assertQuotaAllowsNewSession({
    currentUser,
    model: desired.model,
    featureType: "chat"
  });

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }
  return createSession(desired, threadId);
}

function summarizeText(text: string): string {
  const value = text.trim();
  if (!value) return "";
  if (value.length <= 120) return value;
  return `${value.slice(0, 120)}...`;
}

function decodeHeaderMaybeUri(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function sanitizeUploadFilename(value: string): string {
  const raw = decodeHeaderMaybeUri(value);
  const base = path.basename(raw).trim();
  const normalized = base
    .replace(/[/\\]/g, "_")
    .replace(/[\x00-\x1f\x7f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = normalized || "upload.bin";
  if (safe.length <= 160) return safe;
  const ext = path.extname(safe);
  const name = ext ? safe.slice(0, -ext.length) : safe;
  return `${name.slice(0, 140)}${ext.slice(0, 20)}`;
}

function normalizeMimeType(value: string): string {
  const decoded = decodeHeaderMaybeUri(value).trim().toLowerCase();
  if (!decoded) return "application/octet-stream";
  if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(decoded)) return decoded;
  return "application/octet-stream";
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const normalizedParent = path.resolve(parentDir);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

function resolveThreadFileAbsolutePath(input: {
  workspacePath: string;
  uploadDir: string;
  relativePath?: string;
  filePath?: string;
}): string {
  const normalizedWorkspacePath = path.resolve(input.workspacePath);
  const normalizedUploadDir = path.resolve(input.uploadDir);
  const normalizedRelative = trimOrUndefined(input.relativePath);
  if (normalizedRelative) {
    const normalizedPosixRelative = normalizeRelativePath(normalizedRelative).replace(/^\/+/, "");
    const relativeSegments = normalizedPosixRelative
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (relativeSegments.length === 0) {
      throw new Error("relative_path 无效");
    }
    const candidate = path.resolve(normalizedUploadDir, ...relativeSegments);
    if (!isPathInside(normalizedUploadDir, candidate)) {
      throw new Error("附件路径不在允许目录中");
    }
    return candidate;
  }

  const normalizedFilePath = trimOrUndefined(input.filePath);
  if (!normalizedFilePath) {
    throw new Error("必须提供 relative_path 或 path");
  }

  const candidate = path.isAbsolute(normalizedFilePath)
    ? path.resolve(normalizedFilePath)
    : path.resolve(normalizedWorkspacePath, normalizedFilePath);
  if (!isPathInside(normalizedWorkspacePath, candidate)) {
    throw new Error("文件路径不在线程工作区内");
  }
  return candidate;
}

function findWhitelistRoot(candidate: string): string | undefined {
  for (const root of appConfig.workspaceWhitelist) {
    if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
      return root;
    }
  }
  return undefined;
}

async function listDirectories(cwd: string): Promise<Array<{ name: string; path: string }>> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(cwd, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
  return directories;
}

const uploadRawParser = express.raw({
  type: () => true,
  limit: "128mb"
});

app.use(cors());
app.post(
  "/api/integrations/zendesk/webhook",
  express.raw({
    type: () => true,
    limit: "1mb"
  }),
  async (req: Request, res: Response) => {
    await handleZendeskWebhookRequest(zendesk, req, res);
  }
);
app.use(express.json({ limit: "1mb" }));

function requireServiceToken(req: Request, res: Response, next: NextFunction) {
  if (!appConfig.token) {
    next();
    return;
  }
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== appConfig.token) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  next();
}

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

registerCommonApiRoutes(app, {
  currentUserMiddleware: createCurrentUserMiddleware({
    users,
    memberships: organizationMemberships,
    cookies: sessionCookies
  }),
  authRouter: createAuthRouter({
    users,
    cookies: sessionCookies,
    dingtalkClient,
    dingtalkConfig: appConfig.dingtalk,
    oauthStates,
    identities: authIdentities,
    memberships: organizationMemberships,
    organizations,
    invites: organizationInvites,
    challenges: loginChallenges,
    emailSender: authEmailSender,
    appBaseUrl: appConfig.appBaseUrl,
    sessionCookieReady: Boolean(appConfig.sessionCookie.secret)
  }),
  rbacAdminRouter: createRbacRouter({
    roles,
    permissions,
    userRoles,
    rolePermissions,
    audits: adminAuditLogs,
    policies: policyService,
    requirePermission,
    db: db as never
  }),
  adminRouter: createAdminRouter({
    users,
    threads,
    sessions: {
      countActive: async () => liveRuntimeThreads.size
    },
    syncService: orgSyncService,
    orgSyncConfig: appConfig.orgSync,
    broadcastRouter: createBroadcastAdminRouter({
      broadcasts,
      service: broadcastService,
      requirePermission
    })
  }),
  integrationCenterRouter: createIntegrationCenterRouter({
    service: integrationCenter,
    requirePermission
  }),
  monitoringAdminRouter: createMonitoringRouter({
    requirePermission,
    resourceAccessLogs: resourceAccessLogRepository,
    usageEvents: usageEventRepository,
    usageRollups: usageRollupRepository,
    quotaPolicies,
    costProfiles,
    alertRules,
    alertEvents,
    notificationRecords
  }),
  resourcesAdminRouter: createResourcesAdminRouter({
    knowledgeSets,
    resourcePolicies,
    storage: knowledgeSetStorage,
    requirePermission,
    resourceAccessLogs
  }),
  modeAdminRouter: createModeAdminRouter({
    runProfiles,
    skillPackages,
    agentModes,
    resourcePolicies
  }),
  portalRouter: createPortalRouter({
    runtimeOptions: portalRuntimeOptions,
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId)
  }),
  resourcesPortalRouter: createResourcesPortalRouter({
    knowledgeSets,
    storage: knowledgeSetStorage,
    policies: policyService,
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId)
  }),
  serviceTokenMiddleware: requireServiceToken,
  zendeskRouter: createZendeskAdminRouter(zendesk)
});

app.use(
  "/openai/v1",
  createOpenAICompatibleRouter({
    runtime,
    integrationsDb: db as never,
    agentModes,
    runProfiles,
    knowledgeSets,
    knowledgeSetStorage,
    usageIngestion,
    systemSettings,
    sessionWorkspaceRoot: appConfig.sessionWorkspaceRoot,
    defaultModel: appConfig.defaultModel,
    defaultReasoningEffort: appConfig.defaultReasoningEffort
  })
);

app.use(
  createCollaborationRouter({
    collaboration: {
      getThreadCollaborationView: (input) => collaborationReadService.getThreadCollaborationView(input),
      replaceShares: (input) => collaborationShareService.replaceShares(input),
      addComment: (input) => collaborationCommentService.addComment(input),
      setAssignment: (input) => collaborationAssignService.setAssignment(input),
      setFollowers: (input) => collaborationAssignService.setFollowers(input),
      setCaptureMark: (input) => collaborationCaptureService.setCaptureMark(input)
    },
    inbox: inboxItems,
    listDepartmentIdsForUser: (userId) => departmentMemberships.listIdsForUser(userId)
  })
);

app.get("/api/fs/directories", async (req: Request, res: Response) => {
  try {
    const query = browseDirectoriesSchema.parse({
      path: typeof req.query.path === "string" ? req.query.path : undefined
    });
    const cwd = resolveWorkspace(query.path);
    const root = findWhitelistRoot(cwd);
    if (!root) {
      throw new Error("workspace 不在允许目录白名单中");
    }

    const directories = await listDirectories(cwd);
    let parent: string | null = null;
    if (cwd !== root) {
      const parentCandidate = path.dirname(cwd);
      parent =
        parentCandidate === root || parentCandidate.startsWith(`${root}${path.sep}`)
          ? parentCandidate
          : root;
    }

    res.json({
      roots: appConfig.workspaceWhitelist,
      cwd,
      parent,
      directories
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取目录失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/attachments", uploadRawParser, async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      res.status(400).json({ detail: "threadId 不能为空" });
      return;
    }

    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }

    const payload = req.body;
    if (!Buffer.isBuffer(payload) || payload.length === 0) {
      res.status(400).json({ detail: "上传内容为空" });
      return;
    }

    const safeName = sanitizeUploadFilename(String(req.headers["x-file-name"] || ""));
    const mimeType = normalizeMimeType(String(req.headers["x-file-type"] || ""));
    const expectedSize = Number(String(req.headers["x-file-size"] || "0"));
    if (Number.isFinite(expectedSize) && expectedSize > 0 && expectedSize !== payload.length) {
      res.status(400).json({ detail: "上传体积与文件声明不一致" });
      return;
    }

    let workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      const workspaceRootPath = await resolveEffectiveSessionWorkspaceRootPath();
      workspacePath = buildThreadWorkspacePath(
        workspaceRootPath,
        currentUser.organizationSlug ?? currentUser.organizationId,
        currentUser.id,
        threadId,
        thread.createdAt
      );
      await threads.update(threadId, { workspace: workspacePath });
    }

    const uploadDir = getThreadWorkspaceUploadDir(workspacePath);
    await fs.mkdir(uploadDir, { recursive: true });

    const id = randomUUID().replace(/-/g, "").slice(0, 12);
    const storedName = `${Date.now()}-${id}-${safeName}`;
    const absolutePath = path.join(uploadDir, storedName);
    await fs.writeFile(absolutePath, payload);

    const relativePath = normalizeRelativePath(path.relative(uploadDir, absolutePath));
    res.json({
      attachment: {
        name: safeName,
        mime_type: mimeType,
        bytes: payload.length,
        path: absolutePath,
        relative_path: relativePath,
        upload_dir: uploadDir
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "上传附件失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/files/content", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      res.status(400).json({ detail: "threadId 不能为空" });
      return;
    }

    const query = threadFileContentQuerySchema.parse({
      relative_path: typeof req.query.relative_path === "string" ? req.query.relative_path : undefined,
      path: typeof req.query.path === "string" ? req.query.path : undefined
    });

    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }

    const workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      res.status(404).json({ detail: "thread 工作目录不存在" });
      return;
    }

    const uploadDir = getThreadWorkspaceUploadDir(workspacePath);
    const absolutePath = resolveThreadFileAbsolutePath({
      workspacePath,
      uploadDir,
      relativePath: query.relative_path,
      filePath: query.path
    });

    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ detail: "文件不存在" });
      return;
    }

    const fileName = path.basename(absolutePath);
    const ext = path.extname(fileName);
    const fileBuffer = await fs.readFile(absolutePath);

    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type(ext || "application/octet-stream");
    res.status(200).send(fileBuffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取文件失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/session", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const input = createSessionSchema.parse(req.body || {});
    const existingId = (input.session_id || "").trim();
    if (existingId) {
      const existing = await sessions.getOwned(existingId, currentUser.id, currentUser.organizationId);
      if (existing) {
        const hasLiveRuntime =
          liveRuntimeThreads.has(existing.sessionId) || Boolean(await restoreLiveRuntimeThread(existing));
        if (!hasLiveRuntime) {
          await sessions.remove(existing.sessionId);
          liveRuntimeThreads.delete(existing.sessionId);
        } else if (input.model || input.reasoning_effort || input.knowledge_set_ids || input.codex_run_config) {
          const nextSourceCodexRunConfig = input.codex_run_config ?? existing.codexRunConfig;
          const modeHint = modeIdFromRunConfig(nextSourceCodexRunConfig) ?? modeIdFromRunConfig(existing.codexRunConfig);

          let workspace = existing.workspace;
          let modeId = modeHint;
          if (existing.threadId) {
            const selection = await resolveModeSelection({
              currentUser,
              modeHint
            });
            modeId = selection.modeId;
            const ownedThread = await threads.getOwned(existing.threadId, currentUser.id, currentUser.organizationId);
            workspace =
              trimOrUndefined(ownedThread?.workspace) ||
              trimOrUndefined(workspace) ||
              buildThreadWorkspacePath(
                selection.workspaceRootPath,
                currentUser.organizationSlug ?? currentUser.organizationId,
                currentUser.id,
                existing.threadId,
                ownedThread?.createdAt
              );
            await fs.mkdir(workspace, { recursive: true });
            if (ownedThread && trimOrUndefined(ownedThread.workspace) !== workspace) {
              await threads.update(existing.threadId, { workspace });
            }
          } else if (input.codex_run_config || !workspace || !modeId) {
            const allocated = await allocateDetachedSessionWorkspacePath({
              currentUser,
              modeHint
            });
            workspace = allocated.workspacePath;
            modeId = allocated.modeId;
          }

          if (!modeId) {
            const fallback = await resolveModeSelection({
              currentUser,
              modeHint: undefined
            });
            modeId = fallback.modeId;
          }

          if (modeId && workspace) {
            await applyWorkspaceAgentsMdForMode(modeId, workspace);
          }

          const normalizedSourceCodexRunConfig = withRunConfigMode(nextSourceCodexRunConfig, modeId);
          const nextCodexRunConfig = await resolveKnowledgeSetRunConfig({
            currentUser,
            workspacePath: workspace,
            knowledgeSetIds: input.knowledge_set_ids,
            codexRunConfig: normalizedSourceCodexRunConfig
          });
          const runtimeCodexRunConfig =
            existing.threadId && trimOrUndefined(workspace)
              ? ensureThreadUploadDirsInRunConfig(nextCodexRunConfig, existing.threadId, workspace)
              : nextCodexRunConfig;
          if (existing.threadId && trimOrUndefined(workspace)) {
            await fs.mkdir(getThreadWorkspaceUploadDir(workspace), { recursive: true });
          }
          await assertQuotaAllowsNewSession({
            currentUser,
            model: (input.model || existing.model).trim(),
            featureType: "chat"
          });
          const updated = await replaceLiveRuntimeSession({
            runtime,
            liveRuntimeThreads,
            sessionId: existing.sessionId,
            threadId: existing.threadId,
            model: (input.model || existing.model).trim(),
            reasoningEffort: input.reasoning_effort || existing.reasoningEffort,
            workspace,
            codexRunConfig: runtimeCodexRunConfig,
            persist: async (payload) =>
              sessions.update(existingId, {
                model: payload.model,
                reasoningEffort: payload.reasoningEffort,
                workspace: payload.workspace,
                codexRunConfig: payload.codexRunConfig,
                codexThreadId: payload.codexThreadId
              })
          });
          res.json(sessionOut(updated));
          return;
        } else {
          res.json(sessionOut(existing));
          return;
        }
      }
    }

    const modeHint = modeIdFromRunConfig(input.codex_run_config);
    const allocated = await allocateDetachedSessionWorkspacePath({
      currentUser,
      modeHint
    });
    const sessionOptions = await resolveSessionOptions(
      {
        model: input.model,
        reasoning_effort: input.reasoning_effort,
        knowledge_set_ids: input.knowledge_set_ids,
        codex_run_config: input.codex_run_config
      },
      currentUser,
      allocated.workspacePath,
      allocated.modeId
    );
    await assertQuotaAllowsNewSession({
      currentUser,
      model: sessionOptions.model,
      featureType: "chat"
    });
    const created = await createSession(sessionOptions);
    res.json(sessionOut(created));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "创建 session 失败";
    res.status(detail === "当前配额已超限，无法创建新的会话" ? 403 : 400).json({ detail });
  }
});

app.get("/public-api/thread-shares/:token", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || "").trim();
    const share = await threadPublicShares.getActiveByToken(token);
    if (!share) {
      res.status(404).json({ detail: "公开链接不存在或已失效" });
      return;
    }
    const resolvedShare = await resolveThreadPublicShareSnapshotForRead(share);
    const userDisplayName = await resolveThreadPublicShareUserDisplayName(share.createdByUserId);
    res.json({
      share: threadPublicShareOut({
        ...resolvedShare,
        userDisplayName
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取公开链接失败";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads", async (req: Request, res: Response) => {
  const currentUser = currentActorFromRequest(req);
  const list = await threads.listForUser(currentUser.id, currentUser.organizationId, true);
  res.json({
    threads: list.map((thread) => threadOut(thread))
  });
});

app.post("/api/threads", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const input = createThreadSchema.parse(req.body || {});
    const threadId = randomUUID().replace(/-/g, "");
    const modeHint = modeIdFromRunConfig(input.codex_run_config);
    const allocated = await allocateThreadWorkspacePath({
      currentUser,
      threadId,
      modeHint
    });
    const options = await resolveSessionOptions(
      {
        model: input.model,
        reasoning_effort: input.reasoning_effort,
        knowledge_set_ids: input.knowledge_set_ids,
        codex_run_config: input.codex_run_config
      },
      currentUser,
      allocated.workspacePath,
      allocated.modeId
    );
    await assertQuotaAllowsNewSession({
      currentUser,
      model: options.model,
      featureType: "chat"
    });
    const createdThread = await threads.create({
      id: threadId,
      organizationId: currentUser.organizationId,
      userId: currentUser.id,
      title: input.title?.trim() || undefined,
      externalId: input.external_id?.trim() || undefined,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      workspace: options.workspace,
      codexRunConfig: options.codexRunConfig
    });
    const session = await createSession(options, createdThread.id);
    const updated = (await threads.get(createdThread.id, currentUser.organizationId)) ?? createdThread;

    res.json({
      thread: threadOut(updated),
      session: sessionOut(session)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "创建 thread 失败";
    res.status(detail === "当前配额已超限，无法创建新的会话" ? 403 : 400).json({ detail });
  }
});

app.get("/api/threads/:threadId", async (req: Request, res: Response) => {
  const currentUser = currentActorFromRequest(req);
  const thread = await threads.getOwned(String(req.params.threadId || "").trim(), currentUser.id, currentUser.organizationId);
  if (!thread) {
    res.status(404).json({ detail: "thread 不存在" });
    return;
  }
  res.json({ thread: threadOut(thread) });
});

app.patch("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const input = patchThreadSchema.parse(req.body || {});
    const existing = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!existing) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }

    const patch: Parameters<typeof threads.update>[1] = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.status !== undefined) patch.status = input.status;
    const nextModel = input.model !== undefined ? normalizeModel(input.model) : existing.model;
    if (input.model !== undefined) patch.model = nextModel;
    if (input.model !== undefined || input.reasoning_effort !== undefined) {
      patch.reasoningEffort = normalizeReasoningEffortForModel(
        nextModel,
        input.reasoning_effort ?? existing.reasoningEffort
      );
    }
    if (input.codex_run_config !== undefined) patch.codexRunConfig = input.codex_run_config;
    const updated = await threads.update(threadId, patch);
    res.json({ thread: threadOut(updated) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "更新 thread 失败";
    res.status(400).json({ detail });
  }
});

app.delete("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    if (thread.sessionId) {
      await sessions.remove(thread.sessionId);
      liveRuntimeThreads.delete(thread.sessionId);
    }
    const workspacePath = trimOrUndefined(thread.workspace);
    await threads.delete(threadId);
    if (workspacePath) {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
    await fs.rm(getThreadUploadTempDir(threadId), { recursive: true, force: true });
    res.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "删除 thread 失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/session", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const input = ensureThreadSessionSchema.parse(req.body || {});
    const session = await ensureThreadSession(currentUser, threadId, input);
    res.json({ session: sessionOut(session) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "确保 thread session 失败";
    res.status(detail === "当前配额已超限，无法创建新的会话" ? 403 : 400).json({ detail });
  }
});

app.get("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const repository = await threads.getRepository(threadId);
    res.json({
      head_id: repository.headId ?? null,
      messages: repository.messages.map((item) => ({
        parent_id: item.parentId,
        message: item.message,
        run_config: item.runConfig
      }))
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取消息历史失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/public-share", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const profileUser = req.currentUser!;
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }

    const input = createThreadPublicShareSchema.parse(req.body || {});
    const repository = await threads.getRepository(threadId);
    const built = buildThreadPublicShareSnapshot({
      thread,
      repository,
      selectedTurnIds: input.selected_turn_ids
    });
    const share = await threadPublicShares.createOrReplaceActiveForThread({
      threadId,
      token: createThreadPublicShareToken(),
      title: built.title,
      selectedTurnCount: built.selectedTurnCount,
      snapshot: built.snapshot,
      createdByUserId: currentUser.id
    });
    const userDisplayName =
      trimOrUndefined(profileUser.displayName) ?? trimOrUndefined(profileUser.email) ?? undefined;

    res.json({
      share: threadPublicShareOut({
        ...share,
        userDisplayName
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "创建公开链接失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = appendMessageSchema.parse(req.body || {});
    const updated = await threads.appendMessage(threadId, {
      parentId: input.parent_id ?? null,
      message: input.message,
      runConfig: input.run_config
    });
    res.json({ ok: true, head_id: updated.headId ?? null });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "追加消息失败";
    res.status(400).json({ detail });
  }
});

app.put("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = replaceMessagesSchema.parse(req.body || {});
    await threads.replaceMessages(threadId, {
      headId: input.head_id ?? null,
      messages: input.messages.map((item) => ({
        parentId: item.parent_id ?? null,
        message: item.message,
        runConfig: item.run_config
      }))
    });
    res.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "覆盖消息历史失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/feedback", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "thread 不存在" });
      return;
    }
    const input = feedbackSchema.parse(req.body || {});
    const feedback = await threads.addFeedback(threadId, {
      type: input.type,
      messageId: input.message_id,
      contentPreview: summarizeText(input.content_preview || "")
    });
    res.json({ feedback });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "提交反馈失败";
    res.status(400).json({ detail });
  }
});

app.post("/api/chat/stream", async (req: Request, res: Response) => {
  initSSE(res);
  const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);

  try {
    const currentUser = currentActorFromRequest(req);
    const input = streamSchema.parse(req.body || {});
    let session = await sessions.getOwned(input.session_id, currentUser.id, currentUser.organizationId);
    let liveThread = session ? liveRuntimeThreads.get(session.sessionId) : undefined;
    if (!liveThread && session) {
      liveThread = await restoreLiveRuntimeThread(session);
    }
    if (!session || !liveThread) {
      if (session?.sessionId) {
        await sessions.remove(session.sessionId);
        liveRuntimeThreads.delete(session.sessionId);
      }
      sendSSE(res, "error", { detail: "session 不存在或已过期" });
      res.end();
      return;
    }
    const ensuredLiveThread = liveThread;
    let currentSession: SessionRecord = session;
    const requestedThreadId = String(input.thread_id || "").trim();
    if (requestedThreadId) {
      const boundThreadId = String(currentSession.threadId || "").trim();
      if (!boundThreadId) {
        sendSSE(res, "error", { detail: "session 未绑定 thread，请刷新后重试" });
        res.end();
        return;
      }
      if (boundThreadId !== requestedThreadId) {
        sendSSE(res, "error", { detail: "session 与 thread 不匹配，请重试" });
        res.end();
        return;
      }
    }

    // Each streamed turn is a new costly action. Gate it before execution without
    // terminating any turn that is already in flight.
    await assertQuotaAllowsNewSession({
      currentUser,
      model: currentSession.model,
      featureType: "chat"
    });

    sendSSE(res, "meta", {
      session_id: currentSession.sessionId,
      thread_id: currentSession.threadId,
      model: currentSession.model,
      reasoning_effort: currentSession.reasoningEffort,
      workspace: currentSession.workspace,
      started_at: new Date().toISOString()
    });

    await streamRuntimeCompletionWithBestEffortUsage({
      events: runtime.runStreamed(ensuredLiveThread, input.message),
      onEvent(event) {
        const codexThreadId = extractCodexThreadIdFromRuntimeEvent(event);
        if (codexThreadId) {
          void persistSessionCodexThreadId(currentSession, codexThreadId).then((updated) => {
            currentSession = updated;
          });
        }
        sendSSE(res, "codex", event);
      },
      async onDone(payload) {
        sendSSE(res, "done", {
          session_id: currentSession.sessionId,
          answer: payload.answer,
          completed_at: new Date().toISOString()
        });
      },
      async recordUsage(usage) {
        const departmentIdSnapshot =
          trimOrUndefined(currentUser.organizationType) === "internal"
            ? await departmentMemberships.getPreferredDepartmentIdForUser(currentUser.id)
            : undefined;
        await usageIngestion.record({
          organizationId: currentUser.organizationId,
          userId: currentUser.id,
          departmentIdSnapshot,
          threadId: currentSession.threadId ?? undefined,
          sessionId: currentSession.sessionId,
          model: currentSession.model,
          featureType: "chat",
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          resultStatus: "success",
          metadata: {
            source: "chat_stream"
          }
        });
      },
      onTelemetryError(error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn("usage telemetry ingestion failed", {
          sessionId: currentSession.sessionId,
          detail
        });
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "聊天流失败";
    sendSSE(res, "error", { detail });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

async function cleanupExpiredSessions() {
  const expiredSessionIds = await sessions.cleanupExpired();
  for (const sessionId of expiredSessionIds) {
    liveRuntimeThreads.delete(sessionId);
  }
}

setInterval(() => {
  void cleanupExpiredSessions();
}, 60_000).unref();

async function bootstrap() {
  await db.$connect();
  const legacyThreadOwnerId = await users.findLegacyImportOwnerId(appConfig.legacyThreadOwnerId);
  const imported = await importLegacyThreadsFromJson({
    filePath: appConfig.threadStoreFile,
    repository: threads,
    defaultUserId: legacyThreadOwnerId
  });
  if (imported.importedCount) {
    // eslint-disable-next-line no-console
    console.log(
      `imported ${imported.importedCount} legacy thread(s) from ${appConfig.threadStoreFile}${imported.archivedPath ? ` -> ${imported.archivedPath}` : ""}`
    );
  }
  orgSyncScheduler.start();
  app.listen(appConfig.port, appConfig.host, () => {
    // eslint-disable-next-line no-console
    console.log(`agent-studio-api listening on http://${appConfig.host}:${appConfig.port}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("failed to bootstrap api", error);
  process.exit(1);
});
