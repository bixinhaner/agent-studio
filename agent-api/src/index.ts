import cors from "cors";
import express, { type Request, type Response } from "express";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { registerCommonApiRoutes } from "./app-routes.js";
import { createBroadcastAdminRouter } from "./admin/broadcast-router.js";
import { createAdminRouter } from "./admin/router.js";
import { createMonitoringRouter } from "./admin/monitoring-router.js";
import { createRbacRouter } from "./admin/rbac-router.js";
import { createAdminAccessRequestRouter } from "./access-requests/admin-router.js";
import { createPublicAccessRequestRouter } from "./access-requests/public-router.js";
import { createAccessRequestReviewRouter } from "./access-requests/review-router.js";
import { createAccessRequestService } from "./access-requests/service.js";
import { createAuthRouter, resolveCrestUser } from "./auth/router.js";
import { createCurrentUserMiddleware } from "./auth/current-user.js";
import { createRequirePermission } from "./auth/permission-guard.js";
import { isInternalOrganizationType, resolveResourceRoleIds } from "./auth/resource-role-context.js";
import { createDingTalkClient, type DingTalkClient, type DingTalkConfig } from "./auth/dingtalk.js";
import { createAuthEmailSender } from "./auth/email.js";
import {
  ensureInternalOrganization,
  INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE
} from "./auth/internal-organization.js";
import { createOAuthStateCookieManager, createSessionCookieManager } from "./auth/session-cookie.js";
import {
  resolveArtifactAccessPolicy,
  type ArtifactAccessActor,
  type ResolvedArtifactAccessPolicy
} from "./artifacts/thread-artifact-policy.js";
import { NativeCodexSkillService } from "./codex-skills/native-codex-skill-service.js";
import { CodexSkillService } from "./codex-skills/codex-skill-service.js";
import { createAdminCodexSkillRouter, createPortalCodexSkillRouter } from "./codex-skills/router.js";
import { BroadcastService } from "./collaboration/broadcast-service.js";
import { InboxProjectionService } from "./collaboration/inbox-projection-service.js";
import { createCollaborationRouter } from "./collaboration/router.js";
import { ThreadCollaborationService } from "./collaboration/thread-collaboration-service.js";
import { appConfig, resolveWorkspace } from "./config.js";
import { CodexRuntime } from "./codex-runtime.js";
import { getDbClient } from "./db/client.js";
import {
  ManagedCodexProviderResolver,
  createLocalAuthProviderSnapshot,
  resolveManagedCodexDefaults,
  type ManagedCodexProviderInstance,
  type ManagedCodexProviderSnapshot
} from "./managed-codex-provider.js";
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
import type {
  ZendeskAgentDecision,
  ZendeskCommentPayload,
  ZendeskIntegrationSettings,
  ZendeskRequesterPayload,
  ZendeskTicketContext
} from "./integrations/zendesk/types.js";
import {
  ensureThreadUploadInRunConfig,
  replaceLiveRuntimeSession,
  stripInternalRunConfigMetadata,
  startLiveRuntimeSession,
  streamRuntimeCompletionWithBestEffortUsage
} from "./live-runtime-session.js";
import { REASONING_EFFORT_VALUES, normalizeModel, normalizeReasoningEffortForModel } from "./model-config.js";
import { importLegacyThreadsFromJson } from "./persistence/json-import.js";
import { createServiceTokenMiddleware } from "./service-token.js";
import { resolveThreadDeleteMode } from "./thread-delete-policy.js";
import { SessionRepository, type SessionRecord, type SessionRepositoryDb } from "./persistence/session-repository.js";
import {
  ThreadCollaborationRepository,
  type ThreadCollaborationRepositoryDb
} from "./persistence/thread-collaboration-repository.js";
import { ThreadCommentRepository, type ThreadCommentRepositoryDb } from "./persistence/thread-comment-repository.js";
import {
  ThreadRepository,
  type ReasoningEffort,
  type ThreadFeedback,
  type ThreadRecord,
  type ThreadRepositoryDb
} from "./persistence/thread-repository.js";
import {
  ThreadArtifactRepository,
  type ThreadArtifactRecord,
  type ThreadArtifactRepositoryDb
} from "./persistence/thread-artifact-repository.js";
import {
  ThreadPublicShareRepository,
  type ThreadPublicShareRepositoryDb
} from "./persistence/thread-public-share-repository.js";
import { ThreadShareRepository, type ThreadShareRepositoryDb } from "./persistence/thread-share-repository.js";
import {
  ExternalConversationBindingRepository,
  type ExternalConversationBindingRecord,
  type ExternalConversationBindingRepositoryDb
} from "./persistence/external-conversation-binding-repository.js";
import { InboxItemRepository, type InboxItemRepositoryDb } from "./persistence/inbox-item-repository.js";
import {
  SubscriptionDenialLogRepository
} from "./persistence/subscription-denial-log-repository.js";
import { SubscriptionGrantRepository } from "./persistence/subscription-grant-repository.js";
import { SubscriptionPlanRepository } from "./persistence/subscription-plan-repository.js";
import { AccessRequestRepository } from "./persistence/access-request-repository.js";
import { AccessRequestAttachmentRepository } from "./persistence/access-request-attachment-repository.js";
import { AccessRequestReviewerRepository } from "./persistence/access-request-reviewer-repository.js";
import { AccessRequestEventRepository } from "./persistence/access-request-event-repository.js";
import { AccessRequestPolicyRepository } from "./persistence/access-request-policy-repository.js";
import { PurchaseProofStorage } from "./access-requests/purchase-proof-storage.js";
import { UsageEventRepository, type UsageEventRepositoryDb } from "./persistence/usage-event-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "./persistence/usage-rollup-repository.js";
import { OrganizationRepository, type OrganizationRepositoryDb } from "./persistence/organization-repository.js";
import {
  OrganizationMembershipRepository,
  type OrganizationMembershipRepositoryDb
} from "./persistence/organization-membership-repository.js";
import { AuthIdentityRepository, type AuthIdentityRepositoryDb } from "./persistence/auth-identity-repository.js";
import {
  CrestDelegationCredentialRepository,
  type CrestDelegationCredentialRepositoryDb
} from "./persistence/crest-delegation-credential-repository.js";
import { OrganizationInviteRepository, type OrganizationInviteRepositoryDb } from "./persistence/organization-invite-repository.js";
import { LoginChallengeRepository, type LoginChallengeRepositoryDb } from "./persistence/login-challenge-repository.js";
import { UserRepository, type UserRepositoryDb } from "./persistence/user-repository.js";
import { RoleRepository, type RoleRepositoryDb } from "./persistence/role-repository.js";
import { PermissionRepository, type PermissionRepositoryDb } from "./persistence/permission-repository.js";
import { UserRoleRepository, type UserRoleRepositoryDb } from "./persistence/user-role-repository.js";
import { RolePermissionRepository, type RolePermissionRepositoryDb } from "./persistence/role-permission-repository.js";
import { AdminAuditLogRepository, type AdminAuditLogRepositoryDb } from "./persistence/admin-audit-log-repository.js";
import {
  ProductFeedbackRepository,
  type ProductFeedbackRepositoryDb
} from "./persistence/product-feedback-repository.js";
import {
  AiResponseReviewRepository,
  type AiResponseReviewRecord,
  type AiResponseReviewRepositoryDb
} from "./persistence/ai-response-review-repository.js";
import { createAiResponseReviewRouter } from "./ai-response-reviews/router.js";
import { AlertEventRepository, type AlertEventRepositoryDb } from "./persistence/alert-event-repository.js";
import { AlertRuleRepository, type AlertRuleRepositoryDb } from "./persistence/alert-rule-repository.js";
import { KnowledgeSetRepository, type KnowledgeSetRepositoryDb } from "./persistence/knowledge-set-repository.js";
import { NotificationRecordRepository, type NotificationRecordRepositoryDb } from "./persistence/notification-record-repository.js";
import { ResourcePolicyRepository, type ResourcePolicyRepositoryDb } from "./persistence/resource-policy-repository.js";
import { RunProfileRepository, type RunProfileRepositoryDb } from "./persistence/run-profile-repository.js";
import { SkillPackageRepository, type SkillPackageRepositoryDb } from "./persistence/skill-package-repository.js";
import { CodexSkillRepository, type CodexSkillRepositoryDb } from "./persistence/codex-skill-repository.js";
import { AgentModeRepository, type AgentModeRepositoryDb } from "./persistence/agent-mode-repository.js";
import type { IntegrationInstanceRepositoryDb } from "./persistence/integration-instance-repository.js";
import { createIntegrationCenterRouter } from "./integrations/center/router.js";
import { createIntegrationCenterService, type IntegrationCenterDb } from "./integrations/center/service.js";
import { createCrestRouter, issueCrestProxyTokenLease } from "./integrations/crest/router.js";
import { createOpenAICompatibleRouter } from "./integrations/openai-compatible-router.js";
import { DINGTALK_BOT_CHANNEL, isDingTalkResetCommand, normalizeDingTalkBotConfig } from "./integrations/dingtalk/bot-config.js";
import {
  DingTalkBotStreamService,
  type DingTalkBotHandleResult,
  type DingTalkBotIncomingMessage,
  type DingTalkBotInstance,
  type DingTalkBotStreamingCardReply
} from "./integrations/dingtalk/bot-stream-service.js";
import { createPortalRouter } from "./portal/router.js";
import { PortalRuntimeOptionService, type PortalRuntimeOptionRunProfile } from "./portal/runtime-option-service.js";
import { DingTalkOrgProvider } from "./org-sync/dingtalk-org-provider.js";
import { AlertEvaluationService } from "./operations/alert-evaluation-service.js";
import { NotificationDispatchService } from "./operations/notification-dispatch-service.js";
import { OrgSyncScheduler } from "./org-sync/org-sync-scheduler.js";
import { OrgSyncService } from "./org-sync/org-sync-service.js";
import { resolveWorkspaceAgentsMdContent } from "./agent-mode/workspace-agents-md.js";
import { ResourceAccessLogService } from "./operations/resource-access-log-service.js";
import { QuotaEvaluationService } from "./operations/quota-evaluation-service.js";
import {
  isChatAccessDeniedError,
  SubscriptionEntitlementService
} from "./operations/subscription-entitlement-service.js";
import { UsageIngestionService } from "./operations/usage-ingestion-service.js";
import { PermissionService } from "./rbac/permission-service.js";
import { createResourcesAdminRouter } from "./resources/admin-router.js";
import { createModeAdminRouter } from "./resources/mode-admin-router.js";
import { createResourcesPortalRouter } from "./resources/portal-router.js";
import { RuntimeKnowledgeSetService } from "./resources/runtime-knowledge-set-service.js";
import { FilesystemKnowledgeSetStorage } from "./resources/storage/filesystem-knowledge-set-storage.js";
import { PolicyService } from "./resources/policy-service.js";
import { SystemSettingsRepository } from "./system-settings/repository.js";
import { createDefaultSystemSettingsPayload } from "./system-settings/types.js";
import { BrandingAssetStorage } from "./system-settings/branding-assets.js";
import { resolvePublicBranding } from "./system-settings/public-branding.js";
import { initSSE, sendSSE } from "./sse.js";
import {
  buildThreadPublicShareSnapshot,
  buildThreadPublicShareSnapshotFromLeadMessageIds,
  type ThreadPublicShareSnapshot
} from "./public-share/thread-public-share-snapshot.js";

const app = express();
const runtime = new CodexRuntime();
const nativeCodexSkills = new NativeCodexSkillService(appConfig.codex);
const db = getDbClient();
const sessions = new SessionRepository(db as unknown as SessionRepositoryDb, appConfig.sessionTtlMs);
const threads = new ThreadRepository(db as unknown as ThreadRepositoryDb);
const organizations = new OrganizationRepository(db as unknown as OrganizationRepositoryDb);
const organizationMemberships = new OrganizationMembershipRepository(db as unknown as OrganizationMembershipRepositoryDb);
const authIdentities = new AuthIdentityRepository(db as unknown as AuthIdentityRepositoryDb);
const crestDelegationCredentials = new CrestDelegationCredentialRepository(db as unknown as CrestDelegationCredentialRepositoryDb);
const organizationInvites = new OrganizationInviteRepository(db as unknown as OrganizationInviteRepositoryDb);
const loginChallenges = new LoginChallengeRepository(db as unknown as LoginChallengeRepositoryDb);
const users = new UserRepository(db as unknown as UserRepositoryDb);
const roles = new RoleRepository(db as unknown as RoleRepositoryDb);
const permissions = new PermissionRepository(db as unknown as PermissionRepositoryDb);
const userRoles = new UserRoleRepository(db as unknown as UserRoleRepositoryDb);
const rolePermissions = new RolePermissionRepository(db as unknown as RolePermissionRepositoryDb);
const adminAuditLogs = new AdminAuditLogRepository(db as unknown as AdminAuditLogRepositoryDb);
const productFeedback = new ProductFeedbackRepository(db as unknown as ProductFeedbackRepositoryDb);
const aiResponseReviews = new AiResponseReviewRepository(db as unknown as AiResponseReviewRepositoryDb);
const alertRules = new AlertRuleRepository(db as unknown as AlertRuleRepositoryDb);
const alertEvents = new AlertEventRepository(db as unknown as AlertEventRepositoryDb);
const departmentMemberships = new DepartmentMembershipRepository(db as unknown as DepartmentMembershipRepositoryDb);
const departments = new DepartmentRepository(db as unknown as DepartmentRepositoryDb);
const notificationRecords = new NotificationRecordRepository(db as unknown as NotificationRecordRepositoryDb);
const syncJobs = new SyncJobRepository(db as unknown as SyncJobRepositoryDb);
const broadcasts = new BroadcastRepository(db as unknown as BroadcastRepositoryDb);
const resourceAccessLogRepository = new ResourceAccessLogRepository(db as unknown as ResourceAccessLogRepositoryDb);
const threadPublicShares = new ThreadPublicShareRepository(db as unknown as ThreadPublicShareRepositoryDb);
const threadArtifacts = new ThreadArtifactRepository(db as unknown as ThreadArtifactRepositoryDb);
const threadShares = new ThreadShareRepository(db as unknown as ThreadShareRepositoryDb);
const externalConversationBindings = new ExternalConversationBindingRepository(db as unknown as ExternalConversationBindingRepositoryDb);
const threadComments = new ThreadCommentRepository(db as unknown as ThreadCommentRepositoryDb);
const threadCollaboration = new ThreadCollaborationRepository(db as unknown as ThreadCollaborationRepositoryDb);
const inboxItems = new InboxItemRepository(db as unknown as InboxItemRepositoryDb);
const subscriptionPlans = new SubscriptionPlanRepository(db as never);
const subscriptionGrants = new SubscriptionGrantRepository(db as never);
const accessRequests = new AccessRequestRepository(db as never);
const accessRequestAttachments = new AccessRequestAttachmentRepository(db as never);
const accessRequestReviewers = new AccessRequestReviewerRepository(db as never);
const accessRequestEvents = new AccessRequestEventRepository(db as never);
const accessRequestPolicies = new AccessRequestPolicyRepository(db as never);
const subscriptionDenialLogs = new SubscriptionDenialLogRepository(db as never);
const usageEventRepository = new UsageEventRepository(db as unknown as UsageEventRepositoryDb);
const usageRollupRepository = new UsageRollupRepository(db as unknown as UsageRollupRepositoryDb);
const costProfiles = new CostProfileRepository(db as unknown as CostProfileRepositoryDb);
const quotaPolicies = new QuotaPolicyRepository(db as unknown as QuotaPolicyRepositoryDb);
const knowledgeSets = new KnowledgeSetRepository(db as unknown as KnowledgeSetRepositoryDb);
const resourcePolicies = new ResourcePolicyRepository(db as unknown as ResourcePolicyRepositoryDb);
const runProfiles = new RunProfileRepository(db as unknown as RunProfileRepositoryDb);
const skillPackages = new SkillPackageRepository(db as unknown as SkillPackageRepositoryDb);
const agentModes = new AgentModeRepository(db as unknown as AgentModeRepositoryDb);
const codexSkills = new CodexSkillRepository(db as unknown as CodexSkillRepositoryDb);
const codexSkillService = new CodexSkillService(
  {
    repository: codexSkills,
    skillPackages,
    agentModes
  },
  {
    draftRoot: appConfig.codex.skillDraftRoot,
    publishedSkillsRoot: nativeCodexSkills.getSkillsRoot()
  }
);
const systemSettings = new SystemSettingsRepository(db as never);
const codexProviders = new ManagedCodexProviderResolver({
  integrations: {
    async listOpenAICodexInstances(): Promise<ManagedCodexProviderInstance[]> {
      const rows = await db.integrationInstance.findMany({
        where: { type: "openai_codex" },
        orderBy: { createdAt: "asc" }
      });
      return await Promise.all(
        rows.map(async (row) => {
          const [configRow, secretRow] = await Promise.all([
            db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: row.id } }),
            db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: row.id } })
          ]);
          return {
            id: row.id,
            slug: row.slug,
            status: row.status,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt ?? ""),
            config: asRecord(configRow?.config) ?? undefined,
            secretState: asRecord(secretRow?.secretState) ?? undefined
          };
        })
      );
    }
  },
  systemSettings
});
const dingtalkClient = createDingTalkClient(appConfig.dingtalk);

async function resolveActiveDingTalkWorkNoticeConfig(): Promise<DingTalkConfig> {
  const instance = await db.integrationInstance.findFirst({
    where: {
      type: "dingtalk",
      status: "active"
    },
    orderBy: { updatedAt: "desc" }
  });
  if (!instance) return appConfig.dingtalk;

  const [configRow, secretRow] = await Promise.all([
    db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: instance.id } }),
    db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: instance.id } })
  ]);
  const config = asRecord(configRow?.config) ?? {};
  const secret = asRecord(secretRow?.secretState) ?? {};
  const alertUserIds = asStringArray(config.alertUserIds);

  return {
    ...appConfig.dingtalk,
    clientId: asString(config.clientId) ?? appConfig.dingtalk.clientId,
    clientSecret: asString(secret.clientSecret) ?? appConfig.dingtalk.clientSecret,
    redirectUri: asString(config.redirectUri) ?? appConfig.dingtalk.redirectUri,
    scope: asString(config.scope) ?? appConfig.dingtalk.scope,
    apiBaseUrl: asString(config.apiBaseUrl),
    alertAgentId: asString(config.alertAgentId) ?? appConfig.dingtalk.alertAgentId,
    alertUserIds: alertUserIds.length ? alertUserIds : appConfig.dingtalk.alertUserIds
  };
}

async function createActiveDingTalkClient(): Promise<DingTalkClient> {
  return createDingTalkClient(await resolveActiveDingTalkWorkNoticeConfig());
}

async function sendActiveDingTalkWorkNotice(input: { userIds?: string[]; message: string }): Promise<void> {
  const client = await createActiveDingTalkClient();
  if (!client.sendWorkNotice) {
    throw new Error("DingTalk work notice sender is not available");
  }
  return client.sendWorkNotice(input);
}

const authEmailSender = createAuthEmailSender(appConfig.authEmail);
const purchaseProofStorage = new PurchaseProofStorage(appConfig.accessRequestUploadRoot);
const accessRequestService = createAccessRequestService({
  requests: accessRequests,
  attachments: accessRequestAttachments,
  purchaseProofStorage,
  reviewers: accessRequestReviewers,
  events: accessRequestEvents,
  users,
  organizations,
  memberships: organizationMemberships,
  invites: organizationInvites,
  subscriptionPlans,
  subscriptionGrants,
  policies: accessRequestPolicies,
  emailSender: authEmailSender,
  appBaseUrl: appConfig.appBaseUrl,
  accessRequestConfig: appConfig.accessRequests,
  findInternalUsers: async () => {
    const rows = await db.user.findMany({
      where: {
        status: "active",
        userType: "internal_employee",
        email: { not: null }
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
    return rows
      .filter((row) => row.email)
      .map((row) => ({
        id: row.id,
        email: String(row.email).trim().toLowerCase(),
        displayName: typeof row.displayName === "string" ? row.displayName.trim() || undefined : undefined,
        role: typeof row.role === "string" ? row.role : "employee",
        userType: typeof row.userType === "string" ? row.userType : "internal_employee"
      }));
  }
});
const knowledgeSetStorage = new FilesystemKnowledgeSetStorage(appConfig.knowledgeSetStorageRoot);
const usageIngestion = new UsageIngestionService({
  usageEvents: usageEventRepository,
  costProfiles
});

async function resolveZendeskDingTalkMentionTarget(input: {
  zendeskUser?: ZendeskRequesterPayload;
  settings: ZendeskIntegrationSettings;
}): Promise<{ userIds: string[]; label?: string; detail?: string } | undefined> {
  const email = trimOrUndefined(input.zendeskUser?.email)?.toLowerCase();
  const fallbackLabel = trimOrUndefined(input.zendeskUser?.name) || email;
  if (!input.zendeskUser) {
    const fallbackUserIds = Array.from(new Set(input.settings.dingtalkNotificationFallbackUserIds.map((item) => item.trim()).filter(Boolean)));
    if (fallbackUserIds.length === 0) return undefined;
    const rows = await db.user.findMany({
      where: {
        dingtalkUserId: { in: fallbackUserIds },
        status: "active"
      },
      orderBy: { createdAt: "asc" }
    });
    const matchedIds = new Set(rows.map((row) => trimOrUndefined(row.dingtalkUserId)).filter((item): item is string => Boolean(item)));
    const labels = rows
      .map((row) => trimOrUndefined(row.displayName) || trimOrUndefined(row.email) || trimOrUndefined(row.dingtalkUserId))
      .filter((item): item is string => Boolean(item));
    const missingCount = fallbackUserIds.filter((id) => !matchedIds.has(id)).length;
    return {
      userIds: fallbackUserIds,
      label: labels.length ? labels.join(", ") : "Support team",
      detail: missingCount > 0
        ? `Using ${fallbackUserIds.length} fallback DingTalk user(s); ${missingCount} not found in active Agent Studio users.`
        : `Using ${fallbackUserIds.length} fallback DingTalk user(s).`
    };
  }
  if (!email) {
    return fallbackLabel ? { userIds: [], label: fallbackLabel, detail: "Zendesk assignee has no email." } : undefined;
  }
  const row = await db.user.findFirst({
    where: {
      email,
      status: "active"
    },
    orderBy: { createdAt: "asc" }
  });
  const dingtalkUserId = trimOrUndefined(row?.dingtalkUserId);
  const label = trimOrUndefined(row?.displayName) || fallbackLabel || email;
  return {
    userIds: dingtalkUserId ? [dingtalkUserId] : [],
    label,
    detail: dingtalkUserId
      ? `Matched Zendesk assignee email ${email} to DingTalk user.`
      : `No active Agent Studio DingTalk user was found for ${email}.`
  };
}

function zendeskReviewUserDisplay(user: ZendeskRequesterPayload | undefined, fallback = "Unassigned"): string {
  if (!user) return fallback;
  const name = trimOrUndefined(user.name);
  const email = trimOrUndefined(user.email);
  if (name && email) return `${name} <${email}>`;
  return name || email || fallback;
}

function zendeskReviewResultLabel(input: { decision: ZendeskAgentDecision["decision"]; publicReply: boolean }): string {
  if (input.publicReply) return "Public reply";
  if (input.decision === "handoff") return "Human handoff note";
  return "Internal note";
}

function buildAiResponseReviewUrl(baseUrl: string, reviewId: string): string {
  const base = trimOrUndefined(baseUrl)?.replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/review/ai-response/${encodeURIComponent(reviewId)}`;
}

function aiResponseReviewAdminUrl(baseUrl: string, ticketId: string): string {
  const base = trimOrUndefined(baseUrl)?.replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/#admin/conversations?mode=ai_reviews&query=${encodeURIComponent(ticketId)}`;
}

function aiResponseReviewDueAt(settings: ZendeskIntegrationSettings): Date {
  const dueHours = Math.max(1, Math.min(168, Math.floor(Number(settings.dingtalkReviewDueHours) || 24)));
  return new Date(Date.now() + dueHours * 60 * 60 * 1000);
}

function aiResponseReviewTodoSourceId(reviewId: string): string {
  return `agent-studio-ai-review-${reviewId}`;
}

function aiResponseReviewTodoSubject(input: { ticketId: string; subject?: string }): string {
  const suffix = trimOrUndefined(input.subject);
  const base = `Review Zendesk #${input.ticketId} AI response`;
  if (!suffix) return base;
  const full = `${base}: ${suffix}`;
  return full.length > 120 ? `${full.slice(0, 117).trimEnd()}...` : full;
}

function aiResponseReviewTodoDescription(input: {
  ticketUrl?: string;
  reviewUrl?: string;
  resultLabel: string;
  dueAt: Date;
}): string {
  return [
    `Result: ${input.resultLabel}`,
    `Due: ${input.dueAt.toISOString()}`,
    input.reviewUrl ? `Review link: ${input.reviewUrl}` : undefined,
    input.ticketUrl ? `Zendesk ticket: ${input.ticketUrl}` : undefined
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

async function createDingTalkAiResponseReviewTodo(input: {
  review: AiResponseReviewRecord;
  reviewerUnionId?: string | null;
  ticketId: string;
  ticketSubject?: string;
  ticketUrl?: string;
  resultLabel: string;
  dueAt: Date;
}): Promise<AiResponseReviewRecord> {
  const unionId = trimOrUndefined(input.reviewerUnionId ?? undefined);
  const sourceId = aiResponseReviewTodoSourceId(input.review.id);
  if (!unionId) {
    return (
      (await aiResponseReviews.markDingTalkTodoFailed(input.review.id, {
        status: "failed",
        error: "Reviewer does not have a DingTalk unionId; sync or sign in with DingTalk first.",
        sourceId
      })) ?? input.review
    );
  }

  try {
    const client = await createActiveDingTalkClient();
    if (!client.createTodoTask) {
      throw new Error("DingTalk todo task creator is not available");
    }
    const result = await client.createTodoTask({
      unionId,
      sourceId,
      subject: aiResponseReviewTodoSubject({
        ticketId: input.ticketId,
        subject: input.ticketSubject
      }),
      description: aiResponseReviewTodoDescription({
        ticketUrl: input.ticketUrl,
        reviewUrl: input.review.reviewUrl,
        resultLabel: input.resultLabel,
        dueAt: input.dueAt
      }),
      dueTime: input.dueAt.getTime(),
      detailUrl: input.review.reviewUrl
        ? {
            pcUrl: input.review.reviewUrl,
            appUrl: input.review.reviewUrl
          }
        : undefined,
      priority: 20
    });
    return (
      (await aiResponseReviews.markDingTalkTodoCreated(input.review.id, {
        taskId: result.taskId,
        unionId,
        sourceId: result.sourceId ?? sourceId
      })) ?? input.review
    );
  } catch (error) {
    return (
      (await aiResponseReviews.markDingTalkTodoFailed(input.review.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "DingTalk todo creation failed",
        unionId,
        sourceId
      })) ?? input.review
    );
  }
}

async function completeDingTalkAiResponseReviewTodo(
  review: AiResponseReviewRecord,
  repository: AiResponseReviewRepository
): Promise<AiResponseReviewRecord | null | void> {
  const taskId = trimOrUndefined(review.dingtalkTodoTaskId);
  const unionId = trimOrUndefined(review.dingtalkTodoUnionId);
  if (!taskId || !unionId || review.dingtalkTodoStatus === "completed") {
    return review;
  }

  try {
    const client = await createActiveDingTalkClient();
    if (!client.completeTodoTask) {
      throw new Error("DingTalk todo task completer is not available");
    }
    await client.completeTodoTask({
      unionId,
      taskId
    });
    return await repository.markDingTalkTodoCompleted(review.id);
  } catch (error) {
    return await repository.markDingTalkTodoFailed(review.id, {
      status: "complete_failed",
      error: error instanceof Error ? error.message : "DingTalk todo completion failed",
      unionId,
      sourceId: review.dingtalkTodoSourceId
    });
  }
}

async function requestZendeskDingTalkAiReviews(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  instanceId?: string;
  ticketId: string;
  runId: string;
  source: "webhook" | "manual";
  decision: ZendeskAgentDecision;
  action: {
    publicReply: boolean;
    body: string;
    detail: string;
    decision: ZendeskAgentDecision["decision"];
  };
  commentId?: number;
  ticketUrl: string;
  atUserIds: string[];
  mentionLabel?: string;
  auditThreadId?: string;
  assistantMessageExternalId?: string;
}): Promise<{ reviewCount: number; reviewUrl?: string; reviewSummaryMarkdown: string; detail?: string }> {
  const uniqueDingTalkUserIds = Array.from(
    new Set(input.atUserIds.map((item) => String(item || "").trim()).filter(Boolean))
  );
  if (!uniqueDingTalkUserIds.length) {
    return {
      reviewCount: 0,
      reviewSummaryMarkdown: ""
    };
  }

  const usersByDingTalkId = new Map<string, {
    id: string;
    externalId: string | null;
    displayName: string | null;
    email: string | null;
    dingtalkUserId: string | null;
  }>();
  const userRows = await db.user.findMany({
    where: {
      dingtalkUserId: { in: uniqueDingTalkUserIds },
      status: "active"
    },
    select: {
      id: true,
      externalId: true,
      displayName: true,
      email: true,
      dingtalkUserId: true
    }
  });
  for (const row of userRows) {
    const dingtalkUserId = trimOrUndefined(row.dingtalkUserId);
    if (dingtalkUserId) usersByDingTalkId.set(dingtalkUserId, row);
  }

  const baseUrl = trimOrUndefined(input.settings.publicBaseUrl) || trimOrUndefined(appConfig.appBaseUrl) || "";
  const dueAt = aiResponseReviewDueAt(input.settings);
  const resultLabel = zendeskReviewResultLabel({
    decision: input.decision.decision,
    publicReply: input.action.publicReply
  });
  const snapshot = {
    source: input.source,
    ticketId: input.ticketId,
    ticketUrl: input.ticketUrl,
    subject: input.context.ticket.subject,
    requester: zendeskReviewUserDisplay(input.context.ticket.requester, "Unknown requester"),
    assignee: zendeskReviewUserDisplay(input.context.ticket.assignee),
    requesterCommentId: String(input.requesterComment.id),
    zendeskCommentId: input.commentId ? String(input.commentId) : null,
    result: resultLabel,
    decision: input.decision.decision,
    publicReply: input.action.publicReply,
    confidence: input.decision.confidence,
    reasons: input.decision.reasons ?? [],
    publicReplyPreview: input.decision.publicReplyPreview,
    internalNote: input.decision.internalNote,
    zendeskCommentBody: input.action.body
  };

  const reviews = [];
  for (const dingtalkUserId of uniqueDingTalkUserIds) {
    const user = usersByDingTalkId.get(dingtalkUserId);
    const displayName =
      trimOrUndefined(user?.displayName) ||
      trimOrUndefined(user?.email) ||
      dingtalkUserId;
    let review = await aiResponseReviews.upsertRequired({
      source: "zendesk",
      organizationId: undefined,
      integrationInstanceId: input.instanceId,
      threadId: input.auditThreadId,
      assistantMessageExternalId: input.assistantMessageExternalId,
      zendeskRunId: input.runId,
      ticketId: input.ticketId,
      ticketSubject: input.context.ticket.subject,
      ticketUrl: input.ticketUrl,
      zendeskCommentId: input.commentId,
      zendeskRequesterCommentId: input.requesterComment.id,
      reviewerUserId: user?.id,
      reviewerDingTalkUserId: dingtalkUserId,
      reviewerDisplayName: displayName,
      reviewerEmail: trimOrUndefined(user?.email),
      dueAt,
      snapshot
    });
    const reviewUrl = buildAiResponseReviewUrl(baseUrl, review.id);
    if (reviewUrl && review.reviewUrl !== reviewUrl) {
      review = (await aiResponseReviews.updateReviewUrl(review.id, reviewUrl)) ?? review;
    }
    review = await createDingTalkAiResponseReviewTodo({
      review,
      reviewerUnionId: user?.externalId,
      ticketId: input.ticketId,
      ticketSubject: input.context.ticket.subject,
      ticketUrl: input.ticketUrl,
      resultLabel,
      dueAt
    });

    try {
      await sendActiveDingTalkWorkNotice({
        userIds: [dingtalkUserId],
        message: [
          "AI response review required",
          "",
          `Zendesk #${input.ticketId} processed by AI.`,
          `Subject: ${input.context.ticket.subject || "Untitled ticket"}`,
          `Result: ${resultLabel}`,
          `Reviewer: ${displayName}`,
          `Due: ${dueAt.toISOString()}`,
          review.reviewUrl ? `Review link: ${review.reviewUrl}` : "",
          input.ticketUrl ? `Zendesk ticket: ${input.ticketUrl}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      });
      await aiResponseReviews.markNotified(review.id, { status: "sent" });
    } catch (error) {
      await aiResponseReviews.markNotified(review.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "DingTalk work notice failed"
      });
    }
    reviews.push(review);
  }

  const adminUrl = aiResponseReviewAdminUrl(baseUrl, input.ticketId);
  const firstReviewUrl = reviews.find((review) => review.reviewUrl)?.reviewUrl;
  const reviewUrl = firstReviewUrl || adminUrl || undefined;
  return {
    reviewCount: reviews.length,
    reviewUrl,
    reviewSummaryMarkdown: [
      "**AI Review Required**",
      `> ${reviews.length} private review task${reviews.length === 1 ? "" : "s"} created for the @ recipient${reviews.length === 1 ? "" : "s"}.`,
      `> Due: ${dueAt.toISOString()}`,
      adminUrl ? `> Admin tracking: [AI reviews](${adminUrl})` : ""
    ]
      .filter(Boolean)
      .join("\n"),
    detail: [
      `review_count: ${reviews.length}`,
      `due_at: ${dueAt.toISOString()}`,
      adminUrl ? `admin_url: ${adminUrl}` : "",
      firstReviewUrl ? `first_review_url: ${firstReviewUrl}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  };
}

const zendesk = new ZendeskIntegrationService({
  resolveRuntime: async () => createRuntimeForProviderSnapshot(await codexProviders.resolveActiveProviderSnapshot()),
  resolveAgentRuntime: resolveZendeskAgentRuntimeOptions,
  resolveDingTalkMentionTarget: resolveZendeskDingTalkMentionTarget,
  requestDingTalkAiReviews: requestZendeskDingTalkAiReviews,
  conversationAudit: {
    beforeAgentRun: syncZendeskConversationBeforeAgentRun,
    afterAgentRun: syncZendeskConversationAfterAgentRun
  },
  runtimeSession: createZendeskRuntimeSessionBridge(),
  getDrainReason: getDeploymentDrainReason,
  codexSessionHomeRoot: appConfig.codex.sessionHomeRoot,
  async recordUsage(input) {
    const integration = input.instanceId
      ? await db.integrationInstance.findUnique({ where: { id: input.instanceId } })
      : null;
    const integrationSlug =
      typeof integration?.slug === "string" && integration.slug.trim()
        ? integration.slug.trim()
        : input.instanceId || "legacy";
    await usageIngestion.record({
      organizationId: integration?.organizationId ?? undefined,
      userId: `zendesk-bot:${input.instanceId || "legacy"}`,
      threadId: input.auditThreadId,
      sessionId: `zendesk:${input.instanceId || "legacy"}:ticket:${input.ticketId}`,
      model: input.runtime.model,
      featureType: "chat",
      inputTokens: input.usage.inputTokens,
      cachedInputTokens: input.usage.cachedInputTokens,
      outputTokens: input.usage.outputTokens,
      resultStatus: "success",
      metadata: Object.fromEntries(
        Object.entries({
          source: ZENDESK_CHANNEL,
          actorName: "Zendesk 自动回复",
          integrationInstanceId: input.instanceId,
          integrationSlug,
          ticketId: input.ticketId,
          ticketSubject: input.context.ticket.subject,
          requesterId: input.context.ticket.requesterId,
          requesterName: input.context.ticket.requester?.name,
          requesterEmail: input.context.ticket.requester?.email,
          requesterOrganization: input.context.ticket.requester?.organizationName,
          requesterCountryRegion: input.context.ticket.requester?.countryRegion,
          requesterCommentId: input.requesterComment.id,
          runId: input.runId,
          triggerSource: input.source,
          codexThreadId: input.codexThreadId,
          externalConversationKey: input.externalConversationKey
        }).filter(([, value]) => value !== undefined)
      )
    });
  }
});
const brandingAssetStorage = new BrandingAssetStorage(appConfig.brandingAssetRoot);
const policyService = new PolicyService(resourcePolicies);
const integrationCenter = createIntegrationCenterService({
  db: db as unknown as IntegrationCenterDb,
  policies: resourcePolicies as never,
  policyService,
  usageEvents: usageEventRepository,
  zendesk,
  accessResolver: {
    getRoleIdsForUser: async (userId) => (await userRoles.listForUser(userId)).map((assignment) => assignment.roleId),
    getDepartmentIdsForUser: async (userId) => listDepartmentSubjectIdsForUser(userId)
  }
});
const resourceAccessLogs = new ResourceAccessLogService(resourceAccessLogRepository);
const subscriptionEntitlements = new SubscriptionEntitlementService({
  grants: subscriptionGrants,
  plans: subscriptionPlans,
  usageEvents: usageEventRepository,
  denialLogs: subscriptionDenialLogs
});
const managedRouterRuntime = {
  async startThreadWithOptions(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }) {
    const snapshot = await codexProviders.resolveActiveProviderSnapshot();
    const providerRuntime = createRuntimeForProviderSnapshot(snapshot);
    return await providerRuntime.startThreadWithOptions(options);
  },
  async *runStreamed(thread: Awaited<ReturnType<CodexRuntime["startThreadWithOptions"]>>, message: string) {
    yield* runtime.runStreamed(thread, message);
  }
};
async function listDingTalkBotStreamInstances(): Promise<DingTalkBotInstance[]> {
  const rows = await db.integrationInstance.findMany({
    where: {
      type: "dingtalk",
      status: "active"
    },
    orderBy: { createdAt: "asc" }
  });
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [configRows, secretRows] = await Promise.all([
    db.integrationInstanceConfig.findMany({
      where: { integrationInstanceId: { in: ids } }
    }),
    db.integrationInstanceSecret.findMany({
      where: { integrationInstanceId: { in: ids } }
    })
  ]);
  const configById = new Map(configRows.map((row) => [row.integrationInstanceId, asRecord(row.config) ?? {}] as const));
  const secretById = new Map(secretRows.map((row) => [row.integrationInstanceId, asRecord(row.secretState) ?? {}] as const));
  return rows
    .map((row) => {
      const config = configById.get(row.id) ?? {};
      const secret = secretById.get(row.id) ?? {};
      const clientId = asString(config.clientId);
      const clientSecret = asString(secret.clientSecret);
      const apiBaseUrl = asString(config.apiBaseUrl) ?? "https://api.dingtalk.com";
      const robot = normalizeDingTalkBotConfig(config);
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        organizationId: row.organizationId,
        clientId: clientId ?? "",
        clientSecret: clientSecret ?? "",
        apiBaseUrl,
        robot
      };
    })
    .filter((instance) => instance.robot.enabled);
}
const dingtalkBotStream = new DingTalkBotStreamService({
  listInstances: listDingTalkBotStreamInstances,
  handleMessage: handleDingTalkBotMessage,
  logger: console
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

async function listDepartmentSubjectIdsForUser(userId: string): Promise<string[]> {
  const departmentIds = await departmentMemberships.listIdsForUser(userId);
  const departmentRows = await Promise.all(
    departmentIds.map((departmentId) => departments.getById(departmentId).catch(() => null))
  );
  return uniqueStrings([
    ...departmentIds,
    ...departmentRows.map((department) => department?.externalId)
  ]);
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
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
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
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
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
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
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
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
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
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
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
  listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
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
  nativeCodexSkills,
  managedSkills: codexSkills,
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
  organizations,
  organizationMemberships,
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
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const crestMcpProxyScriptPath = path.resolve(moduleDir, "..", "scripts", "crest-mcp-proxy.mjs");
const RUNTIME_CAPABILITIES_RUN_CONFIG_KEY = "_agentStudioRuntimeCapabilities";
const CREST_PROXY_TOKEN_REFRESH_SKEW_MS = 15 * 60_000;

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

function appendRuntimeAnswerPreview(
  current: string,
  event: { delta?: string; text?: string; raw?: unknown }
): string {
  const raw = asRecord(event.raw);
  if (raw?.type === "item.completed") return current;
  if (event.delta) return current + event.delta;
  if (event.text && !current) return event.text;
  return current;
}

async function getDeploymentDrainReason(): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(appConfig.deployDrainFile, "utf8");
    const parsed = asRecord(JSON.parse(raw));
    const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
    return reason || "System is updating. Please retry in a few minutes.";
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") {
      return undefined;
    }
    console.warn("failed to read deploy drain file", {
      path: appConfig.deployDrainFile,
      detail: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
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
    const materializedCodexHome = await materializeCodexHomeForRunConfig({
      scopeId: session.threadId ? `thread-${session.threadId}` : `session-${session.sessionId}`,
      codexRunConfig: withoutRuntimeCapabilityMetadata(session.codexRunConfig)
    });
    const runtimeLaunch = await resolveRuntimeLaunchConfig({
      userId: session.userId,
      workspace: session.workspace,
      codexRunConfig: materializedCodexHome.codexRunConfig
    });
    const sessionRuntime = createRuntimeForProviderSnapshot(await resolveProviderSnapshot({
      existingSnapshot: session.providerSnapshot,
      fallbackToLocalAuth: true
    }), {
      configOverrides: runtimeLaunch.configOverrides,
      envOverrides: {
        CODEX_HOME: materializedCodexHome.codexHome
      }
    });
    const liveThread = await sessionRuntime.resumeThreadWithOptions({
      threadId: codexThreadId,
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      workspace: session.workspace,
      codexRunConfig: stripInternalRunConfigMetadata(runtimeLaunch.codexRunConfig)
    });
    if (stableJson(session.codexRunConfig) !== stableJson(runtimeLaunch.codexRunConfig)) {
      await sessions.update(session.sessionId, {
        codexRunConfig: runtimeLaunch.codexRunConfig
      });
    }
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

async function refreshLiveRuntimeThread(session: SessionRecord): Promise<SessionRecord | undefined> {
  liveRuntimeThreads.delete(session.sessionId);
  const restored = await restoreLiveRuntimeThread(session);
  if (!restored) return undefined;
  return await sessions.peek(session.sessionId) ?? session;
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

const crestChatStreamSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  delegationToken: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional(),
  conversationId: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(8000),
  context: z.record(z.unknown()).optional(),
  attachments: z
    .array(
      z.object({
        fileId: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(180),
        mimeType: z.string().trim().max(120).optional(),
        bytes: z.number().int().nonnegative().optional(),
        sha256: z.string().trim().max(80).optional()
      })
    )
    .max(10)
    .optional()
});

const crestDelegationIntrospectionSchema = z.object({
  active: z.boolean(),
  user: z
    .object({
      id: z.string().trim().min(1),
      domainName: z.string().trim().optional(),
      email: z.string().trim().email().optional(),
      fullName: z.string().trim().optional(),
      businessUnitId: z.string().trim().optional(),
      businessUnitName: z.string().trim().optional(),
      roleNames: z.array(z.string()).optional(),
      appNames: z.array(z.string()).optional(),
      defaultCurrency: z.string().trim().optional()
    })
    .passthrough(),
  delegationExpiresAt: z.string().trim().min(1)
});

const crestDelegationRefreshSchema = z.object({
  user: crestDelegationIntrospectionSchema.shape.user,
  delegationToken: z.string().trim().min(1),
  delegationExpiresAt: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional()
});

const crestArtifactContentSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  delegationToken: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional(),
  threadId: z.string().trim().min(1),
  artifactId: z.string().trim().min(1),
  disposition: z.enum(["inline", "attachment"]).optional()
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
  message_id: z.string().trim().min(1),
  content_preview: z.string().optional(),
  comment: z.string().max(1000).optional()
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
    message: "Either relative_path or path is required"
  });

const artifactResolveQuerySchema = z.object({
  path: z.string().trim().min(1)
});

const artifactContentQuerySchema = z.object({
  disposition: z.enum(["inline", "attachment"]).optional()
});

const artifactPathContentQuerySchema = artifactResolveQuerySchema.extend({
  disposition: z.enum(["inline", "attachment"]).optional()
});

type SessionOptions = {
  userId: string;
  organizationId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  codexHome?: string;
  providerSnapshot: ManagedCodexProviderSnapshot;
};

type RuntimeCapabilityFingerprint = {
  crestCrm?: {
    enabled: true;
    proxyTokenExpiresAt: string;
  };
};

type DesiredRuntimeCapabilities = {
  crestCrm?: {
    enabled: true;
  };
};

type RuntimeLaunchConfig = {
  configOverrides?: Record<string, unknown>;
  codexRunConfig?: Record<string, unknown>;
};

type ModeSelection = {
  modeId: string;
  workspaceRootPath: string;
  runtimeProfile: PortalRuntimeOptionRunProfile;
};

type EnabledSkillSelection = {
  id: string;
  name: string;
  managedSkillId?: string;
  sourcePath?: string;
  activationPrompt?: string;
};

type CurrentActor = {
  id: string;
  userType?: string;
  role?: string;
  organizationId: string;
  organizationSlug?: string;
  organizationType?: string;
  membershipType?: string;
};

const QUOTA_ACCESS_DENIED_MESSAGE = "Current quota limit has been exceeded; cannot create a new session";

function statusCodeForSessionAccessError(error: unknown): number {
  if (isChatAccessDeniedError(error)) return 403;
  const detail = error instanceof Error ? error.message : "";
  return detail === QUOTA_ACCESS_DENIED_MESSAGE ? 403 : 400;
}

function payloadForSessionAccessError(error: unknown, fallbackDetail: string): {
  detail: string;
  code?: string;
  reason_code?: string;
} {
  const detail = error instanceof Error ? error.message : fallbackDetail;
  if (isChatAccessDeniedError(error)) {
    return {
      detail,
      code: error.code,
      reason_code: error.reasonCode ?? undefined
    };
  }
  if (detail === QUOTA_ACCESS_DENIED_MESSAGE) {
    return {
      detail,
      code: "QUOTA_LIMIT_REACHED"
    };
  }
  return { detail };
}

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

function runtimeCapabilitiesFromRunConfig(
  codexRunConfig?: Record<string, unknown>
): RuntimeCapabilityFingerprint {
  const raw = asRecord(codexRunConfig?.[RUNTIME_CAPABILITIES_RUN_CONFIG_KEY]);
  const crestRaw = asRecord(raw?.crestCrm);
  const proxyTokenExpiresAt =
    typeof crestRaw?.proxyTokenExpiresAt === "string" ? trimOrUndefined(crestRaw.proxyTokenExpiresAt) : undefined;
  if (crestRaw?.enabled === true && proxyTokenExpiresAt) {
    return {
      crestCrm: {
        enabled: true,
        proxyTokenExpiresAt
      }
    };
  }
  return {};
}

function withoutRuntimeCapabilityMetadata(
  codexRunConfig?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!codexRunConfig) return codexRunConfig;
  const next = { ...codexRunConfig };
  delete next[RUNTIME_CAPABILITIES_RUN_CONFIG_KEY];
  return next;
}

function withRuntimeCapabilityMetadata(
  codexRunConfig: Record<string, unknown> | undefined,
  capabilities: RuntimeCapabilityFingerprint
): Record<string, unknown> | undefined {
  const next = withoutRuntimeCapabilityMetadata(codexRunConfig);
  if (!capabilities.crestCrm) return next;
  return {
    ...(next ?? {}),
    [RUNTIME_CAPABILITIES_RUN_CONFIG_KEY]: capabilities
  };
}

function runtimeCapabilityComparableConfig(
  codexRunConfig?: Record<string, unknown>
): Record<string, unknown> | undefined {
  return withoutRuntimeCapabilityMetadata(codexRunConfig);
}

function runtimeCapabilitiesAreCurrent(
  codexRunConfig: Record<string, unknown> | undefined,
  desired: DesiredRuntimeCapabilities,
  now = Date.now()
): boolean {
  const active = runtimeCapabilitiesFromRunConfig(codexRunConfig);
  if (desired.crestCrm?.enabled) {
    const expiresAt = active.crestCrm?.proxyTokenExpiresAt;
    if (!expiresAt) return false;
    const expiresAtMs = new Date(expiresAt).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > now + CREST_PROXY_TOKEN_REFRESH_SKEW_MS;
  }
  return active.crestCrm?.enabled !== true;
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
    enabled_skills: enabledSkillSelectionsFromRunConfig(thread.codexRunConfig).map((skill) => ({
      id: skill.id,
      name: skill.name,
      managed_skill_id: skill.managedSkillId ?? null
    })),
    enabled_skill_names: enabledSkillNamesFromRunConfig(thread.codexRunConfig),
    created_at: thread.createdAt,
    updated_at: thread.updatedAt
  };
}

function feedbackOut(feedback: ThreadFeedback) {
  return {
    id: feedback.id,
    type: feedback.type,
    message_id: feedback.messageId ?? null,
    content_preview: feedback.contentPreview ?? null,
    comment: feedback.comment ?? null,
    user_id: feedback.userId ?? null,
    created_at: feedback.createdAt,
    updated_at: feedback.updatedAt ?? null
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
    snapshot: rewritePublicShareKnowledgeImages(share.snapshot, share.token),
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

async function resolveActiveCrestIntegrationConfig() {
  const instance = await db.integrationInstance.findFirst({
    where: { type: "crest_crm", status: "active" },
    orderBy: { updatedAt: "desc" }
  });
  if (!instance) return appConfig.crest;

  const [configRow, secretRow] = await Promise.all([
    db.integrationInstanceConfig.findUnique({ where: { integrationInstanceId: instance.id } }),
    db.integrationInstanceSecret.findUnique({ where: { integrationInstanceId: instance.id } })
  ]);
  const config = asRecord(configRow?.config);
  const secret = asRecord(secretRow?.secretState);
  return {
    baseUrl: trimOrUndefined(config?.baseUrl as string | undefined) ?? appConfig.crest.baseUrl,
    clientId: trimOrUndefined(config?.clientId as string | undefined) ?? appConfig.crest.clientId,
    clientSecret:
      trimOrUndefined(secret?.clientSecret as string | undefined) ?? appConfig.crest.clientSecret
  };
}

function safeEqual(left: string | undefined, right: string | undefined): boolean {
  const a = Buffer.from(left ?? "");
  const b = Buffer.from(right ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function assertCrestClient(input: { clientId?: string; clientSecret?: string }) {
  const config = await resolveActiveCrestIntegrationConfig();
  if (!config.clientId || !config.clientSecret || !config.baseUrl) {
    throw new Error("Crest CRM integration is not configured");
  }
  if (!safeEqual(input.clientId, config.clientId) || !safeEqual(input.clientSecret, config.clientSecret)) {
    throw new Error("Invalid Crest integration credentials");
  }
  return config;
}

async function introspectCrestDelegation(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  delegationToken: string;
}) {
  const response = await fetch(`${input.baseUrl.replace(/\/+$/, "")}/v1/agent-studio/delegation/introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      delegationToken: input.delegationToken
    })
  });
  const data = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const detail = asRecord(data)?.detail;
    throw new Error(typeof detail === "string" ? detail : "Crest delegation introspection failed");
  }
  const parsed = crestDelegationIntrospectionSchema.parse(data);
  if (!parsed.active) throw new Error("Crest delegation is inactive");
  return parsed;
}

async function resolveCrestActor(input: {
  clientId: string;
  clientSecret: string;
  delegationToken: string;
  delegationRefreshToken?: string;
  delegationRefreshExpiresAt?: string;
}): Promise<CurrentActor> {
  const config = await assertCrestClient(input);
  const introspected = await introspectCrestDelegation({
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    delegationToken: input.delegationToken
  });
  const resolved = await resolveCrestUser({
    users,
    identities: authIdentities,
    memberships: organizationMemberships,
    organizations,
    identity: {
      user: introspected.user,
      delegationToken: input.delegationToken,
      delegationExpiresAt: introspected.delegationExpiresAt,
      delegationRefreshToken: input.delegationRefreshToken,
      delegationRefreshExpiresAt: input.delegationRefreshExpiresAt
    }
  });
  if (input.delegationRefreshToken) {
    await crestDelegationCredentials.upsertForUser({
      userId: resolved.user.id,
      providerSubject: `crest:${introspected.user.id}`,
      delegationToken: input.delegationToken,
      delegationExpiresAt: introspected.delegationExpiresAt,
      delegationRefreshToken: input.delegationRefreshToken,
      delegationRefreshExpiresAt: input.delegationRefreshExpiresAt
    });
  }
  return {
    id: resolved.user.id,
    userType: resolved.user.userType,
    role: resolved.user.role,
    organizationId: resolved.organizationId,
    organizationType: "internal",
    membershipType: INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE
  };
}

async function canUseCrestMcpForUser(userId: string): Promise<boolean> {
  if (!(await hasUsableCrestDelegation(userId))) return false;
  const proxyScriptExists = await fs.access(crestMcpProxyScriptPath).then(
    () => true,
    () => false
  );
  return proxyScriptExists;
}

async function desiredRuntimeCapabilitiesForUser(userId?: string): Promise<DesiredRuntimeCapabilities> {
  if (!userId || !(await canUseCrestMcpForUser(userId))) return {};
  return {
    crestCrm: {
      enabled: true
    }
  };
}

async function buildCrestMcpRuntimeConfigForUser(
  userId: string,
  workspacePath?: string
): Promise<{ configOverrides: Record<string, unknown>; capabilities: RuntimeCapabilityFingerprint } | undefined> {
  if (!(await canUseCrestMcpForUser(userId))) return undefined;
  const proxyScriptPath =
    (workspacePath ? await materializeCrestMcpProxyScript(workspacePath) : undefined) ?? crestMcpProxyScriptPath;
  const proxyToken = issueCrestProxyTokenLease(userId);
  return {
    configOverrides: {
      mcp_servers: {
        crest_crm: {
          command: process.execPath,
          args: [proxyScriptPath],
          default_tools_approval_mode: "approve",
          env: {
            AGENT_STUDIO_BASE_URL: agentStudioInternalBaseUrl(),
            AGENT_STUDIO_CREST_PROXY_TOKEN: proxyToken.token
          }
        }
      }
    },
    capabilities: {
      crestCrm: {
        enabled: true,
        proxyTokenExpiresAt: proxyToken.expiresAt
      }
    }
  };
}

async function resolveRuntimeLaunchConfig(input: {
  userId?: string;
  workspace?: string;
  codexRunConfig?: Record<string, unknown>;
}): Promise<RuntimeLaunchConfig> {
  const crestMcp = input.userId
    ? await buildCrestMcpRuntimeConfigForUser(input.userId, input.workspace)
    : undefined;
  return {
    configOverrides: crestMcp?.configOverrides,
    codexRunConfig: withRuntimeCapabilityMetadata(
      input.codexRunConfig,
      crestMcp?.capabilities ?? {}
    )
  };
}

async function sessionRuntimeCapabilitiesAreCurrent(session: SessionRecord, userId?: string): Promise<boolean> {
  const desired = await desiredRuntimeCapabilitiesForUser(userId ?? session.userId);
  return runtimeCapabilitiesAreCurrent(session.codexRunConfig, desired);
}

async function materializeCrestMcpProxyScript(workspacePath: string): Promise<string | undefined> {
  const workspace = trimOrUndefined(workspacePath);
  if (!workspace) return undefined;
  const targetDir = path.join(workspace, ".agent-studio");
  const targetPath = path.join(targetDir, "crest-mcp-proxy.mjs");
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(crestMcpProxyScriptPath, targetPath);
    await fs.chmod(targetPath, 0o644);
    return targetPath;
  } catch (error) {
    console.warn("failed to materialize Crest MCP proxy script", {
      workspacePath: workspace,
      detail: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

async function hasUsableCrestDelegation(userId: string): Promise<boolean> {
  const credential = await crestDelegationCredentials.getForUser(userId);
  if (crestDelegationCredentials.isUsable(credential)) return true;
  const identity = (await authIdentities.listForUser(userId)).find((item) => item.provider === "crest");
  const profile = asRecord(identity?.profileJson);
  const token = typeof profile?.delegationToken === "string" ? trimOrUndefined(profile.delegationToken) : undefined;
  const expiresAt =
    typeof profile?.delegationExpiresAt === "string" ? trimOrUndefined(profile.delegationExpiresAt) : undefined;
  if (!identity || !token) return false;
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

function agentStudioInternalBaseUrl(): string {
  return (process.env.AGENT_STUDIO_INTERNAL_BASE_URL || "").trim() || `http://127.0.0.1:${appConfig.port}`;
}

function createRuntimeForProviderSnapshot(
  snapshot?: ManagedCodexProviderSnapshot,
  overrides?: { envOverrides?: Record<string, string>; configOverrides?: Record<string, unknown> }
): CodexRuntime {
  const runtimeOptions = snapshot?.runtimeOptions;
  const hasEnvOverrides = Boolean(overrides?.envOverrides && Object.keys(overrides.envOverrides).length > 0);
  const hasConfigOverrides = Boolean(
    overrides?.configOverrides && Object.keys(overrides.configOverrides).length > 0
  );
  if (!hasEnvOverrides && !hasConfigOverrides) {
    return new CodexRuntime(runtimeOptions);
  }
  return new CodexRuntime({
    ...(runtimeOptions ?? {}),
    config: mergePlainConfig(runtimeOptions?.config, overrides?.configOverrides),
    envOverrides: {
      ...(runtimeOptions?.envOverrides ?? {}),
      ...(overrides?.envOverrides ?? {})
    }
  });
}

function mergePlainConfig(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  if (!base) return override;
  if (!override) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] =
      current && typeof current === "object" && !Array.isArray(current) && value && typeof value === "object" && !Array.isArray(value)
        ? mergePlainConfig(current as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return merged;
}

async function resolveProviderSnapshot(input?: {
  existingSnapshot?: ManagedCodexProviderSnapshot;
  fallbackToLocalAuth?: boolean;
}): Promise<ManagedCodexProviderSnapshot> {
  if (input?.existingSnapshot) {
    return input.existingSnapshot;
  }
  if (input?.fallbackToLocalAuth) {
    return createLocalAuthProviderSnapshot();
  }
  return await codexProviders.resolveActiveProviderSnapshot();
}

function createThreadPublicShareToken(): string {
  return randomBytes(18).toString("base64url");
}

const KNOWLEDGE_SET_PATH_SEGMENT = `${path.sep}data${path.sep}knowledge-sets${path.sep}`;
const PUBLIC_SHARE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"]);
const KNOWLEDGE_SET_IMAGE_PATH_PATTERN =
  /\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/[^\n<>"'`]*?\.(?:png|jpe?g|gif|webp|bmp|svg|avif)/giu;

function publicShareKnowledgeImageUrl(token: string, imagePath: string): string {
  const query = new URLSearchParams({ path: imagePath });
  return `/public-api/thread-shares/${encodeURIComponent(token)}/files/content?${query.toString()}`;
}

function rewriteKnowledgeImagePathsInText(text: string, token: string): string {
  return text.replace(KNOWLEDGE_SET_IMAGE_PATH_PATTERN, (match) => publicShareKnowledgeImageUrl(token, match));
}

function rewritePublicShareKnowledgeImages(snapshot: unknown, token: string): unknown {
  const publicSnapshot = structuredClone(snapshot) as ThreadPublicShareSnapshot;
  for (const turn of publicSnapshot.turns ?? []) {
    for (const message of turn.messages ?? []) {
      for (const part of message.parts ?? []) {
        if (part.type === "text") {
          part.text = rewriteKnowledgeImagePathsInText(part.text, token);
        }
      }
      for (const row of message.processRows ?? []) {
        if (row.detail) {
          row.detail = rewriteKnowledgeImagePathsInText(row.detail, token);
        }
      }
    }
  }
  return publicSnapshot;
}

function collectKnowledgeImagePathsFromSnapshot(snapshot: ThreadPublicShareSnapshot): Set<string> {
  const imagePaths = new Set<string>();
  const addFromText = (text: string | undefined) => {
    if (!text) return;
    KNOWLEDGE_SET_IMAGE_PATH_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = KNOWLEDGE_SET_IMAGE_PATH_PATTERN.exec(text)) !== null) {
      imagePaths.add(path.resolve(match[0]));
    }
  };

  for (const turn of snapshot.turns ?? []) {
    for (const message of turn.messages ?? []) {
      for (const part of message.parts ?? []) {
        if (part.type === "text") {
          addFromText(part.text);
        }
      }
      for (const row of message.processRows ?? []) {
        addFromText(row.detail);
      }
    }
  }
  return imagePaths;
}

function isPublicShareKnowledgeImagePath(candidatePath: string): boolean {
  const normalized = path.resolve(candidatePath);
  const ext = path.extname(normalized).toLowerCase();
  return (
    normalized.includes(KNOWLEDGE_SET_PATH_SEGMENT) &&
    normalized.includes(`${path.sep}media${path.sep}`) &&
    PUBLIC_SHARE_IMAGE_EXTENSIONS.has(ext)
  );
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

function enabledSkillNamesFromRunConfig(codexRunConfig?: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const item of enabledSkillSelectionsFromRunConfig(codexRunConfig)) {
    if (!names.includes(item.name)) {
      names.push(item.name);
    }
  }
  return names;
}

function enabledSkillSelectionsFromRunConfig(codexRunConfig?: Record<string, unknown>): EnabledSkillSelection[] {
  const raw = codexRunConfig?.enabledSkills;
  if (!Array.isArray(raw)) return [];
  const selections: EnabledSkillSelection[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const skillName = trimOrUndefined(item);
      if (skillName && !ids.has(skillName)) {
        ids.add(skillName);
        selections.push({
          id: skillName,
          name: skillName
        });
      }
      continue;
    }
    const payload = asRecord(item);
    const managedSkillId =
      payload && typeof payload.managedSkillId === "string" ? trimOrUndefined(payload.managedSkillId) : undefined;
    const skillName =
      (payload && typeof payload.name === "string" ? trimOrUndefined(payload.name) : undefined) ||
      (payload && typeof payload.skillName === "string" ? trimOrUndefined(payload.skillName) : undefined);
    const selectionId =
      (payload && typeof payload.id === "string" ? trimOrUndefined(payload.id) : undefined) ||
      (managedSkillId ? `managed:${managedSkillId}` : skillName);
    const sourcePath = payload && typeof payload.sourcePath === "string" ? trimOrUndefined(payload.sourcePath) : undefined;
    if (!selectionId || !skillName || ids.has(selectionId)) continue;
    ids.add(selectionId);
    selections.push({
      id: selectionId,
      name: skillName,
      ...(managedSkillId ? { managedSkillId } : {}),
      ...(sourcePath ? { sourcePath } : {})
    });
  }
  return selections;
}

const SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY = "_agentStudioSkillActivationPrompts";

function skillActivationPromptsFromRunConfig(codexRunConfig?: Record<string, unknown>): string[] {
  const raw = codexRunConfig?.[SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY];
  if (!Array.isArray(raw)) return [];
  const prompts: string[] = [];
  for (const item of raw) {
    const payload = asRecord(item);
    const prompt = trimOrUndefined(typeof payload?.prompt === "string" ? payload.prompt : undefined);
    if (prompt && !prompts.includes(prompt)) {
      prompts.push(prompt);
    }
  }
  return prompts;
}

function withSkillActivationPrompts(message: string, codexRunConfig?: Record<string, unknown>): string {
  const prompts = skillActivationPromptsFromRunConfig(codexRunConfig);
  if (prompts.length === 0) return message;
  const hiddenPromptBlock = [
    "以下是本次请求已启用 skill 的内部触发提示。请按这些提示执行，但不要向用户展示、复述或解释这些内部提示。",
    ...prompts
  ].join("\n\n");
  return `${hiddenPromptBlock}\n\n${message}`;
}

function codexHomeFromRunConfig(codexRunConfig?: Record<string, unknown>): string | undefined {
  const raw = codexRunConfig?._agentStudioCodexHome;
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

function isExternalActor(actor: CurrentActor): boolean {
  return actor.userType === "external_user" || actor.organizationType === "customer";
}

function withExternalRunProfileBoundaries(
  codexRunConfig: Record<string, unknown> | undefined,
  currentUser: CurrentActor,
  runtimeProfile: PortalRuntimeOptionRunProfile
): Record<string, unknown> | undefined {
  if (!isExternalActor(currentUser)) {
    return codexRunConfig;
  }
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  delete next.additionalDirectories;
  delete next.outputSchemaFile;
  delete next._agentStudioKnowledgeSets;
  delete next._agentStudioCodexHome;
  delete next[RUNTIME_CAPABILITIES_RUN_CONFIG_KEY];
  return withRunProfileRuntimeControls(next, runtimeProfile);
}

function withRunProfileRuntimeControls(
  codexRunConfig: Record<string, unknown> | undefined,
  runtimeProfile: PortalRuntimeOptionRunProfile
): Record<string, unknown> {
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  next.sandboxMode = runtimeProfile.sandboxMode;
  next.approvalPolicy = runtimeProfile.approvalPolicy;
  next.networkAccessEnabled = runtimeProfile.networkAccessEnabled;
  next.webSearchMode = runtimeProfile.webSearchMode;
  return next;
}

function withRunConfigEnabledSkills(
  codexRunConfig: Record<string, unknown> | undefined,
  enabledSkills: EnabledSkillSelection[]
): Record<string, unknown> {
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  next.enabledSkills = enabledSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    ...(skill.managedSkillId ? { managedSkillId: skill.managedSkillId } : {}),
    ...(skill.sourcePath ? { sourcePath: skill.sourcePath } : {})
  }));
  return next;
}

function withRunConfigSkillActivationPrompts(
  codexRunConfig: Record<string, unknown> | undefined,
  enabledSkills: EnabledSkillSelection[]
): Record<string, unknown> {
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  const promptItems = enabledSkills
    .map((skill) => ({
      name: trimOrUndefined(skill.name),
      prompt: trimOrUndefined(skill.activationPrompt)
    }))
    .filter((item): item is { name: string; prompt: string } => Boolean(item.name && item.prompt));
  if (promptItems.length > 0) {
    next[SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY] = promptItems;
  } else {
    delete next[SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY];
  }
  return next;
}

function withRunConfigEnabledSkillSelection(
  codexRunConfig: Record<string, unknown> | undefined,
  enabledSkills: EnabledSkillSelection[]
): Record<string, unknown> {
  return withRunConfigSkillActivationPrompts(
    withRunConfigEnabledSkills(
      codexRunConfig,
      enabledSkills
    ),
    enabledSkills
  );
}

function selectionIdForManagedSkill(managedSkillId: string): string {
  return `managed:${managedSkillId}`;
}

function skillNameFromBindingPayload(value: unknown): string | undefined {
  const payload = asRecord(value);
  if (!payload) return undefined;
  const skillName = payload.skillName ?? payload.name;
  return typeof skillName === "string" ? trimOrUndefined(skillName) : undefined;
}

function skillActivationPromptFromBindingPayload(value: unknown): string | undefined {
  const payload = asRecord(value);
  if (!payload) return undefined;
  const prompt = payload.activationPrompt ?? payload.defaultPrompt ?? payload.prompt;
  return typeof prompt === "string" ? trimOrUndefined(prompt) : undefined;
}

async function resolveEnabledSkillsForBotMode(agentModeId: string): Promise<EnabledSkillSelection[]> {
  const agentMode = await agentModes.get(agentModeId);
  if (!agentMode) return [];

  const nativeSkillMap = new Map((await nativeCodexSkills.list()).map((skill) => [skill.name, skill] as const));
  const selections: EnabledSkillSelection[] = [];
  const selectedIds = new Set<string>();
  const selectedNames = new Set<string>();

  for (const modeSkillPackage of agentMode.skillPackages) {
    const skillPackage = await skillPackages.get(modeSkillPackage.skillPackageId);
    if (!skillPackage || trimOrUndefined(skillPackage.status) !== "active") {
      continue;
    }

    for (const item of skillPackage.items) {
      for (const binding of item.runtimeBindings) {
        if (binding.runtimeType !== "codex" || binding.bindingType !== "codex_skill") continue;
        const payload = asRecord(binding.bindingPayload);
        const skillName = skillNameFromBindingPayload(binding.bindingPayload);
        if (!skillName) continue;
        const activationPrompt = skillActivationPromptFromBindingPayload(binding.bindingPayload);
        const managedSkillId =
          typeof payload?.managedSkillId === "string" ? trimOrUndefined(payload.managedSkillId) : undefined;

        if (managedSkillId) {
          const managedSkill = await codexSkills.getManagedSkill(managedSkillId);
          if (!managedSkill || managedSkill.status !== "active") continue;
          const selectionId = selectionIdForManagedSkill(managedSkill.id);
          const nameKey = managedSkill.skillName.trim().toLowerCase();
          if (selectedIds.has(selectionId) || selectedNames.has(nameKey)) continue;
          selectedIds.add(selectionId);
          selectedNames.add(nameKey);
          selections.push({
            id: selectionId,
            name: managedSkill.skillName,
            managedSkillId: managedSkill.id,
            sourcePath: managedSkill.publishedPath,
            activationPrompt
          });
          continue;
        }

        const nativeSkill = nativeSkillMap.get(skillName);
        if (!nativeSkill) continue;
        const nameKey = nativeSkill.name.trim().toLowerCase();
        if (selectedIds.has(nativeSkill.name) || selectedNames.has(nameKey)) continue;
        selectedIds.add(nativeSkill.name);
        selectedNames.add(nameKey);
        selections.push({
          id: nativeSkill.name,
          name: nativeSkill.name,
          activationPrompt
        });
      }
    }
  }

  return selections;
}

function withRunConfigCodexHome(
  codexRunConfig: Record<string, unknown> | undefined,
  codexHome: string
): Record<string, unknown> {
  const next = codexRunConfig ? { ...codexRunConfig } : {};
  next._agentStudioCodexHome = codexHome;
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
    userType: req.currentUser.userType,
    role: req.currentUser.role,
    organizationId: req.currentOrganization.id,
    organizationSlug: req.currentOrganization.slug,
    organizationType: req.currentOrganization.type,
    membershipType: req.currentMembership?.membershipType
  };
}

async function ensureCrestChatThread(input: {
  currentUser: CurrentActor;
  conversationId: string;
  message: string;
  context?: Record<string, unknown>;
}): Promise<{ thread: ThreadRecord; session: SessionRecord }> {
  const externalId = `crest:${input.currentUser.id}:${sanitizePathSegment(input.conversationId, "conversation")}`;
  const existing = await threads.getByExternalId(externalId, input.currentUser.organizationId);
  if (existing) {
    const activeThread = existing.status === "archived" ? await threads.update(existing.id, { status: "regular" }) : existing;
    const session = await ensureThreadSession(input.currentUser, activeThread.id, {
      codex_run_config: activeThread.codexRunConfig,
      force_run_profile_controls: true
    });
    return { thread: (await threads.get(activeThread.id, input.currentUser.organizationId)) ?? activeThread, session };
  }

  const threadId = randomUUID().replace(/-/g, "");
  const allocated = await allocateThreadWorkspacePath({
    currentUser: input.currentUser,
    threadId
  });
  const codexRunConfig = withRunProfileRuntimeControls({
    mode: allocated.modeId,
    channel: "crest",
    crest: {
      conversationId: input.conversationId,
      context: input.context ?? {}
    }
  }, allocated.runtimeProfile);
  const options = await resolveSessionOptions(
    { codex_run_config: codexRunConfig },
    input.currentUser,
    allocated.workspacePath,
    allocated.modeId,
    allocated.runtimeProfile
  );
  await assertChatAllowsNewSession({
    currentUser: input.currentUser,
    model: options.model,
    featureType: "chat"
  });
  const created = await threads.create({
    id: threadId,
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    title: crestThreadTitle(input.message),
    externalId,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: options.codexRunConfig
  });
  const session = await createSession(options, created.id);
  return { thread: (await threads.get(created.id, input.currentUser.organizationId)) ?? created, session };
}

async function handleCrestChatStream(req: Request, res: Response): Promise<void> {
  initSSE(res);
  const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);
  try {
    const input = crestChatStreamSchema.parse(req.body || {});
    const drainReason = await getDeploymentDrainReason();
    if (drainReason) {
      sendSSE(res, "error", { message: drainReason });
      return;
    }

    const currentUser = await resolveCrestActor(input);
    const { thread, session } = await ensureCrestChatThread({
      currentUser,
      conversationId: input.conversationId,
      message: input.message,
      context: input.context
    });
    let currentSession = session;
    let liveThread = liveRuntimeThreads.get(currentSession.sessionId) || await restoreLiveRuntimeThread(currentSession);
    if (!liveThread) {
      currentSession = await ensureThreadSession(currentUser, thread.id, {
        codex_run_config: thread.codexRunConfig,
        force_run_profile_controls: true
      });
      liveThread = liveRuntimeThreads.get(currentSession.sessionId) || await restoreLiveRuntimeThread(currentSession);
    }
    if (!liveThread) throw new Error("Agent Studio session is not available");

    await assertChatAllowsNewSession({
      currentUser,
      model: currentSession.model,
      threadId: thread.id,
      sessionId: currentSession.sessionId,
      featureType: "chat"
    });

    const preparedAttachments = await materializeCrestAttachments({
      input,
      workspacePath: currentSession.workspace
    });

    sendSSE(res, "thought", {
      text: `已路由到 Agent Studio，对话已同步到 thread ${thread.id}。`
    });
    if (preparedAttachments.length > 0) {
      sendSSE(res, "thought", {
        text: `已接收 ${preparedAttachments.length} 个 Crest 原文件附件，运行时将直接读取文件。`
      });
    }

    const userMessageId = `crest-user-${randomUUID().replace(/-/g, "")}`;
    await threads.appendMessage(thread.id, {
      parentId: thread.headId ?? null,
      message: crestStoredMessage(
        "user",
        userMessageId,
        input.message,
        {
          conversationId: input.conversationId,
          context: input.context ?? {}
        },
        preparedAttachments
      ),
      runConfig: { channel: "crest", conversationId: input.conversationId }
    });

    const artifactScanStartedAt = new Date(Date.now() - 2000);
    const runtimeFileChanges: RuntimeFileChange[] = [];
    await streamRuntimeCompletionWithBestEffortUsage({
      events: runtime.runStreamed(
        liveThread,
        withSkillActivationPrompts(
          crestRuntimePrompt(input, preparedAttachments),
          currentSession.codexRunConfig
        )
      ),
      onEvent(event) {
        runtimeFileChanges.push(...extractRuntimeFileChanges(event));
        const codexThreadId = extractCodexThreadIdFromRuntimeEvent(event);
        if (codexThreadId) {
          void persistSessionCodexThreadId(currentSession, codexThreadId).then((updated) => {
            currentSession = updated;
          });
        }
        emitCrestRuntimeEvent(res, event);
      },
      async onDone(payload) {
        let generatedArtifacts: ThreadArtifactRecord[] = [];
        try {
          generatedArtifacts = await registerGeneratedArtifactsForSession({
            currentUser,
            session: currentSession,
            changes: runtimeFileChanges,
            answerText: payload.answer,
            changedAfter: artifactScanStartedAt
          });
          if (generatedArtifacts.length > 0) {
            sendSSE(res, "artifacts", {
              threadId: thread.id,
              sessionId: currentSession.sessionId,
              artifacts: generatedArtifacts.map(artifactOut)
            });
          }
        } catch (error) {
          console.warn("crest chat artifact registration failed", {
            threadId: thread.id,
            detail: error instanceof Error ? error.message : String(error)
          });
          sendSSE(res, "artifact_warning", {
            detail: "Generated files could not be registered for Crest download"
          });
        }
        const output = payload.answer.trim() || "(无输出)";
        await threads.appendMessage(thread.id, {
          parentId: userMessageId,
          message: crestStoredMessage("assistant", `crest-assistant-${randomUUID().replace(/-/g, "")}`, output, {
            conversationId: input.conversationId,
            sessionId: currentSession.sessionId,
            artifacts: generatedArtifacts.map(artifactOut)
          }),
          runConfig: { channel: "crest", conversationId: input.conversationId }
        });
        sendSSE(res, "done", {
          output,
          durationMs: 0,
          threadId: thread.id,
          sessionId: currentSession.sessionId
        });
      },
      async recordUsage(usage) {
        await usageIngestion.record({
          organizationId: currentUser.organizationId,
          userId: currentUser.id,
          threadId: thread.id,
          sessionId: currentSession.sessionId,
          model: currentSession.model,
          featureType: "chat",
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          resultStatus: "success",
          metadata: { source: "crest_chat_stream" }
        });
      },
      onTelemetryError(error) {
        console.warn("crest chat usage telemetry failed", {
          threadId: thread.id,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    });

  } catch (error) {
    sendSSE(res, "error", { message: error instanceof Error ? error.message : "Crest chat stream failed" });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

async function handleCrestArtifactContent(req: Request, res: Response): Promise<void> {
  try {
    const input = crestArtifactContentSchema.parse(req.body || {});
    const currentUser = await resolveCrestActor(input);
    await sendThreadArtifactContent({
      currentUser,
      threadId: input.threadId,
      artifactId: input.artifactId,
      disposition: input.disposition ?? "attachment",
      res
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(400).json({
        detail: error instanceof Error ? error.message : "Crest artifact download failed"
      });
    }
  }
}

function crestThreadTitle(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized ? `Crest CRM - ${normalized.slice(0, 40)}` : "Crest CRM 对话";
}

function crestStoredMessage(
  role: "user" | "assistant",
  id: string,
  text: string,
  metadata: Record<string, unknown>,
  attachments: PreparedCrestAttachment[] = []
) {
  const storedAttachments = attachments.map((attachment) => ({
    type: crestAttachmentKind(attachment.mimeType),
    name: attachment.name,
    contentType: attachment.mimeType,
    content: [
      {
        type: "text",
        text: uploadedFileHint({
          name: attachment.name,
          path: attachment.path,
          relativePath: attachment.relativePath,
          mimeType: attachment.mimeType,
          bytes: attachment.bytes
        })
      }
    ]
  }));
  return {
    id,
    role,
    content: [{ type: "text", text }],
    ...(storedAttachments.length > 0 ? { attachments: storedAttachments } : {}),
    createdAt: new Date().toISOString(),
    metadata: {
      channel: "crest",
      ...metadata
    }
  };
}

type PreparedCrestAttachment = {
  id: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256?: string;
  path: string;
  relativePath: string;
};

async function materializeCrestAttachments(input: {
  input: z.infer<typeof crestChatStreamSchema>;
  workspacePath: string;
}): Promise<PreparedCrestAttachment[]> {
  const attachments = input.input.attachments ?? [];
  if (attachments.length === 0) return [];
  const config = await assertCrestClient(input.input);
  const uploadDir = getThreadWorkspaceUploadDir(input.workspacePath);
  await fs.mkdir(uploadDir, { recursive: true });

  const out: PreparedCrestAttachment[] = [];
  let index = 0;
  for (const attachment of attachments) {
    index += 1;
    const downloaded = await downloadCrestAttachment({
      config,
      delegationToken: input.input.delegationToken,
      fileId: attachment.fileId
    });
    const safeName = sanitizeUploadFilename(attachment.name);
    const storedName = `${Date.now()}-${String(index).padStart(2, "0")}-${safeName}`;
    const absolutePath = path.join(uploadDir, storedName);
    await fs.writeFile(absolutePath, downloaded.content);
    out.push({
      id: attachment.fileId,
      name: safeName,
      mimeType: downloaded.mimeType || attachment.mimeType || "application/octet-stream",
      bytes: downloaded.content.length,
      sha256: downloaded.sha256 || attachment.sha256,
      path: absolutePath,
      relativePath: normalizeRelativePath(path.relative(uploadDir, absolutePath))
    });
  }
  return out;
}

async function downloadCrestAttachment(input: {
  config: { baseUrl: string; clientId: string; clientSecret: string };
  delegationToken: string;
  fileId: string;
}): Promise<{ content: Buffer; mimeType: string; sha256?: string }> {
  const response = await fetch(
    `${input.config.baseUrl.replace(/\/+$/, "")}/v1/agent-studio/files/download`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: input.config.clientId,
        clientSecret: input.config.clientSecret,
        delegationToken: input.delegationToken,
        fileId: input.fileId
      })
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Crest attachment download failed: HTTP ${response.status}`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  return {
    content,
    mimeType: response.headers.get("content-type") || "application/octet-stream",
    sha256: trimOrUndefined(response.headers.get("x-crest-agent-file-sha256") ?? undefined)
  };
}

function crestAttachmentKind(contentType?: string): "image" | "document" | "file" {
  const normalized = trimOrUndefined(contentType)?.toLowerCase() ?? "";
  if (normalized.startsWith("image/")) return "image";
  if (
    normalized === "application/pdf" ||
    normalized.includes("word") ||
    normalized.includes("excel") ||
    normalized.startsWith("text/")
  ) {
    return "document";
  }
  return "file";
}

function crestRuntimePrompt(
  input: z.infer<typeof crestChatStreamSchema>,
  attachments: PreparedCrestAttachment[] = []
): string {
  const context = input.context ?? {};
  const route = typeof context.route === "string" && context.route.trim() ? context.route.trim() : "";
  const attachmentLines = attachments.map((attachment) =>
    uploadedFileHint({
      name: attachment.name,
      path: attachment.path,
      relativePath: attachment.relativePath,
      mimeType: attachment.mimeType,
      bytes: attachment.bytes
    })
  );
  return [
    "这条消息来自 Crest CRM 内嵌 Agent 助手。",
    "你已经通过 crest_crm MCP 获得当前 Crest 用户的委托访问能力。",
    "需要查询或操作 CRM 数据时，优先使用 crest_crm 工具；不要要求用户手动复制系统数据。",
    route ? `当前 Crest 页面：${route}` : undefined,
    attachmentLines.length > 0
      ? "用户本轮上传了以下原文件附件。请直接读取这些工作区文件，保留文件内格式、表格、样式和模板结构："
      : undefined,
    ...attachmentLines,
    "",
    "用户问题：",
    input.message
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function emitCrestRuntimeEvent(
  res: Response,
  event: { type?: string; delta?: string; text?: string; raw?: unknown }
): void {
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  const itemType = typeof item?.type === "string" ? item.type : "";
  const eventType = typeof event.type === "string" ? event.type : "";
  const isCompleted = eventType === "item.completed";

  if (itemType === "agent_message" && event.delta) {
    sendSSE(res, "delta", { text: event.delta });
    return;
  }
  if (itemType === "reasoning" && isCompleted) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (text) sendSSE(res, "thought", { text: truncateText(text, 1200) });
    return;
  }
  if (itemType === "mcp_tool_call" && isCompleted) {
    const server = typeof item?.server === "string" ? item.server : "";
    const tool = typeof item?.tool === "string" ? item.tool : "";
    const args = asRecord(item?.arguments) ?? {};
    const result = item?.result;
    const name = [server, tool].filter(Boolean).join(".") || "mcp_tool_call";
    sendSSE(res, "tool_call", { name, args });
    const actionPayload = parseCrestActionPayload(result);
    if (actionPayload?.requiresConfirmation === true) {
      sendSSE(res, "action_preview", { name, preview: actionPayload });
    } else {
      sendSSE(res, "tool_result", { name, output: stringifyToolResult(result) });
    }
    const uiIntent = asRecord(actionPayload?.uiIntent);
    if (uiIntent) sendSSE(res, "ui_intent", uiIntent);
  }
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function parseCrestActionPayload(result: unknown): Record<string, unknown> | null {
  const direct = asRecord(result);
  const content = Array.isArray(direct?.content) ? direct.content : undefined;
  const text =
    content
      ?.map((item) => asRecord(item)?.text)
      .find((value): value is string => typeof value === "string" && value.trim().startsWith("{")) ??
    undefined;
  if (!text) return direct;
  try {
    const parsed = JSON.parse(text) as unknown;
    const payload = asRecord(parsed);
    if (payload && isCrestActionEnvelope(payload)) return payload;
    return asRecord(payload?.result) ?? payload;
  } catch {
    return direct;
  }
}

function isCrestActionEnvelope(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.actionId === "string" ||
    typeof payload.requiresConfirmation === "boolean" ||
    typeof payload.confirmationToken === "string" ||
    Boolean(asRecord(payload.uiIntent))
  );
}

function stringifyToolResult(result: unknown): string {
  const payload = parseCrestActionPayload(result);
  if (payload) return JSON.stringify(payload, null, 2);
  if (typeof result === "string") return result;
  return JSON.stringify(result ?? null, null, 2);
}

async function listDepartmentIdsForActor(actor: CurrentActor): Promise<string[]> {
  if (!isInternalOrganizationType(actor.organizationType)) {
    return [];
  }
  return listDepartmentSubjectIdsForUser(actor.id);
}

function roleIdsForActor(actor: CurrentActor): string[] {
  return resolveResourceRoleIds({
    platformRole: actor.role,
    organizationType: actor.organizationType,
    membershipType: actor.membershipType
  });
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
    throw new Error("No available agent mode for the current account");
  }

  const requestedModeId = trimOrUndefined(input.modeHint);
  const selectedMode =
    runtimeOptions.modes.find((mode) => mode.id === requestedModeId) ||
    runtimeOptions.modes.find((mode) => mode.id === runtimeOptions.defaults.mode) ||
    runtimeOptions.modes[0];
  if (!selectedMode) {
    throw new Error("No available agent mode for the current account");
  }

  return {
    modeId: selectedMode.id,
    workspaceRootPath: await resolveEffectiveSessionWorkspaceRootPath(),
    runtimeProfile: selectedMode.runtimeProfile
  };
}

async function resolveEnabledSkillsForMode(input: {
  currentUser: CurrentActor;
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): Promise<EnabledSkillSelection[]> {
  const requested = enabledSkillSelectionsFromRunConfig(input.codexRunConfig);
  if (requested.length === 0) return [];

  const runtimeOptions = await portalRuntimeOptions.resolve({
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    roleIds: roleIdsForActor(input.currentUser),
    departmentIds: await listDepartmentIdsForActor(input.currentUser)
  });
  const selectedMode = runtimeOptions.modes.find((mode) => mode.id === input.modeId);
  const availableById = new Map((selectedMode?.availableSkills ?? []).map((skill) => [skill.id, skill] as const));
  const denied = requested.filter((skill) => !availableById.has(skill.id));
  if (denied.length > 0) {
    throw new Error(`Selected skill is not available for this agent mode: ${denied.map((skill) => skill.name).join(", ")}`);
  }
  return requested.map((skill) => {
    const availableSkill = availableById.get(skill.id)!;
    return {
      id: availableSkill.id,
      name: availableSkill.name,
      managedSkillId: trimOrUndefined(availableSkill.managedSkillId),
      sourcePath: trimOrUndefined(availableSkill.sourcePath),
      activationPrompt: trimOrUndefined(availableSkill.activationPrompt)
    };
  });
}

async function materializeCodexHomeForRunConfig(input: {
  scopeId: string;
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> }> {
  const enabledSkills = enabledSkillSelectionsFromRunConfig(input.codexRunConfig);
  const codexHome = await nativeCodexSkills.materializeSessionHome({
    scopeId: input.scopeId,
    enabledSkills: enabledSkills.map((skill) => ({
      name: skill.name,
      sourcePath: skill.sourcePath
    }))
  });
  return {
    codexHome,
    codexRunConfig: withRunConfigCodexHome(input.codexRunConfig, codexHome)
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

  const sessionCodexRunConfig = withoutRuntimeCapabilityMetadata(
    threadId
      ? ensureThreadUploadDirsInRunConfig(options.codexRunConfig, threadId, options.workspace)
      : options.codexRunConfig
  );
  const materializedCodexHome =
    options.codexHome && sessionCodexRunConfig
      ? { codexHome: options.codexHome, codexRunConfig: sessionCodexRunConfig }
      : await materializeCodexHomeForRunConfig({
          scopeId: threadId ? `thread-${threadId}` : `session-${randomUUID()}`,
          codexRunConfig: sessionCodexRunConfig
        });

  const providerSnapshot = await resolveProviderSnapshot({
    existingSnapshot: options.providerSnapshot
  });
  const runtimeLaunch = await resolveRuntimeLaunchConfig({
    userId: options.userId,
    workspace: options.workspace,
    codexRunConfig: materializedCodexHome.codexRunConfig
  });
  const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
    configOverrides: runtimeLaunch.configOverrides,
    envOverrides: {
      CODEX_HOME: materializedCodexHome.codexHome
    }
  });
  const started = await startLiveRuntimeSession({
    runtime: sessionRuntime,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: runtimeLaunch.codexRunConfig
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
    codexThreadId,
    providerSnapshot
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
    providerSnapshot?: ManagedCodexProviderSnapshot;
  },
  currentUser: CurrentActor,
  workspacePath: string,
  modeId: string,
  runtimeProfile: PortalRuntimeOptionRunProfile
): Promise<SessionOptions> {
  const [providerSnapshot, publishedSystemSettings] = await Promise.all([
    resolveProviderSnapshot({ existingSnapshot: input.providerSnapshot }),
    codexProviders.getPublishedSystemSettings()
  ]);
  const defaults = resolveManagedCodexDefaults({
    systemSettings: publishedSystemSettings,
    providerSnapshot,
    model: input.model,
    reasoningEffort: input.reasoning_effort
  });
  const enabledSkills = await resolveEnabledSkillsForMode({
    currentUser,
    modeId,
    codexRunConfig: input.codex_run_config
  });
  const sourceCodexRunConfig = withExternalRunProfileBoundaries(
    withRunConfigEnabledSkillSelection(
      withRunConfigMode(input.codex_run_config, modeId),
      enabledSkills
    ),
    currentUser,
    runtimeProfile
  );
  await applyWorkspaceAgentsMdForMode(modeId, workspacePath);
  const resolvedCodexRunConfig = await resolveKnowledgeSetRunConfig({
    currentUser,
    workspacePath,
    knowledgeSetIds: input.knowledge_set_ids,
    codexRunConfig: sourceCodexRunConfig
  });
  const materializedCodexHome = await materializeCodexHomeForRunConfig({
    scopeId: `workspace-${path.basename(workspacePath)}`,
    codexRunConfig: resolvedCodexRunConfig
  });
  return {
    userId: currentUser.id,
    organizationId: currentUser.organizationId,
    model: defaults.model,
    reasoningEffort: defaults.reasoningEffort,
    workspace: workspacePath,
    providerSnapshot,
    codexRunConfig: materializedCodexHome.codexRunConfig,
    codexHome: materializedCodexHome.codexHome
  };
}

async function assertChatAllowsNewSession(input: {
  currentUser: CurrentActor;
  model: string;
  threadId?: string;
  sessionId?: string;
  featureType: "chat";
}): Promise<void> {
  await subscriptionEntitlements.enforceChatAccess({
    currentUser: {
      id: input.currentUser.id,
      organizationId: input.currentUser.organizationId,
      organizationType: input.currentUser.organizationType
    },
    model: input.model,
    threadId: input.threadId,
    sessionId: input.sessionId
  });

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
    throw new Error(QUOTA_ACCESS_DENIED_MESSAGE);
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
    force_run_profile_controls?: boolean;
  }
) {
  const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
  if (!thread) throw new Error("Thread does not exist");
  const active = thread.sessionId ? await sessions.get(thread.sessionId) : undefined;
  const [providerSnapshot, publishedSystemSettings] = await Promise.all([
    resolveProviderSnapshot({
      existingSnapshot: active?.providerSnapshot,
      fallbackToLocalAuth: Boolean(active && !active.providerSnapshot)
    }),
    codexProviders.getPublishedSystemSettings()
  ]);

  const sourceCodexRunConfig = withoutRuntimeCapabilityMetadata(patch?.codex_run_config ?? thread.codexRunConfig);
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
  const enabledSkills = await resolveEnabledSkillsForMode({
    currentUser,
    modeId: modeSelection.modeId,
    codexRunConfig: sourceCodexRunConfig
  });
  const normalizedSourceCodexRunConfig = withRunConfigEnabledSkillSelection(
    withRunConfigMode(sourceCodexRunConfig, modeSelection.modeId),
    enabledSkills
  );
  const boundedSourceCodexRunConfig = patch?.force_run_profile_controls
    ? withRunProfileRuntimeControls(normalizedSourceCodexRunConfig, modeSelection.runtimeProfile)
    : withExternalRunProfileBoundaries(normalizedSourceCodexRunConfig, currentUser, modeSelection.runtimeProfile);
  const defaults = resolveManagedCodexDefaults({
    systemSettings: publishedSystemSettings,
    providerSnapshot,
    model: patch?.model || thread.model,
    reasoningEffort: patch?.reasoning_effort || thread.reasoningEffort
  });
  const desiredBaseCodexRunConfig = await resolveKnowledgeSetRunConfig({
    currentUser,
    workspacePath,
    knowledgeSetIds: patch?.knowledge_set_ids,
    codexRunConfig: boundedSourceCodexRunConfig
  });
  await applyWorkspaceAgentsMdForMode(modeSelection.modeId, workspacePath);
  const desiredCodexRunConfig = ensureThreadUploadDirsInRunConfig(desiredBaseCodexRunConfig, threadId, workspacePath);
  const materializedCodexHome = await materializeCodexHomeForRunConfig({
    scopeId: `thread-${threadId}`,
    codexRunConfig: desiredCodexRunConfig
  });

  const desired: SessionOptions = {
    organizationId: currentUser.organizationId,
    userId: thread.userId ?? currentUser.id,
    model: defaults.model,
    reasoningEffort: defaults.reasoningEffort,
    workspace: workspacePath,
    providerSnapshot,
    codexRunConfig: materializedCodexHome.codexRunConfig,
    codexHome: materializedCodexHome.codexHome
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

  let activeForComparison = active;
  let hasLiveRuntime = false;
  if (active) {
    if (liveRuntimeThreads.has(active.sessionId)) {
      hasLiveRuntime = true;
    } else {
      hasLiveRuntime = Boolean(await restoreLiveRuntimeThread(active));
      if (hasLiveRuntime) {
        activeForComparison = await sessions.peek(active.sessionId) ?? active;
      }
    }
  }
  const runtimeCapabilitiesCurrent = activeForComparison
    ? await sessionRuntimeCapabilitiesAreCurrent(activeForComparison, desired.userId)
    : true;
  const baseRuntimeChanged = Boolean(
    activeForComparison &&
    (
      activeForComparison.model !== desired.model ||
      activeForComparison.reasoningEffort !== desired.reasoningEffort ||
      activeForComparison.workspace !== desired.workspace ||
      stableJson(runtimeCapabilityComparableConfig(activeForComparison.codexRunConfig)) !==
        stableJson(runtimeCapabilityComparableConfig(desired.codexRunConfig))
    )
  );
  let refreshedRuntimeCapabilitiesCurrent = runtimeCapabilitiesCurrent;
  if (activeForComparison && hasLiveRuntime && !baseRuntimeChanged && !runtimeCapabilitiesCurrent) {
    const refreshed = await refreshLiveRuntimeThread(activeForComparison);
    if (refreshed) {
      activeForComparison = refreshed;
      refreshedRuntimeCapabilitiesCurrent = await sessionRuntimeCapabilitiesAreCurrent(refreshed, desired.userId);
    }
  }
  const changed =
    !activeForComparison ||
    !hasLiveRuntime ||
    activeForComparison.model !== desired.model ||
    activeForComparison.reasoningEffort !== desired.reasoningEffort ||
    activeForComparison.workspace !== desired.workspace ||
    stableJson(runtimeCapabilityComparableConfig(activeForComparison.codexRunConfig)) !==
      stableJson(runtimeCapabilityComparableConfig(desired.codexRunConfig)) ||
    !refreshedRuntimeCapabilitiesCurrent;

  if (!changed && activeForComparison) {
    return activeForComparison;
  }

  await assertChatAllowsNewSession({
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

type DingTalkBotActor = {
  currentUser: CurrentActor;
  displayName?: string;
  dingtalkUserId?: string;
  dingtalkUnionId?: string;
};

type DingTalkBotSessionOptions = SessionOptions & {
  baseCodexRunConfig?: Record<string, unknown>;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? trimOrUndefined(value) : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = asString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function mergeAdditionalDirectoriesForBot(
  codexRunConfig: Record<string, unknown>,
  additionalDirectories: string[]
): Record<string, unknown> {
  if (!additionalDirectories.length) return codexRunConfig;
  const next = { ...codexRunConfig };
  const current = asStringArray(next.additionalDirectories);
  const seen = new Set(current);
  for (const directory of additionalDirectories) {
    const normalized = trimOrUndefined(directory);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    current.push(normalized);
  }
  next.additionalDirectories = current;
  return next;
}

function buildZendeskTicketWorkspacePath(rootPath: string, instanceId: string | undefined, ticketId: string): string {
  return path.join(
    rootPath,
    "zendesk",
    sanitizePathSegment(instanceId || "legacy", "instance"),
    "tickets",
    `ticket-${sanitizePathSegment(ticketId, "ticket")}`
  );
}

type ZendeskKnowledgeSetMount = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  manifestPath: string;
};

function uniqueZendeskKnowledgeSetSegment(input: { id: string; name: string }, used: Set<string>): string {
  const base = sanitizePathSegment(input.name || input.id, "knowledge-set");
  let segment = base;
  if (used.has(segment)) {
    segment = `${base}-${sanitizePathSegment(input.id, "set")}`;
  }
  used.add(segment);
  return segment;
}

async function prepareZendeskKnowledgeSetWorkspace(
  workspacePath: string,
  knowledgeSetInputs: Array<{ id: string; name: string; path: string }>
): Promise<ZendeskKnowledgeSetMount[]> {
  const agentStudioRelativePath = ".agent-studio";
  const manifestRelativePath = path.posix.join(agentStudioRelativePath, "knowledge-sets.md");
  const agentStudioPath = path.join(workspacePath, agentStudioRelativePath);
  const linksRoot = path.join(agentStudioPath, "knowledge-sets");
  const manifestPath = path.join(workspacePath, manifestRelativePath);

  await fs.mkdir(agentStudioPath, { recursive: true });
  await fs.rm(linksRoot, { recursive: true, force: true });

  if (knowledgeSetInputs.length === 0) {
    await fs.rm(manifestPath, { force: true });
    return [];
  }

  await fs.mkdir(linksRoot, { recursive: true });

  const usedSegments = new Set<string>();
  const mountedKnowledgeSets: ZendeskKnowledgeSetMount[] = [];
  for (const knowledgeSet of knowledgeSetInputs) {
    await fs.access(knowledgeSet.path);
    const segment = uniqueZendeskKnowledgeSetSegment(knowledgeSet, usedSegments);
    const relativePath = path.posix.join(agentStudioRelativePath, "knowledge-sets", segment);
    const linkPath = path.join(workspacePath, relativePath);
    await fs.symlink(knowledgeSet.path, linkPath, "dir");
    mountedKnowledgeSets.push({
      ...knowledgeSet,
      relativePath,
      manifestPath: manifestRelativePath
    });
  }

  const manifestLines = [
    "# Zendesk Mounted Knowledge Sets",
    "",
    "This file is generated by Agent Studio for the current Zendesk ticket workspace.",
    "Search these local sources before deciding that product documentation is unavailable.",
    "",
    "Recommended workflow:",
    "1. Extract product names, firmware versions, parameters, alarms, model names, and error messages from the ticket.",
    "2. Search the relevant mounted knowledge sets with `rg -n -i -L \"<keywords>\" \"<relative_path>\"`.",
    "3. Read matching `doc.md`, exported text, spreadsheets, PDFs, or related files before drafting the answer.",
    "4. Mention the checked document names in the admin-only process summary, but never expose local paths to the customer.",
    "",
    "Knowledge sets:",
    ...mountedKnowledgeSets.flatMap((knowledgeSet) => [
      `- ${knowledgeSet.name}`,
      `  - id: ${knowledgeSet.id}`,
      `  - relative_path: ${knowledgeSet.relativePath}`,
      `  - absolute_path: ${knowledgeSet.path}`,
      `  - search_example: rg -n -i -L \"<ticket keywords>\" \"${knowledgeSet.relativePath}\"`
    ]),
    ""
  ];
  await fs.writeFile(manifestPath, manifestLines.join("\n"), "utf8");

  return mountedKnowledgeSets;
}

async function resolveZendeskAgentRuntimeOptions(input: {
  settings: ZendeskIntegrationSettings;
  instanceId?: string;
  ticketId: string;
  runId: string;
  source: "webhook" | "manual";
}): Promise<{
  runtime: CodexRuntime;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  knowledgeSets?: ZendeskKnowledgeSetMount[];
  enabledSkills?: EnabledSkillSelection[];
}> {
  const agentModeId = trimOrUndefined(input.settings.agentModeId);
  if (!agentModeId) {
    throw new Error("Zendesk 集成未绑定 Agent Mode");
  }

  const agentMode = await agentModes.get(agentModeId);
  if (!agentMode || trimOrUndefined(agentMode.status) !== "active") {
    throw new Error("Zendesk 集成绑定的 Agent Mode 不存在或未启用");
  }

  const runProfile = await runProfiles.get(agentMode.runProfileId);
  if (!runProfile || trimOrUndefined(runProfile.status) !== "active") {
    throw new Error("Zendesk 集成绑定的 Agent Mode 对应 Run Profile 不存在或未启用");
  }

  const selectedModel = normalizeModel(runProfile.defaultModel || appConfig.defaultModel);
  const selectedReasoningEffort = normalizeReasoningEffortForModel(
    selectedModel,
    (runProfile.defaultReasoningEffort as ReasoningEffort | undefined) || appConfig.defaultReasoningEffort
  );
  const knowledgeSetIds = asStringArray(input.settings.knowledgeSetIds);
  const knowledgeSetMap = new Map(
    (await knowledgeSets.list())
      .filter((item) => trimOrUndefined(item.status) === "active" && trimOrUndefined(item.sourceType) === "managed_upload")
      .map((item) => [item.id, item] as const)
  );
  const selectedKnowledgeSets = knowledgeSetIds.map((knowledgeSetId) => {
    const knowledgeSet = knowledgeSetMap.get(knowledgeSetId);
    if (!knowledgeSet) {
      throw new Error("Zendesk 集成绑定的资料集不存在或未启用");
    }
    return {
      id: knowledgeSet.id,
      name: knowledgeSet.name,
      path: knowledgeSetStorage.resolveReadableMountPath(trimOrUndefined(knowledgeSet.storageKey) ?? knowledgeSet.id)
    };
  });

  const workspaceRoot = await resolveEffectiveSessionWorkspaceRootPath();
  const workspacePath = buildZendeskTicketWorkspacePath(workspaceRoot, input.instanceId, input.ticketId);
  await fs.mkdir(workspacePath, { recursive: true });
  await applyWorkspaceAgentsMdForMode(agentModeId, workspacePath);
  const mountedKnowledgeSets = await prepareZendeskKnowledgeSetWorkspace(workspacePath, selectedKnowledgeSets);
  const enabledSkills = await resolveEnabledSkillsForBotMode(agentModeId);
  const baseCodexRunConfig = mergeAdditionalDirectoriesForBot(
    withRunConfigEnabledSkillSelection(
      {
        sandboxMode: runProfile.sandboxMode,
        approvalPolicy: runProfile.approvalPolicy,
        networkAccessEnabled: runProfile.networkAccessEnabled,
        webSearchMode: runProfile.webSearchMode,
        mode: agentModeId
      },
      enabledSkills
    ),
    selectedKnowledgeSets.map((knowledgeSet) => knowledgeSet.path)
  );
  const materializedCodexHome = await materializeCodexHomeForRunConfig({
    scopeId: `zendesk-${input.instanceId || "legacy"}-ticket-${input.ticketId}`,
    codexRunConfig: baseCodexRunConfig
  });

  return {
    runtime: createRuntimeForProviderSnapshot(await codexProviders.resolveActiveProviderSnapshot(), {
      envOverrides: {
        CODEX_HOME: materializedCodexHome.codexHome
      }
    }),
    model: selectedModel,
    reasoningEffort: selectedReasoningEffort,
    workspace: workspacePath,
    codexRunConfig: materializedCodexHome.codexRunConfig,
    knowledgeSets: mountedKnowledgeSets,
    enabledSkills
  };
}

const ZENDESK_CHANNEL = "zendesk";

type ZendeskAuditRuntimeOptions = {
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
};

type ZendeskAuditState = {
  threadId: string;
  userMessageId?: string;
  externalConversationKey?: string;
};

function zendeskConversationKey(input: {
  instanceId: string;
  ticketId: string;
  agentModeId: string;
}): string {
  return [ZENDESK_CHANNEL, input.instanceId, "ticket", input.ticketId, input.agentModeId].join(":");
}

function zendeskThreadExternalId(externalConversationKey: string): string {
  return `${externalConversationKey}:thread:${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function zendeskConversationTitle(context: ZendeskTicketContext): string {
  const subject = trimOrUndefined(context.ticket.subject);
  return subject ? `Zendesk #${context.ticket.id} - ${subject}` : `Zendesk #${context.ticket.id}`;
}

function zendeskThreadRunConfig(input: {
  runtime: ZendeskAuditRuntimeOptions;
  instanceId: string;
  ticketId: string;
  externalConversationKey: string;
}): Record<string, unknown> {
  return {
    ...(input.runtime.codexRunConfig ?? {}),
    channel: ZENDESK_CHANNEL,
    integrationInstanceId: input.instanceId,
    externalConversationKey: input.externalConversationKey,
    conversationType: "ticket",
    zendeskTicketId: input.ticketId
  };
}

function uploadedFileHint(input: {
  name: string;
  path?: string;
  relativePath?: string;
  mimeType?: string;
  bytes?: number;
}): string {
  const attrs = [
    `name=${JSON.stringify(input.name)}`,
    input.path ? `path=${JSON.stringify(input.path)}` : "",
    input.relativePath ? `relativePath=${JSON.stringify(input.relativePath)}` : "",
    input.mimeType ? `mimeType=${JSON.stringify(input.mimeType)}` : "",
    typeof input.bytes === "number" ? `bytes=${input.bytes}` : ""
  ].filter(Boolean);
  return `<uploaded_file ${attrs.join(" ")}>`;
}

function zendeskAttachmentKind(contentType?: string): "image" | "document" | "file" {
  const normalized = trimOrUndefined(contentType)?.toLowerCase() ?? "";
  if (normalized.startsWith("image/")) return "image";
  if (
    normalized === "application/pdf" ||
    normalized.includes("word") ||
    normalized.includes("excel") ||
    normalized.startsWith("text/")
  ) {
    return "document";
  }
  return "file";
}

function zendeskMessage(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string | Date;
  metadata?: Record<string, unknown>;
  attachments?: ZendeskCommentPayload["attachments"];
  contentParts?: Array<Record<string, unknown>>;
}) {
  const createdAtText = input.createdAt instanceof Date ? undefined : trimOrUndefined(input.createdAt);
  const parsedCreatedAt =
    input.createdAt instanceof Date
      ? input.createdAt
      : createdAtText
        ? new Date(createdAtText)
        : undefined;
  const createdAt = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
    ? parsedCreatedAt.toISOString()
    : new Date().toISOString();
  const attachments = (input.attachments ?? [])
    .filter((attachment) => attachment.downloadStatus === "downloaded" && attachment.relativePath)
    .map((attachment) => ({
      type: zendeskAttachmentKind(attachment.contentType),
      name: attachment.fileName,
      contentType: attachment.contentType,
      content: [
        {
          type: "text",
          text: uploadedFileHint({
            name: attachment.fileName,
            path: attachment.localPath,
            relativePath: attachment.relativePath,
            mimeType: attachment.contentType,
            bytes: attachment.size
          })
        }
      ]
    }));
  return {
    id: input.id,
    role: input.role,
    content: [
      {
        type: "text",
        text: input.text
      },
      ...(input.contentParts ?? [])
    ],
    ...(attachments.length > 0 ? { attachments } : {}),
    createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}

function latestPreparedZendeskComment(
  context: ZendeskTicketContext,
  requesterComment: ZendeskCommentPayload
): ZendeskCommentPayload {
  return context.comments.find((item) => item.id === requesterComment.id) ?? requesterComment;
}

function trimZendeskAuditText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function shortenZendeskAuditText(value: unknown, max = 1800): string {
  const text = trimZendeskAuditText(value) ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function zendeskRequesterDisplay(context: ZendeskTicketContext): string | undefined {
  const requester = context.ticket.requester;
  const id = context.ticket.requesterId;
  const name = trimZendeskAuditText(requester?.name);
  const email = trimZendeskAuditText(requester?.email);
  const label = name && email ? `${name} <${email}>` : name || email || (id ? `Requester #${id}` : undefined);
  if (!label) return undefined;
  return id ? `${label} (ID ${id})` : label;
}

function zendeskExternalUserName(context: ZendeskTicketContext): string | undefined {
  const requester = context.ticket.requester;
  const id = context.ticket.requesterId;
  const name = trimZendeskAuditText(requester?.name);
  const email = trimZendeskAuditText(requester?.email);
  if (name && email) return `${name} <${email}>`;
  return name || email || (id ? `Requester #${id}` : undefined);
}

function zendeskAttachmentAuditLines(comment: ZendeskCommentPayload): string[] {
  if (comment.attachments.length === 0) return [];
  return comment.attachments.map((attachment) => {
    const bits = [
      attachment.fileName,
      attachment.contentType,
      attachment.size !== undefined ? `${attachment.size} bytes` : undefined,
      attachment.downloadStatus ? `status=${attachment.downloadStatus}` : undefined,
      attachment.relativePath ? `path=${attachment.relativePath}` : undefined,
      attachment.downloadReason ? `reason=${attachment.downloadReason}` : undefined
    ].filter(Boolean);
    return `  - ${bits.join(" | ")}`;
  });
}

function zendeskCommentAuditBlock(
  comment: ZendeskCommentPayload,
  requesterId?: number
): string {
  const author = comment.authorId === requesterId ? "requester" : `user:${comment.authorId || "unknown"}`;
  const visibility = comment.public ? "public" : "internal";
  const lines = [
    `- comment_id: ${comment.id}`,
    `  author: ${author}`,
    `  visibility: ${visibility}`,
    comment.createdAt ? `  created_at: ${comment.createdAt}` : undefined,
    `  body: ${shortenZendeskAuditText(comment.body, 1200) || "(empty)"}`,
    ...zendeskAttachmentAuditLines(comment)
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

function zendeskAuditInputSnapshot(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  ticketId: string;
}): string {
  const preparedComment = latestPreparedZendeskComment(input.context, input.requesterComment);
  const recentComments = input.context.comments.slice(0, input.settings.maxCommentHistory);
  const attachmentCount = recentComments.reduce((sum, comment) => sum + comment.attachments.length, 0);
  return [
    `Zendesk Ticket #${input.ticketId}`,
    input.context.ticket.subject ? `主题：${input.context.ticket.subject}` : undefined,
    zendeskRequesterDisplay(input.context) ? `请求者：${zendeskRequesterDisplay(input.context)}` : undefined,
    "",
    "AI 输入上下文快照",
    "",
    "工单字段",
    `- 状态：${input.context.ticket.status || "未设置"}`,
    `- 优先级：${input.context.ticket.priority || "未设置"}`,
    `- 更新时间：${input.context.ticket.updatedAt || "未知"}`,
    `- 标签：${input.context.ticket.tags.length > 0 ? input.context.ticket.tags.join(", ") : "无"}`,
    `- 最近评论：${recentComments.length}/${input.settings.maxCommentHistory}`,
    `- 附件：${attachmentCount}`,
    "",
    "工单描述",
    shortenZendeskAuditText(input.context.ticket.description, 1600) || "(empty)",
    "",
    "本次触发的客户评论",
    zendeskCommentAuditBlock(preparedComment, input.context.ticket.requesterId),
    "",
    "最近评论上下文",
    recentComments.length > 0
      ? recentComments.map((comment) => zendeskCommentAuditBlock(comment, input.context.ticket.requesterId)).join("\n")
      : "(none)"
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
}

function zendeskRequesterMessageText(input: {
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  ticketId: string;
}): string {
  const preparedComment = latestPreparedZendeskComment(input.context, input.requesterComment);
  const attachmentLines =
    preparedComment.attachments.length > 0
      ? [
          "",
          `附件：${preparedComment.attachments.length} 个`,
          ...preparedComment.attachments.map((attachment) => `- ${attachment.fileName}${attachment.contentType ? ` (${attachment.contentType})` : ""}`)
        ]
      : [];
  return [
    `Zendesk Ticket #${input.ticketId}`,
    input.context.ticket.subject ? `主题：${input.context.ticket.subject}` : undefined,
    zendeskRequesterDisplay(input.context) ? `请求者：${zendeskRequesterDisplay(input.context)}` : undefined,
    "",
    "本次触发的客户评论",
    preparedComment.createdAt ? `时间：${preparedComment.createdAt}` : undefined,
    `评论 ID：${preparedComment.id}`,
    "",
    shortenZendeskAuditText(preparedComment.body, 2400) || (preparedComment.attachments.length > 0 ? "客户上传了附件。" : "(empty)"),
    ...attachmentLines
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
}

function zendeskInputSnapshotProcessRow(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  ticketId: string;
  runId: string;
}): {
  id: string;
  kind: string;
  title: string;
  detail: string;
  at: string;
} {
  return {
    id: `zendesk-input-snapshot-${input.runId}`,
    kind: "meta",
    title: "AI 输入上下文快照",
    detail: zendeskAuditInputSnapshot(input),
    at: new Date().toISOString()
  };
}

function zendeskTraceBatchPart(
  rows: Array<{
    id?: string;
    kind?: string;
    title?: string;
    detail?: string;
    rawDetail?: string;
    at?: string;
  }> | undefined
): Record<string, unknown> | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return {
    type: "data",
    name: "codex_trace_batch",
    data: {
      batch_id: 1,
      open: false,
      active_row_id: "",
      rows: rows.map((row, index) => ({
        id: trimZendeskAuditText(row.id) ?? `zendesk-process-row-${index + 1}`,
        kind: trimZendeskAuditText(row.kind) ?? "process",
        title: trimZendeskAuditText(row.title) ?? "Zendesk process",
        detail: trimZendeskAuditText(row.detail),
        rawDetail: trimZendeskAuditText(row.rawDetail),
        at: trimZendeskAuditText(row.at)
      }))
    }
  };
}

async function ensureZendeskAuditThread(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  instanceId?: string;
  ticketId: string;
  runtime: ZendeskAuditRuntimeOptions;
}): Promise<{
  thread: ThreadRecord;
  externalConversationKey: string;
  integration: { id: string; name: string; slug: string; organizationId?: string | null };
}> {
  const instanceId = trimOrUndefined(input.instanceId);
  if (!instanceId) {
    throw new Error("Zendesk 对话审计需要集成实例 ID");
  }

  const integration = await db.integrationInstance.findUnique({ where: { id: instanceId } });
  if (!integration) {
    throw new Error("Zendesk 集成实例不存在");
  }

  const agentModeId = trimOrUndefined(input.settings.agentModeId) ?? "default";
  const externalConversationKey = zendeskConversationKey({
    instanceId,
    ticketId: input.ticketId,
    agentModeId
  });
  const binding = await externalConversationBindings.getByExternalConversationKey(externalConversationKey);
  let thread = binding ? await threads.get(binding.threadId, integration.organizationId ?? undefined) : undefined;

  const runConfig = zendeskThreadRunConfig({
    runtime: input.runtime,
    instanceId,
    ticketId: input.ticketId,
    externalConversationKey
  });
  const title = zendeskConversationTitle(input.context);
  if (!thread) {
    const threadId = randomUUID().replace(/-/g, "");
    thread = await threads.create({
      id: threadId,
      organizationId: integration.organizationId ?? undefined,
      title,
      externalId: zendeskThreadExternalId(externalConversationKey),
      model: input.runtime.model,
      reasoningEffort: input.runtime.reasoningEffort,
      workspace: input.runtime.workspace,
      codexRunConfig: runConfig
    });
  } else {
    const shouldUpdateThread =
      thread.title !== title ||
      thread.model !== input.runtime.model ||
      thread.reasoningEffort !== input.runtime.reasoningEffort ||
      thread.workspace !== input.runtime.workspace ||
      stableJson(thread.codexRunConfig) !== stableJson(runConfig);
    if (shouldUpdateThread) {
      thread = await threads.update(thread.id, {
        title,
        model: input.runtime.model,
        reasoningEffort: input.runtime.reasoningEffort,
        workspace: input.runtime.workspace,
        codexRunConfig: runConfig
      });
    }
  }

  const preparedComment = latestPreparedZendeskComment(input.context, input.requesterComment);
  const messageAt = preparedComment.createdAt ? new Date(preparedComment.createdAt) : new Date();
  await externalConversationBindings.upsert({
    organizationId: integration.organizationId ?? null,
    integrationInstanceId: integration.id,
    threadId: thread.id,
    channel: ZENDESK_CHANNEL,
    externalConversationKey,
    externalConversationId: input.ticketId,
    conversationType: "ticket",
    agentModeId,
    externalUserId: input.context.ticket.requesterId ? String(input.context.ticket.requesterId) : undefined,
    externalUserName: zendeskExternalUserName(input.context),
    botName: integration.name,
    lastExternalMessageId: String(preparedComment.id),
    lastMessageAt: Number.isNaN(messageAt.getTime()) ? new Date() : messageAt,
    metadata: {
      integrationSlug: integration.slug,
      ticketId: input.ticketId,
      ticketSubject: input.context.ticket.subject,
      ticketStatus: input.context.ticket.status,
      requesterId: input.context.ticket.requesterId,
      requesterName: input.context.ticket.requester?.name,
      requesterEmail: input.context.ticket.requester?.email,
      requesterOrganization: input.context.ticket.requester?.organizationName,
      requesterCountryRegion: input.context.ticket.requester?.countryRegion,
      ticketUrl: input.settings.zendeskBaseUrl
        ? `${input.settings.zendeskBaseUrl}/agent/tickets/${encodeURIComponent(input.ticketId)}`
        : undefined
    }
  });

  return {
    thread,
    externalConversationKey,
    integration: {
      id: integration.id,
      name: integration.name,
      slug: integration.slug,
      organizationId: integration.organizationId
    }
  };
}

async function syncZendeskConversationBeforeAgentRun(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  instanceId?: string;
  ticketId: string;
  runId: string;
  source: "webhook" | "manual";
  runtime: ZendeskAuditRuntimeOptions;
}): Promise<ZendeskAuditState | undefined> {
  const ensured = await ensureZendeskAuditThread(input);
  const preparedComment = latestPreparedZendeskComment(input.context, input.requesterComment);
  const userMessageId = `zendesk-requester-${preparedComment.id}`;
  const userText = zendeskRequesterMessageText(input);

  const updated = await threads.appendMessage(ensured.thread.id, {
    parentId: ensured.thread.headId ?? null,
    message: zendeskMessage({
      id: userMessageId,
      role: "user",
      text: userText,
      createdAt: preparedComment.createdAt,
      attachments: preparedComment.attachments,
      metadata: {
        channel: ZENDESK_CHANNEL,
        integrationInstanceId: ensured.integration.id,
        integrationSlug: ensured.integration.slug,
        externalConversationKey: ensured.externalConversationKey,
        ticketId: input.ticketId,
        ticketSubject: input.context.ticket.subject,
        requesterName: input.context.ticket.requester?.name,
        requesterEmail: input.context.ticket.requester?.email,
        requesterCommentId: preparedComment.id,
        source: input.source,
        runId: input.runId
      }
    }),
    runConfig: {
      channel: ZENDESK_CHANNEL,
      integrationInstanceId: ensured.integration.id,
      externalConversationKey: ensured.externalConversationKey,
      conversationType: "ticket",
      zendeskTicketId: input.ticketId,
      runId: input.runId
    }
  });

  return {
    threadId: updated.id,
    userMessageId,
    externalConversationKey: ensured.externalConversationKey
  };
}

function zendeskDecisionLabel(decision: ZendeskAgentDecision["decision"]): string {
  if (decision === "public_reply") return "公开回复";
  if (decision === "internal_note") return "内部备注";
  return "转人工";
}

function zendeskAssistantAuditText(input: {
  answerText: string;
  decision: ZendeskAgentDecision;
  action: {
    mode: "skip" | "comment";
    publicReply?: boolean;
    body?: string;
    detail: string;
    decision: ZendeskAgentDecision["decision"];
  };
  commentId?: number;
}): string {
  const heading =
    input.action.mode === "skip"
      ? "AI 本次未写入 Zendesk。"
      : input.action.publicReply
        ? "AI 已写入 Zendesk 公开回复。"
        : "AI 已写入 Zendesk 内部备注。";
  const body = trimOrUndefined(input.action.body) ?? trimOrUndefined(input.decision.internalNote) ?? trimOrUndefined(input.answerText);
  const preview = trimOrUndefined(input.decision.publicReplyPreview);
  const shouldAppendPreview = preview ? !body || !body.includes(preview) : false;
  return [
    heading,
    "",
    body,
    shouldAppendPreview ? "" : undefined,
    shouldAppendPreview ? "公开回复预览（未发送）：" : undefined,
    shouldAppendPreview ? preview : undefined,
    "",
    `决策：${zendeskDecisionLabel(input.action.decision)}`,
    `处理结果：${input.action.detail}`,
    input.decision.confidence !== undefined ? `置信度：${Math.round(input.decision.confidence * 100)}%` : undefined,
    input.decision.reasons?.length ? `原因：${input.decision.reasons.join("；")}` : undefined,
    input.commentId ? `Zendesk 评论 ID：${input.commentId}` : undefined
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();
}

async function syncZendeskConversationAfterAgentRun(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  audit?: ZendeskAuditState;
  instanceId?: string;
  ticketId: string;
  runId: string;
  source: "webhook" | "manual";
  runtime: ZendeskAuditRuntimeOptions;
  answerText: string;
  decision: ZendeskAgentDecision;
  action: {
    mode: "skip" | "comment";
    publicReply?: boolean;
    body?: string;
    status: string;
    detail: string;
    decision: ZendeskAgentDecision["decision"];
  };
  commentId?: number;
  codexThreadId?: string;
  processRows?: Array<{
    id?: string;
    kind?: string;
    title?: string;
    detail?: string;
    rawDetail?: string;
    at?: string;
  }>;
}): Promise<void> {
  const audit =
    input.audit ??
    (await syncZendeskConversationBeforeAgentRun({
      settings: input.settings,
      context: input.context,
      requesterComment: input.requesterComment,
      instanceId: input.instanceId,
      ticketId: input.ticketId,
      runId: input.runId,
      source: input.source,
      runtime: input.runtime
    }));
  if (!audit?.threadId) return;

  const inputSnapshotRow = zendeskInputSnapshotProcessRow(input);
  const processRows = [
    inputSnapshotRow,
    ...(input.processRows ?? []).filter((row) => row.id !== inputSnapshotRow.id && row.title !== inputSnapshotRow.title)
  ];
  const tracePart = zendeskTraceBatchPart(processRows);
  await threads.appendMessage(audit.threadId, {
    parentId: audit.userMessageId ?? null,
    message: zendeskMessage({
      id: `zendesk-agent-${input.runId}`,
      role: "assistant",
      text: zendeskAssistantAuditText(input),
      contentParts: tracePart ? [tracePart] : undefined,
      metadata: {
        channel: ZENDESK_CHANNEL,
        integrationInstanceId: input.instanceId,
        externalConversationKey: audit.externalConversationKey,
        ticketId: input.ticketId,
        runId: input.runId,
        decision: input.decision.decision,
        publicReplyPreview: input.decision.publicReplyPreview,
        actionStatus: input.action.status,
        zendeskCommentId: input.commentId,
        codexThreadId: input.codexThreadId
      }
    }),
    runConfig: {
      channel: ZENDESK_CHANNEL,
      integrationInstanceId: input.instanceId,
      externalConversationKey: audit.externalConversationKey,
      conversationType: "ticket",
      zendeskTicketId: input.ticketId,
      runId: input.runId,
      codexThreadId: input.codexThreadId
    }
  });

  if (audit.externalConversationKey) {
    await externalConversationBindings.touch({
      externalConversationKey: audit.externalConversationKey,
      lastExternalMessageId: String(input.requesterComment.id),
      lastMessageAt: input.requesterComment.createdAt ?? new Date(),
      metadata: {
        ticketId: input.ticketId,
        ticketSubject: input.context.ticket.subject,
        ticketStatus: input.context.ticket.status,
        lastRunId: input.runId,
        lastDecision: input.decision.decision,
        lastActionStatus: input.action.status,
        codexThreadId: input.codexThreadId,
        zendeskCommentId: input.commentId,
        requesterId: input.context.ticket.requesterId,
        requesterName: input.context.ticket.requester?.name,
        requesterEmail: input.context.ticket.requester?.email,
        requesterOrganization: input.context.ticket.requester?.organizationName,
        requesterCountryRegion: input.context.ticket.requester?.countryRegion,
        ticketUrl: input.settings.zendeskBaseUrl
          ? `${input.settings.zendeskBaseUrl}/agent/tickets/${encodeURIComponent(input.ticketId)}`
          : undefined
      }
    });
  }
}

type ZendeskServiceDependencies = NonNullable<ConstructorParameters<typeof ZendeskIntegrationService>[0]>;
type ZendeskRuntimeSessionBridge = NonNullable<ZendeskServiceDependencies["runtimeSession"]>;
type ZendeskRuntimeSessionInput = Parameters<ZendeskRuntimeSessionBridge["acquire"]>[0];
type ZendeskRuntimeSessionLease = NonNullable<Awaited<ReturnType<ZendeskRuntimeSessionBridge["acquire"]>>>;

async function resolveZendeskRuntimeSessionThread(
  input: ZendeskRuntimeSessionInput
): Promise<ThreadRecord | undefined> {
  const threadId = trimOrUndefined(input.audit?.threadId);
  if (!threadId) return undefined;
  const integration = input.instanceId
    ? await db.integrationInstance.findUnique({ where: { id: input.instanceId } })
    : null;
  return await threads.get(threadId, integration?.organizationId ?? undefined);
}

function zendeskDesiredRuntimeConfig(input: ZendeskRuntimeSessionInput, thread: ThreadRecord): Record<string, unknown> | undefined {
  return ensureThreadUploadDirsInRunConfig(input.runtimeOptions.codexRunConfig, thread.id, input.runtimeOptions.workspace);
}

async function materializeZendeskRuntimeConfig(input: ZendeskRuntimeSessionInput, thread: ThreadRecord): Promise<{
  codexHome: string;
  codexRunConfig?: Record<string, unknown>;
}> {
  await fs.mkdir(getThreadWorkspaceUploadDir(input.runtimeOptions.workspace), { recursive: true });
  return await materializeCodexHomeForRunConfig({
    scopeId: `thread-${thread.id}`,
    codexRunConfig: zendeskDesiredRuntimeConfig(input, thread)
  });
}

async function startZendeskRuntimeSession(
  input: ZendeskRuntimeSessionInput,
  thread: ThreadRecord,
  status: ZendeskRuntimeSessionLease["status"],
  existingProviderSnapshot?: ManagedCodexProviderSnapshot
): Promise<ZendeskRuntimeSessionLease> {
  const providerSnapshot = await resolveProviderSnapshot({
    existingSnapshot: existingProviderSnapshot
  });
  const materializedCodexHome = await materializeZendeskRuntimeConfig(input, thread);
  const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
    envOverrides: {
      CODEX_HOME: materializedCodexHome.codexHome
    }
  });
  const started = await startLiveRuntimeSession({
    runtime: sessionRuntime,
    model: input.runtimeOptions.model,
    reasoningEffort: input.runtimeOptions.reasoningEffort,
    workspace: input.runtimeOptions.workspace,
    codexRunConfig: materializedCodexHome.codexRunConfig
  });
  const session = await sessions.create({
    organizationId: thread.organizationId,
    userId: thread.userId,
    threadId: thread.id,
    model: input.runtimeOptions.model,
    reasoningEffort: input.runtimeOptions.reasoningEffort,
    workspace: input.runtimeOptions.workspace,
    codexRunConfig: started.codexRunConfig,
    codexThreadId: started.codexThreadId,
    providerSnapshot
  });
  liveRuntimeThreads.set(session.sessionId, started.liveThread);
  return {
    thread: started.liveThread,
    sessionId: session.sessionId,
    codexThreadId: started.codexThreadId,
    status,
    detail: `thread_id: ${thread.id}`
  };
}

async function ensureZendeskRuntimeSession(input: ZendeskRuntimeSessionInput): Promise<ZendeskRuntimeSessionLease | undefined> {
  const thread = await resolveZendeskRuntimeSessionThread(input);
  if (!thread) return undefined;

  const active = thread.sessionId ? await sessions.get(thread.sessionId) : undefined;
  const liveThread = active ? liveRuntimeThreads.get(active.sessionId) || await restoreLiveRuntimeThread(active) : undefined;
  const materializedCodexHome = await materializeZendeskRuntimeConfig(input, thread);
  const changed =
    !active ||
    !liveThread ||
    active.model !== input.runtimeOptions.model ||
    active.reasoningEffort !== input.runtimeOptions.reasoningEffort ||
    active.workspace !== input.runtimeOptions.workspace ||
    stableJson(active.codexRunConfig) !== stableJson(materializedCodexHome.codexRunConfig);

  if (!changed && active && liveThread) {
    return {
      thread: liveThread,
      sessionId: active.sessionId,
      codexThreadId: active.codexThreadId,
      status: "restored",
      detail: `thread_id: ${thread.id}`
    };
  }

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }

  return await startZendeskRuntimeSession(input, thread, "started", active?.providerSnapshot);
}

async function replaceZendeskRuntimeSession(input: ZendeskRuntimeSessionInput): Promise<ZendeskRuntimeSessionLease | undefined> {
  const thread = await resolveZendeskRuntimeSessionThread(input);
  if (!thread) return undefined;
  const active = thread.sessionId ? await sessions.get(thread.sessionId) : undefined;
  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }
  return await startZendeskRuntimeSession(input, thread, "replaced", active?.providerSnapshot);
}

function createZendeskRuntimeSessionBridge(): ZendeskRuntimeSessionBridge {
  return {
    async acquire(input) {
      return await ensureZendeskRuntimeSession(input);
    },
    async replace(input) {
      return await replaceZendeskRuntimeSession(input);
    },
    async persistCodexThreadId(input) {
      const sessionId = trimOrUndefined(input.lease.sessionId);
      const codexThreadId = trimOrUndefined(input.codexThreadId);
      if (!sessionId || !codexThreadId || trimOrUndefined(input.lease.codexThreadId) === codexThreadId) {
        return undefined;
      }
      const updated = await sessions.update(sessionId, { codexThreadId });
      return {
        ...input.lease,
        codexThreadId: updated.codexThreadId
      };
    }
  };
}

function dingtalkMessageCreatedAt(value: unknown): Date {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function dingtalkConversationScope(conversationType: string | undefined): "single" | "group" {
  return conversationType === "1" ? "single" : "group";
}

function dingtalkConversationKey(input: {
  instanceId: string;
  conversationType?: string;
  conversationId: string;
  agentModeId: string;
}): string {
  return [
    DINGTALK_BOT_CHANNEL,
    input.instanceId,
    dingtalkConversationScope(input.conversationType),
    input.conversationId,
    input.agentModeId
  ].join(":");
}

function dingtalkThreadExternalId(externalConversationKey: string): string {
  return `${externalConversationKey}:thread:${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function dingtalkMessage(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    role: input.role,
    content: [
      {
        type: "text",
        text: input.text
      }
    ],
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}

function dingtalkRuntimePrompt(input: {
  text: string;
  scope: "single" | "group";
  senderNick?: string;
  senderStaffId?: string;
  conversationId: string;
}): string {
  const senderLabel = [input.senderNick, input.senderStaffId ? `ID: ${input.senderStaffId}` : ""].filter(Boolean).join(" / ");
  if (input.scope === "group") {
    return [
      "这条消息来自钉钉群聊中的 @ 机器人对话。",
      senderLabel ? `发言人：${senderLabel}` : undefined,
      `群会话 ID：${input.conversationId}`,
      "请直接回复这位发言人的最新问题。",
      "",
      input.text
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  }
  return [
    "这条消息来自钉钉单聊机器人。",
    senderLabel ? `用户：${senderLabel}` : undefined,
    "",
    input.text
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function dingtalkConversationTitle(input: {
  scope: "single" | "group";
  senderNick?: string;
  conversationId: string;
}): string {
  const label = trimOrUndefined(input.senderNick) ?? input.conversationId;
  return input.scope === "single" ? `钉钉单聊 - ${label}` : `钉钉群聊 - ${label}`;
}

async function findUserByDingTalkUserId(dingtalkUserId?: string): Promise<Awaited<ReturnType<UserRepository["getById"]>>> {
  const normalized = trimOrUndefined(dingtalkUserId);
  if (!normalized) return undefined;
  const row = await (db as unknown as {
    user: {
      findFirst(args: {
        where: { dingtalkUserId?: string; status?: string };
        orderBy?: { createdAt?: "asc" | "desc" };
      }): Promise<{ id: string } | null>;
    };
  }).user.findFirst({
    where: { dingtalkUserId: normalized, status: "active" },
    orderBy: { createdAt: "asc" }
  });
  return row?.id ? users.getById(row.id) : undefined;
}

async function resolveDingTalkBotActor(input: DingTalkBotIncomingMessage): Promise<DingTalkBotActor | undefined> {
  const senderStaffId = trimOrUndefined(input.robotMessage.senderStaffId);
  let user = await findUserByDingTalkUserId(senderStaffId);
  let dingtalkUnionId = trimOrUndefined(user?.externalId);

  if (!user && input.instance.robot.autoSyncUsers && senderStaffId) {
    const profile = await createDingTalkClient({
      clientId: input.instance.clientId,
      clientSecret: input.instance.clientSecret,
      apiBaseUrl: input.instance.apiBaseUrl
    }).getUser({ userId: senderStaffId });
    if (profile?.unionId) {
      user = await users.upsertFromDingTalk({
        unionId: profile.unionId,
        userId: profile.userId,
        openId: profile.openId,
        corpId: profile.corpId,
        email: profile.email,
        displayName: profile.displayName
      });
      dingtalkUnionId = profile.unionId;
    }
  }

  if (!user || user.status !== "active") {
    return undefined;
  }
  let activeUser = user;

  const memberships = await organizationMemberships.listActiveForUser(activeUser.id);
  let preferredMembership =
    memberships.find((item) => item.organizationId === activeUser.primaryOrganizationId) ||
    memberships.find((item) => item.organizationId === input.instance.organizationId) ||
    memberships[0];
  let organization =
    preferredMembership?.organization ||
    (activeUser.primaryOrganizationId ? await organizations.getById(activeUser.primaryOrganizationId) : undefined) ||
    (input.instance.organizationId ? await organizations.getById(input.instance.organizationId) : undefined);
  if (!organization && activeUser.userType === "internal_employee") {
    organization = await ensureInternalOrganization(organizations);
  }
  if (!organization) {
    return undefined;
  }
  if (activeUser.userType === "internal_employee" && organization.type === "internal") {
    if (!preferredMembership || preferredMembership.organizationId !== organization.id) {
      preferredMembership = await organizationMemberships.upsert({
        organizationId: organization.id,
        userId: activeUser.id,
        membershipType: INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE,
        status: "active",
        joinedAt: new Date()
      });
      organization = preferredMembership.organization ?? organization;
    }
    if (!activeUser.primaryOrganizationId) {
      activeUser = await users.updateUserProfile({
        userId: activeUser.id,
        userType: "internal_employee",
        primaryOrganizationId: organization.id
      });
    }
  }

  return {
    currentUser: {
      id: activeUser.id,
      userType: activeUser.userType,
      role: activeUser.role,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationType: organization.type,
      membershipType: preferredMembership?.membershipType
    },
    displayName: trimOrUndefined(activeUser.displayName) ?? trimOrUndefined(input.robotMessage.senderNick),
    dingtalkUserId: senderStaffId,
    dingtalkUnionId
  };
}

async function resolveDingTalkBotSessionOptions(input: {
  currentUser: CurrentActor;
  instance: DingTalkBotInstance;
  workspacePath: string;
}): Promise<DingTalkBotSessionOptions> {
  const agentModeId = trimOrUndefined(input.instance.robot.agentModeId);
  if (!agentModeId) {
    throw new Error("DingTalk bot is not bound to an Agent Mode");
  }
  const agentMode = await agentModes.get(agentModeId);
  if (!agentMode || trimOrUndefined(agentMode.status) !== "active") {
    throw new Error("DingTalk bot Agent Mode does not exist or is disabled");
  }
  const runProfile = await runProfiles.get(agentMode.runProfileId);
  if (!runProfile || trimOrUndefined(runProfile.status) !== "active") {
    throw new Error("DingTalk bot Run Profile does not exist or is disabled");
  }

  const selectedModel = normalizeModel(runProfile.defaultModel || appConfig.defaultModel);
  const selectedReasoningEffort = normalizeReasoningEffortForModel(
    selectedModel,
    (runProfile.defaultReasoningEffort as ReasoningEffort | undefined) || appConfig.defaultReasoningEffort
  );
  const knowledgeSetIds = input.instance.robot.knowledgeSetIds;
  const knowledgeSetMap = new Map(
    (await knowledgeSets.list())
      .filter((item) => trimOrUndefined(item.status) === "active" && trimOrUndefined(item.sourceType) === "managed_upload")
      .map((item) => [item.id, item] as const)
  );
  const mountPaths = knowledgeSetIds.map((knowledgeSetId) => {
    const knowledgeSet = knowledgeSetMap.get(knowledgeSetId);
    if (!knowledgeSet) {
      throw new Error("DingTalk bot knowledge set does not exist or is disabled");
    }
    return knowledgeSetStorage.resolveReadableMountPath(trimOrUndefined(knowledgeSet.storageKey) ?? knowledgeSet.id);
  });
  await applyWorkspaceAgentsMdForMode(agentModeId, input.workspacePath);
  const baseCodexRunConfig = mergeAdditionalDirectoriesForBot(
    {
      sandboxMode: runProfile.sandboxMode,
      approvalPolicy: runProfile.approvalPolicy,
      networkAccessEnabled: runProfile.networkAccessEnabled,
      webSearchMode: runProfile.webSearchMode,
      mode: agentModeId
    },
    mountPaths
  );
  return {
    userId: input.currentUser.id,
    organizationId: input.currentUser.organizationId,
    model: selectedModel,
    reasoningEffort: selectedReasoningEffort,
    workspace: input.workspacePath,
    providerSnapshot: await resolveProviderSnapshot(),
    codexRunConfig: baseCodexRunConfig,
    baseCodexRunConfig
  };
}

async function ensureDingTalkBotThreadSession(input: {
  currentUser: CurrentActor;
  thread: ThreadRecord;
  instance: DingTalkBotInstance;
}): Promise<SessionRecord> {
  const workspacePath =
    trimOrUndefined(input.thread.workspace) ||
    buildThreadWorkspacePath(
      await resolveEffectiveSessionWorkspaceRootPath(),
      input.currentUser.organizationSlug ?? input.currentUser.organizationId,
      input.currentUser.id,
      input.thread.id,
      input.thread.createdAt
    );
  await fs.mkdir(workspacePath, { recursive: true });
  const desired = await resolveDingTalkBotSessionOptions({
    currentUser: input.currentUser,
    instance: input.instance,
    workspacePath
  });

  const shouldPersistThread =
    input.thread.model !== desired.model ||
    input.thread.reasoningEffort !== desired.reasoningEffort ||
    input.thread.workspace !== desired.workspace ||
    stableJson(input.thread.codexRunConfig) !== stableJson(desired.baseCodexRunConfig);
  if (shouldPersistThread) {
    await threads.update(input.thread.id, {
      model: desired.model,
      reasoningEffort: desired.reasoningEffort,
      workspace: desired.workspace,
      codexRunConfig: desired.baseCodexRunConfig
    });
  }

  const desiredCodexRunConfig = ensureThreadUploadDirsInRunConfig(desired.baseCodexRunConfig, input.thread.id, workspacePath);
  const materializedCodexHome = await materializeCodexHomeForRunConfig({
    scopeId: `thread-${input.thread.id}`,
    codexRunConfig: desiredCodexRunConfig
  });
  const desiredSession: SessionOptions = {
    ...desired,
    codexRunConfig: materializedCodexHome.codexRunConfig,
    codexHome: materializedCodexHome.codexHome
  };

  const active = input.thread.sessionId ? await sessions.get(input.thread.sessionId) : undefined;
  const hasLiveRuntime = active
    ? liveRuntimeThreads.has(active.sessionId) || Boolean(await restoreLiveRuntimeThread(active))
    : false;
  const changed =
    !active ||
    !hasLiveRuntime ||
    active.model !== desiredSession.model ||
    active.reasoningEffort !== desiredSession.reasoningEffort ||
    active.workspace !== desiredSession.workspace ||
    stableJson(active.codexRunConfig) !== stableJson(desiredSession.codexRunConfig);
  if (!changed && active) {
    return active;
  }

  await assertChatAllowsNewSession({
    currentUser: input.currentUser,
    model: desiredSession.model,
    featureType: "chat"
  });

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }
  return createSession(desiredSession, input.thread.id);
}

async function dingtalkMessageProcessingState(threadId: string, messageId: string): Promise<{
  userMessageExists: boolean;
  assistantReplyExists: boolean;
}> {
  const normalizedThreadId = trimOrUndefined(threadId);
  const normalizedMessageId = trimOrUndefined(messageId);
  if (!normalizedThreadId || !normalizedMessageId) {
    return {
      userMessageExists: false,
      assistantReplyExists: false
    };
  }
  const table = (db as unknown as {
    message: {
      findFirst(args: {
        where: { threadId: string; externalId?: string; parentId?: string; role?: "assistant" | "user" | "system" };
        orderBy?: { createdAt?: "asc" | "desc" };
      }): Promise<{ id: string } | null>;
    };
  }).message;
  const [userMessage, assistantReply] = await Promise.all([
    table.findFirst({
      where: { threadId: normalizedThreadId, externalId: normalizedMessageId },
      orderBy: { createdAt: "asc" }
    }),
    table.findFirst({
      where: { threadId: normalizedThreadId, parentId: normalizedMessageId, role: "assistant" },
      orderBy: { createdAt: "asc" }
    })
  ]);
  return {
    userMessageExists: Boolean(userMessage),
    assistantReplyExists: Boolean(assistantReply)
  };
}

async function createDingTalkBotThread(input: {
  currentUser: CurrentActor;
  instance: DingTalkBotInstance;
  externalConversationKey: string;
  title: string;
}): Promise<ThreadRecord> {
  const threadId = randomUUID().replace(/-/g, "");
  const workspaceRoot = await resolveEffectiveSessionWorkspaceRootPath();
  const workspacePath = buildThreadWorkspacePath(
    workspaceRoot,
    input.currentUser.organizationSlug ?? input.currentUser.organizationId,
    input.currentUser.id,
    threadId
  );
  await fs.mkdir(workspacePath, { recursive: true });
  const options = await resolveDingTalkBotSessionOptions({
    currentUser: input.currentUser,
    instance: input.instance,
    workspacePath
  });
  const thread = await threads.create({
    id: threadId,
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    title: input.title,
    externalId: dingtalkThreadExternalId(input.externalConversationKey),
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: options.baseCodexRunConfig
  });
  await createSession(options, thread.id);
  return (await threads.get(thread.id, input.currentUser.organizationId)) ?? thread;
}

async function upsertDingTalkBinding(input: {
  binding?: ExternalConversationBindingRecord;
  thread: ThreadRecord;
  actor: DingTalkBotActor;
  instance: DingTalkBotInstance;
  externalConversationKey: string;
  scope: "single" | "group";
  lastExternalMessageId?: string;
  messageAt: Date;
  robotMessage: DingTalkBotIncomingMessage["robotMessage"];
}): Promise<ExternalConversationBindingRecord> {
  return externalConversationBindings.upsert({
    organizationId: input.actor.currentUser.organizationId,
    integrationInstanceId: input.instance.id,
    threadId: input.thread.id,
    userId: input.actor.currentUser.id,
    channel: DINGTALK_BOT_CHANNEL,
    externalConversationKey: input.externalConversationKey,
    externalConversationId: input.robotMessage.conversationId,
    conversationType: input.scope,
    agentModeId: input.instance.robot.agentModeId,
    externalUserId: input.actor.dingtalkUserId ?? input.robotMessage.senderStaffId,
    externalUnionId: input.actor.dingtalkUnionId,
    externalUserName: input.actor.displayName ?? input.robotMessage.senderNick,
    externalGroupId: input.scope === "group" ? input.robotMessage.conversationId : null,
    externalGroupName: input.scope === "group" ? input.robotMessage.conversationId : null,
    botId: trimOrUndefined(input.robotMessage.robotCode) ?? trimOrUndefined(input.robotMessage.chatbotUserId),
    botName: input.instance.name,
    lastExternalMessageId: input.lastExternalMessageId,
    lastMessageAt: input.messageAt,
    metadata: {
      conversationTypeRaw: input.robotMessage.conversationType,
      senderCorpId: trimOrUndefined(input.robotMessage.senderCorpId),
      chatbotCorpId: trimOrUndefined(input.robotMessage.chatbotCorpId),
      integrationSlug: input.instance.slug
    }
  });
}

async function handleDingTalkBotMessage(input: DingTalkBotIncomingMessage): Promise<DingTalkBotHandleResult> {
  const agentModeId = trimOrUndefined(input.instance.robot.agentModeId);
  if (!agentModeId) {
    return { status: "failed", replyText: input.instance.robot.errorMessage, detail: "missing agentModeId" };
  }
  const actor = await resolveDingTalkBotActor(input);
  if (!actor) {
    return {
      status: "ignored",
      replyText: input.instance.robot.unauthorizedMessage,
      detail: "DingTalk user is not mapped to an active Agent Studio user"
    };
  }

  const scope = dingtalkConversationScope(input.robotMessage.conversationType);
  const messageAt = dingtalkMessageCreatedAt(input.robotMessage.createAt);
  const externalConversationKey = dingtalkConversationKey({
    instanceId: input.instance.id,
    conversationType: input.robotMessage.conversationType,
    conversationId: input.robotMessage.conversationId,
    agentModeId
  });
  let binding = await externalConversationBindings.getByExternalConversationKey(externalConversationKey);
  let thread = binding ? await threads.get(binding.threadId, actor.currentUser.organizationId) : undefined;

  const title = dingtalkConversationTitle({
    scope,
    senderNick: input.robotMessage.senderNick,
    conversationId: input.robotMessage.conversationId
  });

  if (isDingTalkResetCommand(input.text, input.instance.robot)) {
    thread = await createDingTalkBotThread({
      currentUser: actor.currentUser,
      instance: input.instance,
      externalConversationKey,
      title
    });
    await upsertDingTalkBinding({
      binding,
      thread,
      actor,
      instance: input.instance,
      externalConversationKey,
      scope,
      lastExternalMessageId: input.robotMessage.msgId,
      messageAt,
      robotMessage: input.robotMessage
    });
    return {
      status: "replied",
      replyText: input.instance.robot.resetConfirmationMessage
    };
  }

  if (!thread) {
    thread = await createDingTalkBotThread({
      currentUser: actor.currentUser,
      instance: input.instance,
      externalConversationKey,
      title
    });
    binding = await upsertDingTalkBinding({
      binding,
      thread,
      actor,
      instance: input.instance,
      externalConversationKey,
      scope,
      messageAt,
      robotMessage: input.robotMessage
    });
  }

  const drainReason = await getDeploymentDrainReason();
  if (drainReason) {
    return {
      status: "failed",
      replyText: drainReason,
      detail: "deployment drain is active"
    };
  }

  const messageProcessingState = await dingtalkMessageProcessingState(thread.id, input.robotMessage.msgId);
  if (messageProcessingState.assistantReplyExists) {
    return {
      status: "ignored",
      detail: "duplicate DingTalk message already has an assistant reply"
    };
  }

  const session = await ensureDingTalkBotThreadSession({
    currentUser: actor.currentUser,
    thread,
    instance: input.instance
  });
  let liveThread = liveRuntimeThreads.get(session.sessionId);
  if (!liveThread) {
    liveThread = await restoreLiveRuntimeThread(session);
  }
  if (!liveThread) {
    throw new Error("DingTalk bot runtime session is not available");
  }

  let streamingCardReply: DingTalkBotStreamingCardReply | undefined;
  if (input.instance.robot.replyMode === "ai_card_stream" && input.instance.robot.streamingCardTemplateId) {
    try {
      streamingCardReply = await input.reply.createStreamingCard({
        initialData: {
          question: input.text,
          senderNick: trimOrUndefined(input.robotMessage.senderNick) ?? "",
          conversationType: scope
        }
      });
    } catch (error) {
      console.warn("DingTalk AI card reply creation failed; falling back to markdown reply", {
        instanceId: input.instance.id,
        msgId: input.robotMessage.msgId,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!messageProcessingState.userMessageExists) {
    const userMessage = dingtalkMessage({
      id: input.robotMessage.msgId,
      role: "user",
      text: input.text,
      createdAt: messageAt,
      metadata: {
        channel: DINGTALK_BOT_CHANNEL,
        conversationType: scope,
        senderNick: input.robotMessage.senderNick,
        senderStaffId: input.robotMessage.senderStaffId,
        integrationInstanceId: input.instance.id,
        externalConversationKey
      }
    });
    await threads.appendMessage(thread.id, {
      parentId: thread.headId ?? null,
      message: userMessage,
      runConfig: {
        channel: DINGTALK_BOT_CHANNEL,
        integrationInstanceId: input.instance.id,
        externalConversationKey,
        conversationType: scope
      }
    });
  }

  let currentSession = session;
  let streamedAnswerPreview = "";
  const runtimePrompt = dingtalkRuntimePrompt({
    text: input.text,
    scope,
    senderNick: input.robotMessage.senderNick,
    senderStaffId: input.robotMessage.senderStaffId,
    conversationId: input.robotMessage.conversationId
  });

  let answerText = "";
  let streamingCardFinalized = false;
  try {
    await streamRuntimeCompletionWithBestEffortUsage({
      events: runtime.runStreamed(liveThread, withSkillActivationPrompts(runtimePrompt, currentSession.codexRunConfig)),
      onEvent(event) {
        const codexThreadId = extractCodexThreadIdFromRuntimeEvent(event);
        if (codexThreadId) {
          void persistSessionCodexThreadId(currentSession, codexThreadId).then((updated) => {
            currentSession = updated;
          });
        }
        if (streamingCardReply) {
          const nextPreview = appendRuntimeAnswerPreview(streamedAnswerPreview, event);
          if (nextPreview !== streamedAnswerPreview) {
            streamedAnswerPreview = nextPreview;
            void streamingCardReply.update(streamedAnswerPreview);
          }
        }
      },
      async onDone(payload) {
        answerText = payload.answer.trim() || "已完成处理，但没有生成可发送的文本回复。";
        if (streamingCardReply) {
          await streamingCardReply.finish(answerText);
          streamingCardFinalized = true;
        }
        await threads.appendMessage(thread!.id, {
          parentId: input.robotMessage.msgId,
          message: dingtalkMessage({
            id: `dingtalk-assistant-${randomUUID().replace(/-/g, "")}`,
            role: "assistant",
            text: answerText,
            metadata: {
              channel: DINGTALK_BOT_CHANNEL,
              integrationInstanceId: input.instance.id,
              externalConversationKey,
              conversationType: scope
            }
          }),
          runConfig: {
            channel: DINGTALK_BOT_CHANNEL,
            integrationInstanceId: input.instance.id,
            externalConversationKey,
            conversationType: scope
          }
        });
      },
      async recordUsage(usage) {
        const departmentIdSnapshot =
          trimOrUndefined(actor.currentUser.organizationType) === "internal"
            ? await departmentMemberships.getPreferredDepartmentIdForUser(actor.currentUser.id)
            : undefined;
        await usageIngestion.record({
          organizationId: actor.currentUser.organizationId,
          userId: actor.currentUser.id,
          departmentIdSnapshot,
          threadId: thread!.id,
          sessionId: currentSession.sessionId,
          model: currentSession.model,
          featureType: "chat",
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          resultStatus: "success",
          metadata: {
            source: DINGTALK_BOT_CHANNEL,
            integrationInstanceId: input.instance.id,
            integrationSlug: input.instance.slug,
            agentModeId,
            conversationType: scope,
            externalConversationKey,
            externalConversationId: input.robotMessage.conversationId,
            externalMessageId: input.robotMessage.msgId
          }
        });
      },
      onTelemetryError(error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn("DingTalk bot usage telemetry ingestion failed", {
          threadId: thread?.id,
          detail
        });
      }
    });
  } catch (error) {
    if (streamingCardReply) {
      await streamingCardReply.fail(input.instance.robot.errorMessage || "这条消息处理失败，请稍后重试。").catch(() => undefined);
    }
    throw error;
  }

  await externalConversationBindings.touch({
    externalConversationKey,
    lastExternalMessageId: input.robotMessage.msgId,
    lastMessageAt: messageAt,
    metadata: {
      conversationTypeRaw: input.robotMessage.conversationType,
      senderCorpId: trimOrUndefined(input.robotMessage.senderCorpId),
      chatbotCorpId: trimOrUndefined(input.robotMessage.chatbotCorpId),
      integrationSlug: input.instance.slug
    }
  });

  return {
    status: "replied",
    replyText: streamingCardFinalized ? undefined : answerText
  };
}

function summarizeText(text: string, limit = 120): string {
  const value = text.trim();
  if (!value) return "";
  if (value.length <= limit) return value;
  if (limit <= 3) return value.slice(0, limit);
  return `${value.slice(0, limit - 3)}...`;
}

function storedMessageId(message: unknown): string | undefined {
  const obj = asRecord(message);
  const id = typeof obj?.id === "string" ? obj.id.trim() : "";
  return id || undefined;
}

function storedMessageRole(message: unknown): string {
  const obj = asRecord(message);
  return typeof obj?.role === "string" ? obj.role.trim() : "";
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
      throw new Error("Invalid relative_path");
    }
    const candidate = path.resolve(normalizedUploadDir, ...relativeSegments);
    if (!isPathInside(normalizedUploadDir, candidate)) {
      throw new Error("Attachment path is outside the allowed directory");
    }
    return candidate;
  }

  const normalizedFilePath = trimOrUndefined(input.filePath);
  if (!normalizedFilePath) {
    throw new Error("Either relative_path or path is required");
  }

  const candidate = path.isAbsolute(normalizedFilePath)
    ? path.resolve(normalizedFilePath)
    : path.resolve(normalizedWorkspacePath, normalizedFilePath);
  if (!isPathInside(normalizedWorkspacePath, candidate)) {
    throw new Error("File path is outside the thread workspace");
  }
  return candidate;
}

type RuntimeFileChange = {
  path: string;
  kind: string;
};

const ARTIFACT_TEXT_SCAN_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".py",
  ".sh",
  ".log",
  ".sql",
  ".env"
]);

const ARTIFACT_MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const GENERATED_ARTIFACT_SCAN_DIRS = new Set(["outputs", "artifacts", "downloads"]);
const GENERATED_ARTIFACT_SCAN_LIMIT = 50;

function normalizeArtifactRelativePath(value: string): string {
  return normalizeRelativePath(value).replace(/^\/+/, "").trim();
}

function resolveWorkspaceFilePath(input: { workspacePath: string; filePath: string }): { absolutePath: string; relativePath: string } {
  const workspacePath = path.resolve(input.workspacePath);
  const requestedPath = trimOrUndefined(input.filePath);
  if (!requestedPath) {
    throw new Error("File path is required");
  }
  const absolutePath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspacePath, requestedPath);
  if (!isPathInside(workspacePath, absolutePath)) {
    throw new Error("File path is outside the thread workspace");
  }
  const relativePath = normalizeArtifactRelativePath(path.relative(workspacePath, absolutePath));
  if (!relativePath) {
    throw new Error("File path is not a file inside the thread workspace");
  }
  return { absolutePath, relativePath };
}

function extensionForArtifact(fileNameOrPath: string): string {
  return path.extname(fileNameOrPath).trim().toLowerCase();
}

function mimeTypeForArtifactPath(fileNameOrPath: string): string {
  return ARTIFACT_MIME_BY_EXTENSION[extensionForArtifact(fileNameOrPath)] ?? "application/octet-stream";
}

function artifactOut(artifact: ThreadArtifactRecord) {
  return {
    id: artifact.id,
    source: artifact.source,
    relative_path: artifact.relativePath,
    display_name: artifact.displayName,
    mime_type: artifact.mimeType ?? null,
    size_bytes: artifact.sizeBytes ?? null,
    checksum: artifact.checksum ?? null,
    preview_status: artifact.previewStatus,
    download_status: artifact.downloadStatus,
    blocked_reason: artifact.blockedReason ?? null,
    expires_at: artifact.expiresAt ?? null,
    created_at: artifact.createdAt,
    updated_at: artifact.updatedAt
  };
}

function artifactPolicyOut(policy: ResolvedArtifactAccessPolicy) {
  return {
    enabled: policy.enabled,
    preview_enabled: policy.previewEnabled,
    download_enabled: policy.downloadEnabled,
    auto_register_generated_files: policy.autoRegisterGeneratedFiles,
    max_file_bytes: policy.maxFileBytes,
    retention_days: policy.retentionDays,
    allowed_extensions: policy.allowedExtensions
  };
}

function artifactActorFromCurrentActor(actor: CurrentActor, departmentIds: string[] = []): ArtifactAccessActor {
  return {
    id: actor.id,
    userType: actor.userType,
    role: actor.role,
    organizationId: actor.organizationId,
    membershipType: actor.membershipType,
    departmentIds
  };
}

async function resolveArtifactPolicyForActor(actor: CurrentActor): Promise<ResolvedArtifactAccessPolicy> {
  const [publishedSettings, departmentIds] = await Promise.all([
    systemSettings.getCurrentPublished(),
    listDepartmentIdsForActor(actor)
  ]);
  return resolveArtifactAccessPolicy(
    publishedSettings?.payload.artifactAccess ?? createDefaultSystemSettingsPayload().artifactAccess,
    artifactActorFromCurrentActor(actor, departmentIds)
  );
}

function extractRuntimeFileChanges(event: { type?: string; raw?: unknown }): RuntimeFileChange[] {
  if (event.type !== "item.completed") return [];
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  if (!item || item.type !== "file_change") return [];
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const payload = asRecord(change);
    if (!payload) continue;
    const filePath = typeof payload.path === "string" ? payload.path.trim() : "";
    if (!filePath) continue;
    const kind = typeof payload.kind === "string" && payload.kind.trim() ? payload.kind.trim() : "update";
    const key = `${kind}::${filePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: filePath, kind });
  }
  return out;
}

function shouldSkipArtifactChange(change: RuntimeFileChange): boolean {
  const kind = change.kind.trim().toLowerCase();
  return kind === "delete" || kind === "deleted" || kind === "remove" || kind === "removed";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.max(1, Math.floor(days)));
  return next;
}

function detectBlockedArtifactPath(relativePath: string, policy: ResolvedArtifactAccessPolicy): string | undefined {
  const normalized = normalizeArtifactRelativePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return "File path is empty";
  if (policy.blockUserUploadDirectory && segments[0] === ".uploads") {
    return "User-uploaded source files are not published as downloadable artifacts";
  }
  if (policy.blockHiddenPaths && segments.some((segment) => segment.startsWith("."))) {
    return "Hidden paths are blocked by artifact policy";
  }
  const extension = extensionForArtifact(normalized);
  if (!extension || !policy.allowedExtensions.includes(extension)) {
    return "File type is not allowed by artifact policy";
  }
  return undefined;
}

function detectSecretLikeContent(buffer: Buffer): string | undefined {
  const text = buffer.toString("utf8");
  const patterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i, reason: "Private key content was detected" },
    { pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i, reason: "Secret-like credential content was detected" },
    { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, reason: "API key-like content was detected" }
  ];
  for (const item of patterns) {
    if (item.pattern.test(text)) return item.reason;
  }
  return undefined;
}

async function checksumExistsInKnowledgeSets(checksum: string): Promise<boolean> {
  const normalizedChecksum = trimOrUndefined(checksum);
  if (!normalizedChecksum) return false;
  const sets = await knowledgeSets.list();
  for (const knowledgeSet of sets) {
    if (trimOrUndefined(knowledgeSet.status) !== "active" || trimOrUndefined(knowledgeSet.sourceType) !== "managed_upload") {
      continue;
    }
    const items = await knowledgeSets.listItems(knowledgeSet.id);
    for (const item of items) {
      const payload = asRecord(item);
      const itemChecksum = typeof payload?.checksum === "string" ? payload.checksum.trim() : "";
      if (itemChecksum && itemChecksum === normalizedChecksum) return true;
    }
  }
  return false;
}

async function registerGeneratedArtifactsForSession(input: {
  currentUser: CurrentActor;
  session: SessionRecord;
  changes: RuntimeFileChange[];
  answerText?: string;
  changedAfter?: Date;
}): Promise<ThreadArtifactRecord[]> {
  const threadId = trimOrUndefined(input.session.threadId);
  const workspacePath = trimOrUndefined(input.session.workspace);
  if (!threadId || !workspacePath) return [];

  const policy = await resolveArtifactPolicyForActor(input.currentUser);
  if (!policy.enabled || !policy.autoRegisterGeneratedFiles) return [];

  const thread = await threads.getOwned(threadId, input.currentUser.id, input.currentUser.organizationId);
  if (!thread) return [];

  const candidates = mergeRuntimeFileChanges([
    input.changes,
    extractArtifactChangesFromText(input.answerText ?? "", workspacePath),
    await collectGeneratedArtifactChanges({
      workspacePath,
      changedAfter: input.changedAfter,
      allowedExtensions: policy.allowedExtensions
    })
  ]);
  if (candidates.length === 0) return [];

  const registered: ThreadArtifactRecord[] = [];
  const seen = new Set<string>();
  for (const change of candidates) {
    if (shouldSkipArtifactChange(change)) continue;

    let resolved: { absolutePath: string; relativePath: string };
    try {
      resolved = resolveWorkspaceFilePath({ workspacePath, filePath: change.path });
    } catch {
      continue;
    }
    if (seen.has(resolved.relativePath)) continue;
    seen.add(resolved.relativePath);

    const stat = await fs.stat(resolved.absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) continue;

    let blockedReason = detectBlockedArtifactPath(resolved.relativePath, policy);
    if (!blockedReason && stat.size > policy.maxFileBytes) {
      blockedReason = "File is larger than the artifact size limit";
    }

    let fileBuffer: Buffer | undefined;
    let checksum: string | undefined;
    if (!blockedReason || policy.blockKnowledgeSetCopies) {
      fileBuffer = await fs.readFile(resolved.absolutePath);
      checksum = createHash("sha256").update(fileBuffer).digest("hex");
    }
    const extension = extensionForArtifact(resolved.relativePath);

    if (!blockedReason && policy.blockKnowledgeSetCopies && checksum && await checksumExistsInKnowledgeSets(checksum)) {
      blockedReason = "File matches a managed knowledge-set source file";
    }

    if (
      !blockedReason &&
      policy.secretScanEnabled &&
      fileBuffer &&
      ARTIFACT_TEXT_SCAN_EXTENSIONS.has(extension) &&
      fileBuffer.length <= 2 * 1024 * 1024
    ) {
      blockedReason = detectSecretLikeContent(fileBuffer);
    }

    const status = blockedReason ? "blocked" : "ready";
    registered.push(
      await threadArtifacts.upsertForThreadPath({
        organizationId: thread.organizationId ?? input.currentUser.organizationId,
        threadId,
        userId: thread.userId ?? input.currentUser.id,
        source: "assistant_generated",
        relativePath: resolved.relativePath,
        displayName: path.basename(resolved.relativePath),
        mimeType: mimeTypeForArtifactPath(resolved.relativePath),
        sizeBytes: stat.size,
        checksum,
        previewStatus: status,
        downloadStatus: status,
        blockedReason,
        metadata: {
          changeKind: change.kind,
          originalPath: change.path
        },
        expiresAt: addDays(new Date(), policy.retentionDays)
      })
    );
  }

  return registered;
}

function mergeRuntimeFileChanges(groups: RuntimeFileChange[][]): RuntimeFileChange[] {
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const change of group) {
      const normalizedPath = trimOrUndefined(change.path);
      if (!normalizedPath) continue;
      const key = `${change.kind.trim().toLowerCase() || "update"}::${normalizedPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: normalizedPath, kind: change.kind || "update" });
    }
  }
  return out;
}

function extractArtifactChangesFromText(text: string, workspacePath: string): RuntimeFileChange[] {
  const normalizedText = trimOrUndefined(text);
  if (!normalizedText) return [];
  const workspace = path.resolve(workspacePath);
  const out: RuntimeFileChange[] = [];
  const seen = new Set<string>();
  const pushPath = (value: string) => {
    const cleaned = trimOrUndefined(value.replace(/^file:\/\//i, ""));
    if (!cleaned) return;
    let resolved: { absolutePath: string; relativePath: string };
    try {
      resolved = resolveWorkspaceFilePath({ workspacePath: workspace, filePath: decodeURIComponent(cleaned) });
    } catch {
      return;
    }
    if (seen.has(resolved.relativePath)) return;
    seen.add(resolved.relativePath);
    out.push({ path: resolved.absolutePath, kind: "text_reference" });
  };

  for (const match of normalizedText.matchAll(/\]\(([^)\n]+)\)/g)) pushPath(match[1] ?? "");
  for (const match of normalizedText.matchAll(/<([^<>\n]+)>/g)) pushPath(match[1] ?? "");
  for (const match of normalizedText.matchAll(/(?:^|[\s([])(\/[^\s<>)\]]+)/g)) pushPath(match[1] ?? "");
  return out;
}

async function collectGeneratedArtifactChanges(input: {
  workspacePath: string;
  changedAfter?: Date;
  allowedExtensions: string[];
}): Promise<RuntimeFileChange[]> {
  const workspace = path.resolve(input.workspacePath);
  const sinceMs = input.changedAfter?.getTime() ?? 0;
  const allowedExtensions = new Set(input.allowedExtensions);
  const out: RuntimeFileChange[] = [];
  const scanDir = async (dir: string) => {
    if (out.length >= GENERATED_ARTIFACT_SCAN_LIMIT) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= GENERATED_ARTIFACT_SCAN_LIMIT) break;
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeArtifactRelativePath(path.relative(workspace, absolutePath));
      const extension = extensionForArtifact(relativePath);
      if (!allowedExtensions.has(extension)) continue;
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (sinceMs > 0 && stat.mtimeMs + 2000 < sinceMs) continue;
      out.push({ path: absolutePath, kind: "workspace_scan" });
    }
  };

  const topLevelEntries = await fs.readdir(workspace, { withFileTypes: true }).catch(() => []);
  for (const entry of topLevelEntries) {
    if (!entry.isDirectory() || !GENERATED_ARTIFACT_SCAN_DIRS.has(entry.name)) continue;
    await scanDir(path.join(workspace, entry.name));
  }
  return out;
}

async function sendThreadArtifactContent(input: {
  currentUser: CurrentActor;
  threadId: string;
  artifactId?: string;
  filePath?: string;
  disposition?: "inline" | "attachment";
  res: Response;
}): Promise<void> {
  const threadId = trimOrUndefined(input.threadId);
  const artifactId = trimOrUndefined(input.artifactId);
  const filePath = trimOrUndefined(input.filePath);
  const actionType = input.disposition === "attachment" ? "download" : "preview";
  const resourceIdForLog = artifactId ?? filePath ?? "unknown";

  const recordAccess = async (resourceId: string, resultStatus: string, metadata?: unknown) => {
    await resourceAccessLogs.record({
      organizationId: input.currentUser.organizationId,
      userId: input.currentUser.id,
      threadId,
      resourceType: "thread_artifact",
      resourceId,
      actionType: `artifact.${actionType}`,
      resultStatus,
      metadata
    });
  };

  if (!threadId || (!artifactId && !filePath)) {
    input.res.status(400).json({ detail: "threadId and artifact reference are required" });
    return;
  }

  const [thread, policy] = await Promise.all([
    threads.getOwned(threadId, input.currentUser.id, input.currentUser.organizationId),
    resolveArtifactPolicyForActor(input.currentUser)
  ]);
  if (!thread) {
    input.res.status(404).json({ detail: "Thread does not exist" });
    return;
  }
  if (!policy.enabled) {
    await recordAccess(resourceIdForLog, "denied", { reason: "artifact_access_disabled" });
    input.res.status(403).json({ detail: "Artifact access is disabled" });
    return;
  }
  if (actionType === "preview" && !policy.previewEnabled) {
    await recordAccess(resourceIdForLog, "denied", { reason: "artifact_preview_disabled" });
    input.res.status(403).json({ detail: "Artifact preview is disabled" });
    return;
  }
  if (actionType === "download" && !policy.downloadEnabled) {
    await recordAccess(resourceIdForLog, "denied", { reason: "artifact_download_disabled" });
    input.res.status(403).json({ detail: "Artifact download is disabled" });
    return;
  }

  const workspacePath = trimOrUndefined(thread.workspace);
  if (!workspacePath) {
    input.res.status(404).json({ detail: "Thread workspace does not exist" });
    return;
  }

  let artifact: ThreadArtifactRecord | undefined;
  if (artifactId) {
    artifact = await threadArtifacts.getForThread(threadId, artifactId);
  } else if (filePath) {
    const resolvedForLookup = resolveWorkspaceFilePath({ workspacePath, filePath });
    artifact = await threadArtifacts.getByThreadPath(threadId, resolvedForLookup.relativePath);
  }

  if (!artifact) {
    input.res.status(404).json({ detail: "Artifact does not exist" });
    return;
  }

  const status = actionType === "download" ? artifact.downloadStatus : artifact.previewStatus;
  if (status !== "ready") {
    await recordAccess(artifact.id, "denied", { reason: artifact.blockedReason ?? "artifact_blocked" });
    input.res.status(403).json({ detail: artifact.blockedReason || "Artifact is blocked by policy" });
    return;
  }
  if (artifact.expiresAt) {
    const expiresAt = new Date(artifact.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      await recordAccess(artifact.id, "denied", { reason: "artifact_expired" });
      input.res.status(410).json({ detail: "Artifact has expired" });
      return;
    }
  }

  const resolved = resolveWorkspaceFilePath({ workspacePath, filePath: artifact.relativePath });
  if (resolved.relativePath !== artifact.relativePath) {
    await recordAccess(artifact.id, "denied", { reason: "artifact_path_mismatch" });
    input.res.status(403).json({ detail: "Artifact path is invalid" });
    return;
  }

  const stat = await fs.stat(resolved.absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    input.res.status(404).json({ detail: "Artifact file does not exist" });
    return;
  }

  const currentPolicyBlockReason =
    detectBlockedArtifactPath(artifact.relativePath, policy) ||
    (stat.size > policy.maxFileBytes ? "File is larger than the artifact size limit" : undefined);
  if (currentPolicyBlockReason) {
    await recordAccess(artifact.id, "denied", { reason: currentPolicyBlockReason });
    input.res.status(403).json({ detail: currentPolicyBlockReason });
    return;
  }

  const fileName = artifact.displayName || path.basename(resolved.absolutePath);
  const fileBuffer = await fs.readFile(resolved.absolutePath);
  if (artifact.checksum) {
    const currentChecksum = createHash("sha256").update(fileBuffer).digest("hex");
    if (currentChecksum !== artifact.checksum) {
      await recordAccess(artifact.id, "denied", { reason: "artifact_checksum_mismatch" });
      input.res.status(409).json({ detail: "Artifact file changed after approval" });
      return;
    }
  }

  await recordAccess(artifact.id, "success", { disposition: actionType });
  input.res.setHeader("Cache-Control", "private, max-age=60");
  input.res.setHeader("X-Content-Type-Options", "nosniff");
  input.res.setHeader(
    "Content-Disposition",
    `${actionType === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  input.res.type(artifact.mimeType || path.extname(fileName) || "application/octet-stream");
  input.res.status(200).send(fileBuffer);
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

function isLocalDevOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1") &&
      (parsed.protocol === "http:" || parsed.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin: string): boolean {
  const appBaseUrl = appConfig.appBaseUrl.trim();
  if (appBaseUrl) {
    try {
      if (new URL(origin).origin === new URL(appBaseUrl).origin) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return appConfig.sessionCookie.secure === false && isLocalDevOrigin(origin);
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  })
);
app.post(
  "/api/integrations/zendesk/:instanceId/webhook",
  express.raw({
    type: () => true,
    limit: "1mb"
  }),
  async (req: Request, res: Response) => {
    await handleZendeskWebhookRequest(zendesk, req, res, req.params.instanceId);
  }
);
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

const requireServiceToken = createServiceTokenMiddleware(appConfig.token);

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/public-api/branding", async (_req: Request, res: Response) => {
  try {
    const branding = await resolvePublicBranding(systemSettings);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(branding);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read branding";
    res.status(500).json({ detail });
  }
});

app.get("/public-api/branding/assets/:fileName", async (req: Request, res: Response) => {
  try {
    const fileName = String(req.params.fileName || "").trim();
    const asset = await brandingAssetStorage.resolveForRead(fileName);
    if (!asset) {
      res.status(404).json({ detail: "Branding asset does not exist" });
      return;
    }
    const buffer = await fs.readFile(asset.absolutePath);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(asset.mimeType);
    res.status(200).send(buffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read branding asset";
    res.status(400).json({ detail });
  }
});

app.use("/public-api/access-requests", createPublicAccessRequestRouter(accessRequestService));

app.locals.resolveCodexSkillThreadPath = async (input: {
  req: Request;
  threadId: string;
  requestedPath: string;
}): Promise<string> => {
  const currentUser = currentActorFromRequest(input.req);
  const thread = await threads.getOwned(input.threadId, currentUser.id, currentUser.organizationId);
  if (!thread) {
    throw new Error("Thread does not exist");
  }
  const workspacePath = trimOrUndefined(thread.workspace);
  if (!workspacePath) {
    throw new Error("Thread workspace does not exist");
  }
  return resolveThreadFileAbsolutePath({
    workspacePath,
    uploadDir: getThreadWorkspaceUploadDir(workspacePath),
    filePath: input.requestedPath
  });
};

const crestIntegrationRouter = express.Router();
crestIntegrationRouter.use(createCrestRouter({
  config: appConfig.crest,
  configResolver: resolveActiveCrestIntegrationConfig,
  identities: authIdentities,
  credentials: crestDelegationCredentials
}));
crestIntegrationRouter.post("/chat/stream", async (req: Request, res: Response) => {
  await handleCrestChatStream(req, res);
});
crestIntegrationRouter.post("/artifacts/content", async (req: Request, res: Response) => {
  await handleCrestArtifactContent(req, res);
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
    crestConfig: appConfig.crest,
    crestConfigResolver: resolveActiveCrestIntegrationConfig,
    crestDelegationCredentials,
    oauthStates,
    identities: authIdentities,
    memberships: organizationMemberships,
    organizations,
    invites: organizationInvites,
    challenges: loginChallenges,
    emailSender: authEmailSender,
    appBaseUrl: appConfig.appBaseUrl,
    sessionCookieReady: Boolean(appConfig.sessionCookie.secret),
    accessRequests: {
      markActivatedFromInvite: (organizationInviteId, userId) =>
        accessRequestService.markActivatedFromInvite(organizationInviteId, userId)
    },
    systemSettings
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
    requirePermission,
    dingtalkBot: {
      getStatus: (instanceId) => dingtalkBotStream.getStatuses(instanceId),
      restart: (instanceId) => dingtalkBotStream.restart(instanceId),
      listRecentConversations: (instanceId, take) => externalConversationBindings.listRecentForIntegration(instanceId, take)
    }
  }),
  monitoringAdminRouter: createMonitoringRouter({
    requirePermission,
    resourceAccessLogs: resourceAccessLogRepository,
    usageEvents: usageEventRepository,
    usageRollups: usageRollupRepository,
    sessions,
    users,
    organizations,
    departments,
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
    resourcePolicies,
    nativeCodexSkills
  }),
  adminSkillRouter: createAdminCodexSkillRouter(codexSkillService),
  portalRouter: createPortalRouter({
    runtimeOptions: portalRuntimeOptions,
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
    productFeedback,
    subscriptionEntitlements
  }),
  resourcesPortalRouter: createResourcesPortalRouter({
    knowledgeSets,
    storage: knowledgeSetStorage,
    policies: policyService,
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId)
  }),
  portalSkillRouter: createPortalCodexSkillRouter(codexSkillService),
  serviceTokenMiddleware: requireServiceToken,
  zendeskRouter: createZendeskAdminRouter(zendesk),
  crestRouter: crestIntegrationRouter
});

app.use(
  "/api/admin/access-requests",
  createAdminAccessRequestRouter(accessRequestService)
);

app.use("/api/access-requests-review", createAccessRequestReviewRouter(accessRequestService));

app.use(
  "/api/ai-response-reviews",
  createAiResponseReviewRouter({
    db: db as unknown as AiResponseReviewRepositoryDb,
    afterSubmit: completeDingTalkAiResponseReviewTodo
  })
);

app.use(
  "/openai/v1",
  createOpenAICompatibleRouter({
    runtime: managedRouterRuntime,
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
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId)
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
      throw new Error("Workspace is not within the allowed whitelist");
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
    const detail = error instanceof Error ? error.message : "Failed to read directory";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/attachments", uploadRawParser, async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      res.status(400).json({ detail: "threadId is required" });
      return;
    }

    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    const payload = req.body;
    if (!Buffer.isBuffer(payload) || payload.length === 0) {
      res.status(400).json({ detail: "Upload payload is empty" });
      return;
    }

    const safeName = sanitizeUploadFilename(String(req.headers["x-file-name"] || ""));
    const mimeType = normalizeMimeType(String(req.headers["x-file-type"] || ""));
    const expectedSize = Number(String(req.headers["x-file-size"] || "0"));
    if (Number.isFinite(expectedSize) && expectedSize > 0 && expectedSize !== payload.length) {
      res.status(400).json({ detail: "Upload size does not match the declared file size" });
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
    const detail = error instanceof Error ? error.message : "Failed to upload attachment";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/files/content", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      res.status(400).json({ detail: "threadId is required" });
      return;
    }

    const query = threadFileContentQuerySchema.parse({
      relative_path: typeof req.query.relative_path === "string" ? req.query.relative_path : undefined,
      path: typeof req.query.path === "string" ? req.query.path : undefined
    });

    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    if (isExternalActor(currentUser)) {
      res.status(403).json({ detail: "External users can only preview or download approved artifacts" });
      return;
    }

    const workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      res.status(404).json({ detail: "Thread workspace does not exist" });
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
      res.status(404).json({ detail: "File does not exist" });
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
    const detail = error instanceof Error ? error.message : "Failed to read file";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/artifacts", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) {
      res.status(400).json({ detail: "threadId is required" });
      return;
    }

    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    const policy = await resolveArtifactPolicyForActor(currentUser);
    const artifacts = policy.enabled ? await threadArtifacts.listForThread(threadId) : [];
    res.json({
      policy: artifactPolicyOut(policy),
      artifacts: artifacts.map(artifactOut)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to list artifacts";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/artifacts/resolve", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const query = artifactResolveQuerySchema.parse({
      path: typeof req.query.path === "string" ? req.query.path : ""
    });
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    const policy = await resolveArtifactPolicyForActor(currentUser);
    if (!policy.enabled) {
      res.status(403).json({ detail: "Artifact access is disabled" });
      return;
    }

    const workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      res.status(404).json({ detail: "Thread workspace does not exist" });
      return;
    }
    const resolved = resolveWorkspaceFilePath({ workspacePath, filePath: query.path });
    const artifact = await threadArtifacts.getByThreadPath(threadId, resolved.relativePath);
    if (!artifact) {
      res.status(404).json({ detail: "This file has not been approved as an artifact" });
      return;
    }
    res.json({
      policy: artifactPolicyOut(policy),
      artifact: artifactOut(artifact)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to resolve artifact";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/artifacts/content", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const query = artifactPathContentQuerySchema.parse({
      path: typeof req.query.path === "string" ? req.query.path : "",
      disposition: typeof req.query.disposition === "string" ? req.query.disposition : undefined
    });
    await sendThreadArtifactContent({
      currentUser,
      threadId,
      filePath: query.path,
      disposition: query.disposition,
      res
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read artifact";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/artifacts/:artifactId/content", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const artifactId = String(req.params.artifactId || "").trim();
    const query = artifactContentQuerySchema.parse({
      disposition: typeof req.query.disposition === "string" ? req.query.disposition : undefined
    });
    await sendThreadArtifactContent({
      currentUser,
      threadId,
      artifactId,
      disposition: query.disposition,
      res
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read artifact";
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
        let existingForComparison = existing;
        let hasLiveRuntime = false;
        if (liveRuntimeThreads.has(existing.sessionId)) {
          hasLiveRuntime = true;
        } else {
          hasLiveRuntime = Boolean(await restoreLiveRuntimeThread(existing));
          if (hasLiveRuntime) {
            existingForComparison = await sessions.peek(existing.sessionId) ?? existing;
          }
        }
        let runtimeCapabilitiesCurrent = await sessionRuntimeCapabilitiesAreCurrent(
          existingForComparison,
          currentUser.id
        );
        const hasSessionPatch = Boolean(
          input.model ||
          input.reasoning_effort ||
          input.knowledge_set_ids ||
          input.codex_run_config
        );
        if (hasLiveRuntime && !hasSessionPatch && !runtimeCapabilitiesCurrent) {
          const refreshed = await refreshLiveRuntimeThread(existingForComparison);
          if (refreshed) {
            existingForComparison = refreshed;
            runtimeCapabilitiesCurrent = await sessionRuntimeCapabilitiesAreCurrent(existingForComparison, currentUser.id);
          }
        }
        if (!hasLiveRuntime) {
          await sessions.remove(existing.sessionId);
          liveRuntimeThreads.delete(existing.sessionId);
        } else if (
          hasSessionPatch ||
          !runtimeCapabilitiesCurrent
        ) {
          const nextSourceCodexRunConfig = withoutRuntimeCapabilityMetadata(
            input.codex_run_config ?? existingForComparison.codexRunConfig
          );
          const modeHint =
            modeIdFromRunConfig(nextSourceCodexRunConfig) ?? modeIdFromRunConfig(existingForComparison.codexRunConfig);

          let workspace = existingForComparison.workspace;
          let modeId = modeHint;
          let runtimeProfile: PortalRuntimeOptionRunProfile | undefined;
          if (existingForComparison.threadId) {
            const selection = await resolveModeSelection({
              currentUser,
              modeHint
            });
            modeId = selection.modeId;
            runtimeProfile = selection.runtimeProfile;
            const ownedThread = await threads.getOwned(
              existingForComparison.threadId,
              currentUser.id,
              currentUser.organizationId
            );
            workspace =
              trimOrUndefined(ownedThread?.workspace) ||
              trimOrUndefined(workspace) ||
              buildThreadWorkspacePath(
                selection.workspaceRootPath,
                currentUser.organizationSlug ?? currentUser.organizationId,
                currentUser.id,
                existingForComparison.threadId,
                ownedThread?.createdAt
              );
            await fs.mkdir(workspace, { recursive: true });
            if (ownedThread && trimOrUndefined(ownedThread.workspace) !== workspace) {
              await threads.update(existingForComparison.threadId, { workspace });
            }
          } else if (input.codex_run_config || !workspace || !modeId) {
            const allocated = await allocateDetachedSessionWorkspacePath({
              currentUser,
              modeHint
            });
            workspace = allocated.workspacePath;
            modeId = allocated.modeId;
            runtimeProfile = allocated.runtimeProfile;
          }

          if (!modeId || !runtimeProfile) {
            const fallback = await resolveModeSelection({
              currentUser,
              modeHint: undefined
            });
            modeId = fallback.modeId;
            runtimeProfile = fallback.runtimeProfile;
          }

          if (modeId && workspace) {
            await applyWorkspaceAgentsMdForMode(modeId, workspace);
          }

          const enabledSkills = await resolveEnabledSkillsForMode({
            currentUser,
            modeId,
            codexRunConfig: nextSourceCodexRunConfig
          });
          const normalizedSourceCodexRunConfig = withExternalRunProfileBoundaries(
            withRunConfigEnabledSkillSelection(
              withRunConfigMode(nextSourceCodexRunConfig, modeId),
              enabledSkills
            ),
            currentUser,
            runtimeProfile
          );
          const nextCodexRunConfig = await resolveKnowledgeSetRunConfig({
            currentUser,
            workspacePath: workspace,
            knowledgeSetIds: input.knowledge_set_ids,
            codexRunConfig: normalizedSourceCodexRunConfig
          });
          const runtimeCodexRunConfig =
            existingForComparison.threadId && trimOrUndefined(workspace)
              ? ensureThreadUploadDirsInRunConfig(nextCodexRunConfig, existingForComparison.threadId, workspace)
              : nextCodexRunConfig;
          const materializedCodexHome = await materializeCodexHomeForRunConfig({
            scopeId: existingForComparison.threadId
              ? `thread-${existingForComparison.threadId}`
              : `session-${existingForComparison.sessionId}`,
            codexRunConfig: runtimeCodexRunConfig
          });
          if (existingForComparison.threadId && trimOrUndefined(workspace)) {
            await fs.mkdir(getThreadWorkspaceUploadDir(workspace), { recursive: true });
          }
          await assertChatAllowsNewSession({
            currentUser,
            model: (input.model || existingForComparison.model).trim(),
            sessionId: existingForComparison.sessionId,
            threadId: existingForComparison.threadId ?? undefined,
            featureType: "chat"
          });
          const runtimeLaunch = await resolveRuntimeLaunchConfig({
            userId: currentUser.id,
            workspace,
            codexRunConfig: materializedCodexHome.codexRunConfig
          });
          const sessionRuntime = createRuntimeForProviderSnapshot(
            await resolveProviderSnapshot({
              existingSnapshot: existingForComparison.providerSnapshot,
              fallbackToLocalAuth: !existingForComparison.providerSnapshot
            }),
            {
              configOverrides: runtimeLaunch.configOverrides,
              envOverrides: {
                CODEX_HOME: materializedCodexHome.codexHome
              }
            }
          );
          const updated = await replaceLiveRuntimeSession({
            runtime: sessionRuntime,
            liveRuntimeThreads,
            sessionId: existingForComparison.sessionId,
            threadId: existingForComparison.threadId,
            model: (input.model || existingForComparison.model).trim(),
            reasoningEffort: input.reasoning_effort || existingForComparison.reasoningEffort,
            workspace,
            codexRunConfig: runtimeLaunch.codexRunConfig,
            persist: async (payload) =>
              sessions.update(existingId, {
                model: payload.model,
                reasoningEffort: payload.reasoningEffort,
                workspace: payload.workspace,
                codexRunConfig: payload.codexRunConfig,
                codexThreadId: payload.codexThreadId,
                providerSnapshot: existingForComparison.providerSnapshot ?? createLocalAuthProviderSnapshot()
              })
          });
          res.json(sessionOut(updated));
          return;
        } else {
          res.json(sessionOut(existingForComparison));
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
      allocated.modeId,
      allocated.runtimeProfile
    );
    await assertChatAllowsNewSession({
      currentUser,
      model: sessionOptions.model,
      featureType: "chat"
    });
    const created = await createSession(sessionOptions);
    res.json(sessionOut(created));
  } catch (error) {
    res.status(statusCodeForSessionAccessError(error)).json(payloadForSessionAccessError(error, "Failed to create session"));
  }
});

app.get("/public-api/thread-shares/:token", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || "").trim();
    const share = await threadPublicShares.getActiveByToken(token);
    if (!share) {
      res.status(404).json({ detail: "Public link does not exist or has expired" });
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
    const detail = error instanceof Error ? error.message : "Failed to read public link";
    res.status(400).json({ detail });
  }
});

app.get("/public-api/thread-shares/:token/files/content", async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || "").trim();
    const rawPath = trimOrUndefined(typeof req.query.path === "string" ? req.query.path : undefined);
    if (!token || !rawPath) {
      res.status(400).json({ detail: "Token and path are required" });
      return;
    }

    const requestedPath = path.resolve(rawPath);
    if (!isPublicShareKnowledgeImagePath(requestedPath)) {
      res.status(400).json({ detail: "Only shared knowledge-set images are supported" });
      return;
    }

    const share = await threadPublicShares.getActiveByToken(token);
    if (!share) {
      res.status(404).json({ detail: "Public link does not exist or has expired" });
      return;
    }

    const resolvedShare = await resolveThreadPublicShareSnapshotForRead(share);
    const allowedImagePaths = collectKnowledgeImagePathsFromSnapshot(resolvedShare.snapshot);
    if (!allowedImagePaths.has(requestedPath)) {
      res.status(403).json({ detail: "This image is not part of the public share" });
      return;
    }

    const stat = await fs.stat(requestedPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ detail: "File does not exist" });
      return;
    }

    const fileName = path.basename(requestedPath);
    const fileBuffer = await fs.readFile(requestedPath);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type(path.extname(fileName) || "application/octet-stream");
    res.status(200).send(fileBuffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read public share image";
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
      allocated.modeId,
      allocated.runtimeProfile
    );
    await assertChatAllowsNewSession({
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
    res.status(statusCodeForSessionAccessError(error)).json(payloadForSessionAccessError(error, "Failed to create thread"));
  }
});

app.get("/api/threads/:threadId", async (req: Request, res: Response) => {
  const currentUser = currentActorFromRequest(req);
  const thread = await threads.getOwned(String(req.params.threadId || "").trim(), currentUser.id, currentUser.organizationId);
  if (!thread) {
    res.status(404).json({ detail: "Thread does not exist" });
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
      res.status(404).json({ detail: "Thread does not exist" });
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
    const detail = error instanceof Error ? error.message : "Failed to update thread";
    res.status(400).json({ detail });
  }
});

app.delete("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const deleteMode = resolveThreadDeleteMode({
      query: req.query as Record<string, unknown>,
      role: currentUser.role
    });
    if (deleteMode.mode === "forbidden") {
      res.status(403).json({ detail: deleteMode.detail });
      return;
    }

    const thread =
      deleteMode.mode === "hard"
        ? await threads.get(threadId, currentUser.organizationId)
        : await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    if (thread.sessionId) {
      await sessions.remove(thread.sessionId);
      liveRuntimeThreads.delete(thread.sessionId);
    }

    if (deleteMode.mode === "archive") {
      const updated = thread.status === "archived" ? thread : await threads.update(threadId, { status: "archived" });
      res.json({ ok: true, mode: "archived", thread: threadOut(updated) });
      return;
    }

    const workspacePath = trimOrUndefined(thread.workspace);
    await threads.delete(threadId);
    if (workspacePath) {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
    await fs.rm(getThreadUploadTempDir(threadId), { recursive: true, force: true });
    res.json({ ok: true, mode: "deleted" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to delete thread";
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
    res.status(statusCodeForSessionAccessError(error)).json(payloadForSessionAccessError(error, "Failed to ensure thread session"));
  }
});

app.get("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const repository = await threads.getRepository(threadId);
    res.json({
      head_id: repository.headId ?? null,
      messages: repository.messages.map((item) => ({
        parent_id: item.parentId,
        message: item.message,
        run_config: item.runConfig
      })),
      feedback: thread.feedback.map(feedbackOut)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read message history";
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
      res.status(404).json({ detail: "Thread does not exist" });
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
    const detail = error instanceof Error ? error.message : "Failed to create public link";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
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
    const detail = error instanceof Error ? error.message : "Failed to append message";
    res.status(400).json({ detail });
  }
});

app.put("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
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
    const detail = error instanceof Error ? error.message : "Failed to replace message history";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/feedback", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await threads.getOwned(threadId, currentUser.id, currentUser.organizationId);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const rawBody = asRecord(req.body) ?? {};
    const hasCommentInput = Object.prototype.hasOwnProperty.call(rawBody, "comment");
    const input = feedbackSchema.parse(req.body || {});
    const targetMessage = thread.messages.find((item) => storedMessageId(item.message) === input.message_id);
    if (!targetMessage || storedMessageRole(targetMessage.message) !== "assistant") {
      res.status(400).json({ detail: "Feedback target must be an assistant message in this thread" });
      return;
    }
    const feedback = await threads.addFeedback(threadId, {
      type: input.type,
      messageId: input.message_id,
      contentPreview: summarizeText(input.content_preview || ""),
      comment: input.type === "negative" && hasCommentInput ? summarizeText(input.comment || "", 1000) : undefined,
      userId: currentUser.id
    });
    res.json({ feedback: feedbackOut(feedback) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to submit feedback";
    res.status(400).json({ detail });
  }
});

app.post("/api/chat/stream", async (req: Request, res: Response) => {
  initSSE(res);
  const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);

  try {
    const currentUser = currentActorFromRequest(req);
    const input = streamSchema.parse(req.body || {});
    const drainReason = await getDeploymentDrainReason();
    if (drainReason) {
      sendSSE(res, "error", { detail: drainReason });
      res.end();
      return;
    }
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
      sendSSE(res, "error", { detail: "Session does not exist or has expired" });
      res.end();
      return;
    }
    const ensuredLiveThread = liveThread;
    let currentSession: SessionRecord = session;
    const requestedThreadId = String(input.thread_id || "").trim();
    if (requestedThreadId) {
      const boundThreadId = String(currentSession.threadId || "").trim();
      if (!boundThreadId) {
        sendSSE(res, "error", { detail: "Session is not bound to a thread. Refresh and try again." });
        res.end();
        return;
      }
      if (boundThreadId !== requestedThreadId) {
        sendSSE(res, "error", { detail: "Session does not match the requested thread. Please try again." });
        res.end();
        return;
      }
    }

    // Each streamed turn is a new costly action. Gate it before execution without
    // terminating any turn that is already in flight.
    await assertChatAllowsNewSession({
      currentUser,
      model: currentSession.model,
      threadId: currentSession.threadId ?? undefined,
      sessionId: currentSession.sessionId,
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

    const artifactScanStartedAt = new Date(Date.now() - 2000);
    const runtimeFileChanges: RuntimeFileChange[] = [];
    await streamRuntimeCompletionWithBestEffortUsage({
      events: runtime.runStreamed(ensuredLiveThread, withSkillActivationPrompts(input.message, currentSession.codexRunConfig)),
      onEvent(event) {
        runtimeFileChanges.push(...extractRuntimeFileChanges(event));
        const codexThreadId = extractCodexThreadIdFromRuntimeEvent(event);
        if (codexThreadId) {
          void persistSessionCodexThreadId(currentSession, codexThreadId).then((updated) => {
            currentSession = updated;
          });
        }
        sendSSE(res, "codex", event);
      },
      async onDone(payload) {
        try {
          const artifacts = await registerGeneratedArtifactsForSession({
            currentUser,
            session: currentSession,
            changes: runtimeFileChanges,
            answerText: payload.answer,
            changedAfter: artifactScanStartedAt
          });
          if (artifacts.length > 0) {
            const policy = await resolveArtifactPolicyForActor(currentUser);
            sendSSE(res, "artifacts", {
              policy: artifactPolicyOut(policy),
              artifacts: artifacts.map(artifactOut)
            });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.warn("artifact registration failed", {
            sessionId: currentSession.sessionId,
            threadId: currentSession.threadId,
            detail
          });
          sendSSE(res, "artifact_warning", { detail: "Generated files could not be registered for external preview" });
        }
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
    sendSSE(res, "error", payloadForSessionAccessError(error, "Chat stream failed"));
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
  dingtalkBotStream.start();
  app.listen(appConfig.port, appConfig.host, () => {
    // eslint-disable-next-line no-console
    console.log(`agent-studio-api listening on http://${appConfig.host}:${appConfig.port}`);
  });
  void zendesk.recoverInterruptedProcessingRuns({ reprocess: true }).then((result) => {
    if (result.markedFailed > 0 || result.requeued > 0) {
      console.log("recovered interrupted Zendesk runs", result);
    }
  }).catch((error) => {
    console.warn("failed to recover interrupted Zendesk runs", error instanceof Error ? error.message : String(error));
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("failed to bootstrap api", error);
  process.exit(1);
});
