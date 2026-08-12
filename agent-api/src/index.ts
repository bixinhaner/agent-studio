import cors, { type CorsOptions } from "cors";
import express, { type Request, type Response } from "express";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { registerCommonApiRoutes } from "./app-routes.js";
import { createBroadcastAdminRouter } from "./admin/broadcast-router.js";
import { createTrainingCatalogAdminRouter } from "./admin/training-catalog-admin-router.js";
import { createConversationRecoveryRouter } from "./admin/conversation-recovery-router.js";
import { createAdminRouter } from "./admin/router.js";
import { SecurityDomainAccessControl } from "./security-domains/access-control.js";
import { createMonitoringRouter } from "./admin/monitoring-router.js";
import { createRbacRouter } from "./admin/rbac-router.js";
import { createAdminAccessRequestRouter } from "./access-requests/admin-router.js";
import { createPublicAccessRequestRouter } from "./access-requests/public-router.js";
import { createAccessRequestReviewRouter } from "./access-requests/review-router.js";
import { createAccessRequestService } from "./access-requests/service.js";
import { createAuthRouter, resolveCrestUser } from "./auth/router.js";
import {
  createCurrentUserMiddleware,
  requireCurrentOrganization,
  requireCurrentUser,
  requireInternalOrganizationMember
} from "./auth/current-user.js";
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
import {
  InlineVisualizationArtifactError,
  readInlineVisualizationArtifact,
  selectInlineVisualizationArtifact
} from "./artifacts/inline-visualization-artifact.js";
import {
  collectRuntimeGeneratedImageChanges,
  extractRuntimeFileChanges,
  materializeRuntimeGeneratedImageChanges,
  type RuntimeFileChange
} from "./artifacts/runtime-generated-artifacts.js";
import {
  collectGeneratedArtifactChanges,
  extractReferencedArtifactChanges,
  selectGeneratedArtifactChanges
} from "./artifacts/generated-artifact-discovery.js";
import {
  ARTIFACT_PUBLICATION_HINT,
  collectPublishedArtifactChanges
} from "./artifacts/artifact-publication.js";
import { NativeCodexSkillService } from "./codex-skills/native-codex-skill-service.js";
import { InstalledPluginService } from "./codex-plugins/installed-plugin-service.js";
import { CodexSkillService } from "./codex-skills/codex-skill-service.js";
import { createAdminCodexSkillRouter, createPortalCodexSkillRouter } from "./codex-skills/router.js";
import { BroadcastService } from "./collaboration/broadcast-service.js";
import { BroadcastAudienceResolver } from "./collaboration/broadcast-audience.js";
import { InboxProjectionService } from "./collaboration/inbox-projection-service.js";
import { createCollaborationRouter } from "./collaboration/router.js";
import { ThreadCollaborationService } from "./collaboration/thread-collaboration-service.js";
import { appConfig, resolveWorkspace } from "./config.js";
import { createAdminBillingRouter, createPortalBillingRouter } from "./billing/router.js";
import { BillingService } from "./billing/service.js";
import { CodexRuntime } from "./codex-runtime.js";
import { presentCodexRuntimeError } from "./codex-runtime-user-error.js";
import { sendBufferContent, sendFileContent } from "./files/raw-content-response.js";
import { CodexModelCatalogService } from "./codex-model-catalog.js";
import { isAppServerRuntimeEnabled, shutdownCodexAppServerRuntime } from "./codex-app-server-runtime.js";
import {
  assertCodexThreadContinuity,
  resolveCodexThreadContinuity,
  resolveCodexThreadContinuityWithHistory
} from "./codex-thread-continuity.js";
import { applyCodexMemoryToProviderSnapshot, mergeCodexConfig } from "./codex-memory-config.js";
import {
  CodexMemoryEngine,
  codexHomeFromRunConfig as codexHomeFromMemoryRunConfig,
  codexRunConfigHasExternalContext,
  syncAgentStudioMemoryProjection
} from "./codex-memory/engine.js";
import { CodexMemoryBackfillService } from "./codex-memory/backfill-service.js";
import { createCodexMemoryAdminRouter } from "./codex-memory/router.js";
import { EnterpriseContextService, type EnterpriseContextChannel } from "./enterprise-context-service.js";
import { sendOfficePdfPreview } from "./files/office-preview-service.js";
import {
  detectedContentType,
  sendStructuredPreview,
  type StructuredPreviewMode
} from "./files/structured-preview-service.js";
import {
  buildSharedPythonRuntimeEnv,
  ensureRuntimeWorkspaceTmp,
  inspectSharedPythonRuntime,
  sharedPythonRuntimeHint
} from "./shared-python-runtime.js";
import {
  buildToolRuntimeEnv,
  ensureToolRuntimeEnvDirs,
  TOOL_RUNTIME_FRESHNESS_HINT
} from "./tool-runtime-env.js";
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
import {
  ZendeskAiReviewEmailReminderScheduler,
  ZendeskAiReviewEmailReminderService
} from "./integrations/zendesk/ai-review-email-reminder-service.js";
import { ZendeskSettingsStore } from "./integrations/zendesk/settings-store.js";
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
  type RuntimeStreamEvent,
  type RuntimeUsageSnapshot
} from "./live-runtime-session.js";
import { REASONING_EFFORT_VALUES, fallbackModelCatalog, normalizeModel, normalizeReasoningEffortForModel } from "./model-config.js";
import { importLegacyThreadsFromJson } from "./persistence/json-import.js";
import { createServiceTokenMiddleware } from "./service-token.js";
import {
  createRuntimeStartupTimer,
  type RuntimeStartupTimer
} from "./runtime-startup-timing.js";
import {
  DEPLOYMENT_DRAIN_ERROR_CODE,
  assertDeploymentAllowsRuntimeStart,
  isDeploymentDrainError
} from "./portal/deployment-drain.js";
import {
  portalAutoRecoveryFailureAssistantMessage,
  portalAutoRecoveryPrompt,
  portalRuntimeEventHasAnySideEffect,
  portalRuntimeEventHasNonResumableSideEffect,
  portalRuntimeEventIndicatesTurnStarted,
  portalRuntimeEventStartsFinalAnswer,
  shouldAutoRecoverPortalChat
} from "./portal/chat-auto-recovery.js";
import {
  preserveCompletedPortalAssistantMessage,
  repairPortalAssistantCompletionStatus
} from "./portal/chat-message-precedence.js";
import { startWithMissingCodexRolloutRecovery } from "./portal/codex-thread-recovery.js";
import { guardPortalThreadModeChange } from "./portal/thread-mode-guard.js";
import {
  assertPortalAssistantHasUserParent,
  assertPortalMessageRepositoryIntegrity
} from "./portal/message-integrity.js";
import {
  mergePortalClientRepositoryReplacement,
  shouldIgnorePortalClientMessageAppend
} from "./portal/message-server-authority.js";
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
  ThreadReadStateRepository,
  type ThreadReadStateRepositoryDb
} from "./persistence/thread-read-state-repository.js";
import {
  PortalSteerEventRepository,
  type PortalSteerEventRecord,
  type PortalSteerEventRepositoryDb
} from "./persistence/portal-steer-event-repository.js";
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
import { createActionConnectorRuntimeRouter } from "./integrations/action-connector/routes.js";
import type { ConnectorIdentity } from "./integrations/action-connector/client.js";
import type { ActionConnectorCodexRunnerInput } from "./integrations/action-connector/runtime.js";
import { actionConnectorRuntimeEnvFromRunConfig } from "./integrations/action-connector/runtime-env.js";
import { buildActionConnectorRuntimePrompt } from "./integrations/action-connector/prompt.js";
import {
  actionConnectorCommentaryEntriesToEvents,
  projectActionConnectorRuntimeEvents
} from "./integrations/action-connector/runtime-events.js";
import { createActionConnectorProvisionRouter } from "./integrations/action-connector/provision-router.js";
import {
  ActionConnectorAttachmentStore,
  type MaterializedActionConnectorAttachment
} from "./integrations/action-connector/attachment-store.js";
import { createCrestRouter, issueCrestProxyTokenLease } from "./integrations/crest/router.js";
import { crestCommentaryEntryToThoughtPayload } from "./integrations/crest/stream-events.js";
import { createOpenAICompatibleRouter } from "./integrations/openai-compatible-router.js";
import { DINGTALK_BOT_CHANNEL, isDingTalkResetCommand, normalizeDingTalkBotConfig } from "./integrations/dingtalk/bot-config.js";
import {
  DingTalkBotStreamService,
  type DingTalkBotHandleResult,
  type DingTalkBotIncomingMessage,
  type DingTalkBotInstance,
  type DingTalkBotStreamingCardReply
} from "./integrations/dingtalk/bot-stream-service.js";
import { DingTalkBotErrorNotifier } from "./integrations/dingtalk/bot-error-notifier.js";
import { createPortalRouter } from "./portal/router.js";
import { PortalRuntimeOptionService, type PortalRuntimeOptionRunProfile } from "./portal/runtime-option-service.js";
import {
  resolvePortalTurnSkillInputs,
  withExplicitSkillMentions
} from "./portal/skill-runtime.js";
import { CodexInstructionReadObserver } from "./codex-skills/instruction-read-observer.js";
import { createSkillCatalogAdminRouter } from "./skill-catalog/router.js";
import { SkillCatalogRepository, type SkillCatalogRepositoryDb } from "./skill-catalog/repository.js";
import { SkillCatalogService } from "./skill-catalog/service.js";
import { DingTalkOrgProvider } from "./org-sync/dingtalk-org-provider.js";
import { AlertEvaluationService } from "./operations/alert-evaluation-service.js";
import { NotificationDispatchService } from "./operations/notification-dispatch-service.js";
import { OrgSyncScheduler } from "./org-sync/org-sync-scheduler.js";
import { OrgSyncService } from "./org-sync/org-sync-service.js";
import { createDingTalkDetailCacheLoader, type DingTalkDetailCacheDb } from "./org-sync/dingtalk-detail-cache.js";
import { resolveWorkspaceAgentsMdContent } from "./agent-mode/workspace-agents-md.js";
import { ResourceAccessLogService } from "./operations/resource-access-log-service.js";
import { QuotaEvaluationService } from "./operations/quota-evaluation-service.js";
import {
  isChatAccessDeniedError,
  SubscriptionEntitlementService
} from "./operations/subscription-entitlement-service.js";
import { UsageIngestionService } from "./operations/usage-ingestion-service.js";
import {
  CodexExecutionService,
  CodexRunProjection,
  type CodexCommentaryEntry,
  type CodexCompletionMemoryInput,
  type CodexRuntimeEventProjection,
  type CodexRunProjectionFinalized,
  type CodexRuntimeTurnTrackerInput
} from "./operations/codex-execution-service.js";
import { ConversationRecordService } from "./operations/conversation-record-service.js";
import { ConversationRecoveryService } from "./operations/conversation-recovery-service.js";
import { ProductFeedbackReplyService } from "./operations/product-feedback-reply-service.js";
import { CustomerExperienceIssueReporter } from "./operations/customer-experience-issue-reporter.js";
import {
  VisibleConversationFailureReporter,
  type VisibleConversationFailureInput
} from "./operations/visible-conversation-failure-reporter.js";
import { UsageLedgerService } from "./operations/usage-ledger-service.js";
import { UsageRecorder } from "./operations/usage-recorder.js";
import { UsageRollupService } from "./operations/usage-rollup-service.js";
import {
  ConversationSecurityReviewScheduler,
  ConversationSecurityReviewService
} from "./security-review/service.js";
import {
  ConversationSecurityReviewRepository
} from "./security-review/repository.js";
import { PermissionService } from "./rbac/permission-service.js";
import { createResourcesAdminRouter } from "./resources/admin-router.js";
import { createModeAdminRouter } from "./resources/mode-admin-router.js";
import { createResourcesPortalRouter } from "./resources/portal-router.js";
import { RuntimeKnowledgeSetService } from "./resources/runtime-knowledge-set-service.js";
import {
  buildIntegrationAgentWorkspacePath,
  buildSharedIntegrationCodexHomeScope,
  buildSharedCodexHomeScope,
  buildUserAgentWorkspacePath,
} from "./runtime-scope-resolver.js";
import { mergeRunConfigPreservingSkillSelection } from "./portal/thread-turn-config.js";
import { FilesystemKnowledgeSetStorage } from "./resources/storage/filesystem-knowledge-set-storage.js";
import { PolicyService } from "./resources/policy-service.js";
import { SystemSettingsRepository } from "./system-settings/repository.js";
import { createDefaultSystemSettingsPayload } from "./system-settings/types.js";
import { BrandingAssetStorage } from "./system-settings/branding-assets.js";
import { resolvePublicBranding, resolvePublicPlatformName } from "./system-settings/public-branding.js";
import {
  createAuthenticatedExternalWebGate,
  createExternalWebSurfaceGate,
  createPublicExternalWebGate,
  ExternalWebAccessService
} from "./external-web-access.js";
import { createSseAbortLifecycle, initSSE, sendSSE } from "./sse.js";
import { SecurityDomainService } from "./security-domains/service.js";
import { createPortalWorkspaceRouter } from "./workspaces/router.js";
import { PortalWorkspaceService } from "./workspaces/service.js";
import { LocalFsWorkspaceStorage } from "./workspaces/storage.js";
import { createTrainingCatalogRouter } from "./workspaces/training-catalog-router.js";
import { TrainingCatalogService } from "./workspaces/training-catalog-service.js";
import { TrainingTranslationService } from "./workspaces/training-translation-service.js";
import {
  buildTrainingTranslationPrompt,
  parseTrainingTranslations
} from "./workspaces/training-translation-prompt.js";
import {
  buildThreadPublicShareSnapshot,
  buildThreadPublicShareSnapshotFromLeadMessageIds,
  type ThreadPublicShareSnapshot
} from "./public-share/thread-public-share-snapshot.js";

const app = express();
const runsAdminService = appConfig.serviceRole !== "chat";
const runsChatService = appConfig.serviceRole !== "admin";
const runtime = new CodexRuntime();
const actionConnectorAttachments = new ActionConnectorAttachmentStore(
  path.join(appConfig.sessionWorkspaceRoot, ".action-connector-attachments")
);
type ActiveRuntimeTurn = {
  id: string;
  operation: CodexRuntimeTurnTrackerInput["operation"];
  channel?: string;
  organizationId?: string;
  userId?: string;
  sessionId?: string;
  threadId?: string;
  codexThreadId?: string;
  model?: string;
  hasExternalContext?: boolean;
  startedAt: string;
  startedAtMs: number;
};
const activeRuntimeTurns = new Map<string, ActiveRuntimeTurn>();

function startTrackedRuntimeTurn(input: CodexRuntimeTurnTrackerInput): () => void {
  const id = randomUUID();
  const now = Date.now();
  activeRuntimeTurns.set(id, {
    id,
    operation: input.operation,
    channel: trimOrUndefined(input.channel) ?? "unknown",
    organizationId: trimOrUndefined(input.organizationId),
    userId: trimOrUndefined(input.userId),
    sessionId: trimOrUndefined(input.sessionId),
    threadId: trimOrUndefined(input.threadId),
    codexThreadId: trimOrUndefined(input.codexThreadId),
    model: trimOrUndefined(input.model),
    hasExternalContext: input.hasExternalContext,
    startedAt: new Date(now).toISOString(),
    startedAtMs: now
  });
  return () => {
    activeRuntimeTurns.delete(id);
  };
}

function activeRuntimeTurnStatus() {
  const now = Date.now();
  const turns = Array.from(activeRuntimeTurns.values())
    .sort((left, right) => left.startedAtMs - right.startedAtMs)
    .map((turn) => ({
      id: turn.id,
      operation: turn.operation,
      channel: turn.channel,
      organization_id: turn.organizationId,
      user_id: turn.userId,
      session_id: turn.sessionId,
      thread_id: turn.threadId,
      codex_thread_id: turn.codexThreadId,
      model: turn.model,
      has_external_context: turn.hasExternalContext,
      started_at: turn.startedAt,
      age_ms: Math.max(0, now - turn.startedAtMs)
    }));
  const byChannel = turns.reduce<Record<string, number>>((acc, turn) => {
    const channel = turn.channel || "unknown";
    acc[channel] = (acc[channel] ?? 0) + 1;
    return acc;
  }, {});
  return {
    active_runtime_turns: turns.length,
    active_app_server_turns: isAppServerRuntimeEnabled() ? turns.length : 0,
    runtime_driver: isAppServerRuntimeEnabled() ? "app_server" : "exec",
    by_channel: byChannel,
    turns
  };
}

function hasActiveRuntimeTurnForThread(threadId: string): boolean {
  const normalizedThreadId = trimOrUndefined(threadId);
  if (!normalizedThreadId) return false;
  return Array.from(activeRuntimeTurns.values()).some((turn) => turn.threadId === normalizedThreadId);
}

async function isThreadActiveForAdmin(threadId: string): Promise<boolean> {
  if (runsChatService) return hasActiveRuntimeTurnForThread(threadId);
  const statusUrl = trimOrUndefined(process.env.AGENT_STUDIO_CHAT_INTERNAL_STATUS_URL);
  if (!statusUrl) return false;
  try {
    const response = await fetch(statusUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) return false;
    const payload = asRecord(await response.json());
    const turns = Array.isArray(payload?.turns) ? payload.turns : [];
    return turns.some((turn) => {
      const activeThreadId = asRecord(turn)?.thread_id;
      return trimOrUndefined(typeof activeThreadId === "string" ? activeThreadId : undefined) === threadId;
    });
  } catch {
    return false;
  }
}

async function activePortalThreadIdsForActor(
  currentUser: CurrentActor
): Promise<{ available: boolean; threadIds: Set<string> }> {
  let statuses: unknown[];
  if (runsChatService) {
    statuses = activeThreadStatus();
  } else {
    const statusUrl = trimOrUndefined(process.env.AGENT_STUDIO_CHAT_INTERNAL_STATUS_URL);
    if (!statusUrl) return { available: false, threadIds: new Set() };
    try {
      const response = await fetch(statusUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(1000)
      });
      if (!response.ok) return { available: false, threadIds: new Set() };
      const payload = asRecord(await response.json());
      statuses = Array.isArray(payload?.active_threads)
        ? payload.active_threads
        : Array.isArray(payload?.turns)
          ? payload.turns
          : [];
    } catch {
      return { available: false, threadIds: new Set() };
    }
  }

  const threadIds = new Set<string>();
  for (const item of statuses) {
    const record = asRecord(item);
    const threadId = trimOrUndefined(typeof record?.thread_id === "string" ? record.thread_id : undefined);
    const userId = trimOrUndefined(typeof record?.user_id === "string" ? record.user_id : undefined);
    const organizationId = trimOrUndefined(
      typeof record?.organization_id === "string" ? record.organization_id : undefined
    );
    const channel = trimOrUndefined(typeof record?.channel === "string" ? record.channel : undefined);
    if (
      threadId &&
      userId === currentUser.id &&
      organizationId === currentUser.organizationId &&
      channel === "portal"
    ) {
      threadIds.add(threadId);
    }
  }
  return { available: true, threadIds };
}

let codexMemoryEngine: CodexMemoryEngine;
const codexExecution = new CodexExecutionService({
  runtimeTurnTracker: {
    start: startTrackedRuntimeTurn
  },
  runtimeWorkspace: {
    async prepare(workspace) {
      await ensureToolRuntimeEnvDirs(workspace, appConfig.sharedCodexRuntime.runtimeRoot);
    }
  },
  memory: {
    enqueueRun(input) {
      codexMemoryEngine.enqueueRun(input);
    }
  }
});
const nativeCodexSkills = new NativeCodexSkillService(appConfig.codex);
const installedPlugins = new InstalledPluginService({ baseHome: appConfig.codex.baseHome });
const db = getDbClient();
const userWorkspaceStorage = new LocalFsWorkspaceStorage(appConfig.userWorkspaceStorageRoot);
const portalWorkspaces = new PortalWorkspaceService(db, userWorkspaceStorage, async (thread) => {
  if (thread.workspace && shouldRemoveWorkspaceOnThreadHardDelete(thread.id, thread.workspace)) {
    await fs.rm(thread.workspace, { recursive: true, force: true });
  }
  await fs.rm(getThreadUploadTempDir(thread.id), { recursive: true, force: true });
});
const securityDomains = new SecurityDomainService(db);
const sessions = new SessionRepository(db as unknown as SessionRepositoryDb, appConfig.sessionTtlMs);
const threads = new ThreadRepository(db as unknown as ThreadRepositoryDb);
const threadReadStates = new ThreadReadStateRepository(db as unknown as ThreadReadStateRepositoryDb);
const portalSteerEvents = new PortalSteerEventRepository(db as unknown as PortalSteerEventRepositoryDb);
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
const conversationSecurityReviews = new ConversationSecurityReviewRepository(db as never);
const syncJobs = new SyncJobRepository(db as unknown as SyncJobRepositoryDb);
const broadcasts = new BroadcastRepository(db as unknown as BroadcastRepositoryDb);
const resourceAccessLogRepository = new ResourceAccessLogRepository(db as unknown as ResourceAccessLogRepositoryDb);
const threadPublicShares = new ThreadPublicShareRepository(db as unknown as ThreadPublicShareRepositoryDb);
const threadArtifacts = new ThreadArtifactRepository(db as unknown as ThreadArtifactRepositoryDb);
const threadShares = new ThreadShareRepository(db as unknown as ThreadShareRepositoryDb);
const externalConversationBindings = new ExternalConversationBindingRepository(db as unknown as ExternalConversationBindingRepositoryDb);
const conversationRecords = new ConversationRecordService({
  threads,
  externalConversations: externalConversationBindings
});
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
const usageLedger = new UsageLedgerService({ usageEvents: usageEventRepository });
const usageRollupRepository = new UsageRollupRepository(db as unknown as UsageRollupRepositoryDb);
const costProfiles = new CostProfileRepository(db as unknown as CostProfileRepositoryDb);
const quotaPolicies = new QuotaPolicyRepository(db as unknown as QuotaPolicyRepositoryDb);
const knowledgeSets = new KnowledgeSetRepository(db as unknown as KnowledgeSetRepositoryDb);
const resourcePolicies = new ResourcePolicyRepository(db as unknown as ResourcePolicyRepositoryDb);
const runProfiles = new RunProfileRepository(db as unknown as RunProfileRepositoryDb);
const skillPackages = new SkillPackageRepository(db as unknown as SkillPackageRepositoryDb);
const agentModes = new AgentModeRepository(db as unknown as AgentModeRepositoryDb);
const codexSkills = new CodexSkillRepository(db as unknown as CodexSkillRepositoryDb);
const systemSettings = new SystemSettingsRepository(db as never);
const externalWebAccess = new ExternalWebAccessService(
  db as never,
  new AdminAuditLogRepository(db as never)
);
const enterpriseContext = new EnterpriseContextService({
  db: db as never,
  getSettings: async () =>
    (await systemSettings.getCurrentPublished())?.payload.enterpriseContext ??
    createDefaultSystemSettingsPayload().enterpriseContext,
  logger: console
});
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
const skillCatalog = new SkillCatalogService(
  new SkillCatalogRepository(db as unknown as SkillCatalogRepositoryDb),
  {
    nativeSkills: nativeCodexSkills,
    managedSkills: codexSkills,
    plugins: installedPlugins,
    users,
    skillPackages,
    agentModes,
    resourcePolicies
  }
);
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
codexMemoryEngine = new CodexMemoryEngine({
  getSettings: async () =>
    (await codexProviders.getPublishedSystemSettings())?.payload.codexMemory ??
    createDefaultSystemSettingsPayload().codexMemory,
  resolveProviderSnapshot: () => codexProviders.resolveActiveProviderSnapshot(),
  getLlmSecretState: getCodexMemoryLlmSecretState,
  sessionHomeRoot: appConfig.codex.sessionHomeRoot,
  logger: console
});
const codexMemoryBackfill = new CodexMemoryBackfillService({
  db,
  memoryEngine: codexMemoryEngine,
  sessionHomeRoot: appConfig.codex.sessionHomeRoot,
  logger: console
});
void codexMemoryBackfill.resumePendingRuns().catch((error) => {
  console.warn("codex memory backfill resume failed", {
    detail: error instanceof Error ? error.message : String(error)
  });
});
const dingtalkClient = createDingTalkClient(appConfig.dingtalk);
const zendeskSettingsStore = new ZendeskSettingsStore();

const CODEX_MEMORY_LLM_INTEGRATION_TYPE = "codex_memory_llm";
const CODEX_MEMORY_LLM_INTEGRATION_SLUG = "default";

async function findCodexMemoryLlmIntegrationInstance(): Promise<{ id: string } | undefined> {
  return (await db.integrationInstance.findFirst({
    where: {
      type: CODEX_MEMORY_LLM_INTEGRATION_TYPE,
      slug: CODEX_MEMORY_LLM_INTEGRATION_SLUG
    },
    select: { id: true }
  })) ?? undefined;
}

async function ensureCodexMemoryLlmIntegrationInstance(): Promise<{ id: string }> {
  return await db.integrationInstance.upsert({
    where: {
      type_slug: {
        type: CODEX_MEMORY_LLM_INTEGRATION_TYPE,
        slug: CODEX_MEMORY_LLM_INTEGRATION_SLUG
      }
    },
    create: {
      type: CODEX_MEMORY_LLM_INTEGRATION_TYPE,
      slug: CODEX_MEMORY_LLM_INTEGRATION_SLUG,
      name: "Codex Memory LLM Provider",
      description: "System-level LLM credentials for Agent Studio memory generation.",
      status: "active",
      isSystemSingleton: true
    },
    update: {
      name: "Codex Memory LLM Provider",
      status: "active",
      isSystemSingleton: true
    },
    select: { id: true }
  });
}

async function getCodexMemoryLlmSecretState(): Promise<{ apiKey?: string }> {
  const instance = await findCodexMemoryLlmIntegrationInstance();
  if (!instance) return {};
  const secretRow = await db.integrationInstanceSecret.findUnique({
    where: { integrationInstanceId: instance.id }
  });
  const secret = asRecord(secretRow?.secretState);
  return {
    apiKey: asString(secret?.apiKey)
  };
}

async function getCodexMemoryLlmSecretStatus(): Promise<{ hasApiKey: boolean; rotatedAt?: string; updatedAt?: string }> {
  const instance = await findCodexMemoryLlmIntegrationInstance();
  if (!instance) return { hasApiKey: false };
  const secretRow = await db.integrationInstanceSecret.findUnique({
    where: { integrationInstanceId: instance.id }
  });
  const secret = asRecord(secretRow?.secretState);
  return {
    hasApiKey: Boolean(asString(secret?.apiKey)),
    rotatedAt: secretRow?.rotatedAt instanceof Date ? secretRow.rotatedAt.toISOString() : undefined,
    updatedAt: secretRow?.updatedAt instanceof Date ? secretRow.updatedAt.toISOString() : undefined
  };
}

async function updateCodexMemoryLlmSecret(input: {
  apiKey?: string;
  clearApiKey?: boolean;
  currentUserId?: string;
}): Promise<{ hasApiKey: boolean; rotatedAt?: string; updatedAt?: string }> {
  const apiKey = trimOrUndefined(input.apiKey);
  if (!apiKey && !input.clearApiKey) {
    return await getCodexMemoryLlmSecretStatus();
  }
  const instance = await ensureCodexMemoryLlmIntegrationInstance();
  if (input.clearApiKey) {
    await db.integrationInstanceSecret.upsert({
      where: { integrationInstanceId: instance.id },
      create: {
        integrationInstanceId: instance.id,
        hasSecrets: false,
        secretState: {},
        rotatedAt: new Date(),
        rotatedByUserId: trimOrUndefined(input.currentUserId) ?? null
      },
      update: {
        hasSecrets: false,
        secretState: {},
        rotatedAt: new Date(),
        rotatedByUserId: trimOrUndefined(input.currentUserId) ?? null
      }
    });
    return await getCodexMemoryLlmSecretStatus();
  }
  await db.integrationInstanceSecret.upsert({
    where: { integrationInstanceId: instance.id },
    create: {
      integrationInstanceId: instance.id,
      hasSecrets: true,
      secretState: { apiKey },
      rotatedAt: new Date(),
      rotatedByUserId: trimOrUndefined(input.currentUserId) ?? null
    },
    update: {
      hasSecrets: true,
      secretState: { apiKey },
      rotatedAt: new Date(),
      rotatedByUserId: trimOrUndefined(input.currentUserId) ?? null
    }
  });
  return await getCodexMemoryLlmSecretStatus();
}

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
const billingService = new BillingService({
  db,
  config: appConfig.billing,
  emailSender: authEmailSender,
  notifications: notificationRecords,
  resolveBrandName: () => resolvePublicPlatformName(systemSettings)
});
const conversationRecovery = new ConversationRecoveryService({
  db: db as never,
  emailSender: authEmailSender,
  notifications: notificationRecords,
  billing: billingService,
  resolveBrandName: () => resolvePublicPlatformName(systemSettings),
  resolvePortalUrl: () => appConfig.serviceRecoveryPortalUrl || appConfig.appBaseUrl
});
const productFeedbackReply = new ProductFeedbackReplyService({
  feedback: productFeedback,
  notifications: notificationRecords,
  emailSender: authEmailSender,
  resolveBrandName: () => resolvePublicPlatformName(systemSettings),
  resolvePortalUrl: () => appConfig.serviceRecoveryPortalUrl || appConfig.appBaseUrl
});
const customerExperienceIssues = new CustomerExperienceIssueReporter({
  recovery: conversationRecovery,
  notifications: notificationRecords,
  sendWorkNotice: sendActiveDingTalkWorkNotice,
  listSuperAdminDingTalkUserIds,
  resolveUserIdentity: async (userId) => {
    const user = await users.getById(userId);
    if (!user) return undefined;
    return {
      displayName: user.displayName,
      email: user.email
    };
  },
  logger: console
});
const visibleConversationFailureReporter = new VisibleConversationFailureReporter({
  issues: customerExperienceIssues
});
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
const usageRollups = new UsageRollupService({
  usageEvents: usageEventRepository,
  rollups: usageRollupRepository
});
const usageRollupRebuilds = new Map<string, Promise<void>>();

function toUsageRollupDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

async function rebuildUsageRollupForEvent(event: {
  organizationId?: string;
  createdAt: string;
}): Promise<void> {
  const rollupDate = toUsageRollupDateKey(event.createdAt);
  const organizationId = trimOrUndefined(event.organizationId) ?? null;
  const key = `${organizationId ?? "global"}:${rollupDate}`;
  const previous = usageRollupRebuilds.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await usageRollups.rebuildDaily({
        rollupDate,
        organizationId
      });
    });
  usageRollupRebuilds.set(key, next);
  try {
    await next;
  } finally {
    if (usageRollupRebuilds.get(key) === next) {
      usageRollupRebuilds.delete(key);
    }
  }
}

const usageIngestion = new UsageIngestionService({
  usageEvents: usageEventRepository,
  costProfiles,
  afterRecord: rebuildUsageRollupForEvent
});
const usageRecorder = new UsageRecorder({ usageIngestion });
const trainingTranslations = new TrainingTranslationService(db, async (input) => {
  const providerSnapshot = await codexProviders.resolveActiveProviderSnapshot();
  const model = providerSnapshot.config.defaultModel;
  const runtime = createRuntimeForProviderSnapshot(providerSnapshot);
  const workspace = path.join(appConfig.sessionWorkspaceRoot, ".training-translation");
  try {
    await fs.mkdir(workspace, { recursive: true });
    const runtimeThread = await runtime.startThreadWithOptions({
      model,
      reasoningEffort: "low",
      workspace,
      codexRunConfig: {
        sandboxMode: "read-only",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        additionalDirectories: []
      }
    });
    const result = await codexExecution.collectFromRuntime({
      runtime,
      thread: runtimeThread,
      prompt: buildTrainingTranslationPrompt(input.texts, input.purpose),
      workspace
    });
    await usageRecorder.recordCodexUsage({
      organizationId: input.organizationId,
      model,
      featureType: "training_translation",
      usage: result.usage,
      codexThreadId: result.usage?.codexThreadId,
      resultStatus: "success",
      metadata: {
        source: "portal_training_translation",
        provider: providerSnapshot.kind,
        purpose: input.purpose,
        textCount: input.texts.length
      }
    });
    return parseTrainingTranslations(result.answer, input.texts.length);
  } catch (error) {
    await usageRecorder.recordCodexUsage({
      organizationId: input.organizationId,
      model,
      featureType: "training_translation",
      resultStatus: "failed",
      metadata: {
        source: "portal_training_translation",
        provider: providerSnapshot.kind,
        purpose: input.purpose,
        textCount: input.texts.length
      }
    }).catch(() => undefined);
    throw error;
  }
});
const trainingCatalog = new TrainingCatalogService(
  db,
  portalWorkspaces,
  appConfig.portalTraining,
  trainingTranslations
);
const conversationSecurityReview = new ConversationSecurityReviewService({
  db,
  reviews: conversationSecurityReviews,
  systemSettings,
  providerSnapshot: () => codexProviders.resolveActiveProviderSnapshot(),
  runCodexReview: async (input) => {
    const providerSnapshot = await codexProviders.resolveActiveProviderSnapshot();
    const reviewRuntime = createRuntimeForProviderSnapshot(providerSnapshot);
    const model = input.model ?? providerSnapshot.config.defaultModel;
    const workspace = path.join(appConfig.sessionWorkspaceRoot, ".conversation-security-review");
    try {
      await fs.mkdir(workspace, { recursive: true });
      const runtimeThread = await reviewRuntime.startThreadWithOptions({
        model,
        reasoningEffort: input.reasoningEffort,
        workspace,
        codexRunConfig: {
          sandboxMode: "read-only",
          approvalPolicy: "never",
          networkAccessEnabled: false,
          webSearchMode: "disabled",
          additionalDirectories: []
        }
      });
      const result = await codexExecution.collectFromRuntime({
        runtime: reviewRuntime,
        thread: runtimeThread,
        prompt: input.prompt,
        workspace
      });
      await usageRecorder.recordCodexUsage({
        organizationId: input.review.organizationId,
        userId: input.review.userId,
        threadId: input.review.threadId,
        model,
        featureType: "security_review",
        usage: result.usage,
        codexThreadId: result.usage?.codexThreadId,
        resultStatus: "success",
        metadata: {
          source: "conversation_security_review",
          reviewId: input.review.id,
          provider: providerSnapshot.kind,
          engine: "codex_runtime"
        }
      });
      return {
        text: result.answer,
        provider: `codex_runtime:${providerSnapshot.kind}`,
        model,
        codexUsage: result.usage
      };
    } catch (error) {
      await usageRecorder.recordCodexUsage({
        organizationId: input.review.organizationId,
        userId: input.review.userId,
        threadId: input.review.threadId,
        model,
        featureType: "security_review",
        resultStatus: "failed",
        metadata: {
          source: "conversation_security_review",
          reviewId: input.review.id,
          provider: providerSnapshot.kind,
          engine: "codex_runtime"
        }
      }).catch(() => undefined);
      throw error;
    }
  },
  usageRecorder,
  alertEvents,
  notifyDingTalk: async (input) => {
    const notification = await notificationRecords.create({
      organizationId: input.review.organizationId,
      channelType: "dingtalk",
      targetRef: input.event.id,
      eventType: "conversation_security_review",
      status: "pending",
      payload: {
        alertEventId: input.event.id,
        reviewId: input.review.id,
        threadId: input.review.threadId,
        recipientUserIds: input.recipientDingTalkUserIds
      }
    });
    try {
      await sendActiveDingTalkWorkNotice({
        userIds: input.recipientDingTalkUserIds,
        message: input.message
      });
      await notificationRecords.update({
        id: notification.id,
        changes: { status: "sent", errorMessage: null }
      });
      return true;
    } catch (error) {
      await notificationRecords.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "DingTalk notification failed"
        }
      });
      return false;
    }
  },
  logger: console
});
const conversationSecurityReviewScheduler = new ConversationSecurityReviewScheduler(conversationSecurityReview);

async function resolveZendeskDingTalkMentionTarget(input: {
  zendeskUser?: ZendeskRequesterPayload;
  settings: ZendeskIntegrationSettings;
  fallbackUserIds?: string[];
  fallbackDetail?: string;
}): Promise<{ userIds: string[]; label?: string; detail?: string } | undefined> {
  const email = trimOrUndefined(input.zendeskUser?.email)?.toLowerCase();
  const fallbackLabel = trimOrUndefined(input.zendeskUser?.name) || email;
  if (!input.zendeskUser) {
    const configuredUserIds = input.fallbackUserIds ?? input.settings.dingtalkNotificationFallbackUserIds;
    const fallbackUserIds = Array.from(new Set(configuredUserIds.map((item) => item.trim()).filter(Boolean)));
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
    const detail =
      trimOrUndefined(input.fallbackDetail) ||
      (missingCount > 0
        ? `Using ${fallbackUserIds.length} fallback DingTalk user(s); ${missingCount} not found in active Agent Studio users.`
        : `Using ${fallbackUserIds.length} fallback DingTalk user(s).`);
    return {
      userIds: fallbackUserIds,
      label: labels.length ? labels.join(", ") : "Support team",
      detail:
        trimOrUndefined(input.fallbackDetail) && missingCount > 0
          ? `${detail} ${missingCount} not found in active Agent Studio users.`
          : detail
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
      ? `Matched Zendesk user email ${email} to DingTalk user.`
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
  skipExistingReviews?: boolean;
}): Promise<{ reviewCount: number; reviewUrl?: string; reviewSummaryMarkdown: string; detail?: string }> {
  let uniqueDingTalkUserIds = Array.from(
    new Set(input.atUserIds.map((item) => String(item || "").trim()).filter(Boolean))
  );
  if (!uniqueDingTalkUserIds.length) {
    return {
      reviewCount: 0,
      reviewSummaryMarkdown: ""
    };
  }
  if (input.skipExistingReviews) {
    const existingReviews = await aiResponseReviews.listForZendeskRun(input.runId);
    const existingDingTalkUserIds = new Set(
      existingReviews
        .map((review) => trimOrUndefined(review.reviewerDingTalkUserId))
        .filter((item): item is string => Boolean(item))
    );
    uniqueDingTalkUserIds = uniqueDingTalkUserIds.filter((userId) => !existingDingTalkUserIds.has(userId));
    if (!uniqueDingTalkUserIds.length) {
      return {
        reviewCount: 0,
        reviewSummaryMarkdown: "",
        detail: "No missing AI review tasks for the current recipients."
      };
    }
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
  codexExecution,
  getDrainReason: getDeploymentDrainReason,
  codexSessionHomeRoot: appConfig.codex.sessionHomeRoot,
  registerGeneratedArtifacts: registerGeneratedArtifactsForRuntimeSession,
  async recordUsage(input) {
    const integration = input.instanceId
      ? await db.integrationInstance.findUnique({ where: { id: input.instanceId } })
      : null;
    const integrationSlug =
      typeof integration?.slug === "string" && integration.slug.trim()
        ? integration.slug.trim()
        : input.instanceId || "legacy";
    await usageRecorder.recordCodexUsage({
      organizationId: integration?.organizationId ?? undefined,
      userId: `zendesk-bot:${input.instanceId || "legacy"}`,
      threadId: input.auditThreadId,
      sessionId: `zendesk:${input.instanceId || "legacy"}:ticket:${input.ticketId}`,
      model: input.runtime.model,
      featureType: "chat",
      usage: input.usage,
      codexThreadId: input.codexThreadId,
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
const zendeskAiReviewEmailReminderService = new ZendeskAiReviewEmailReminderService({
  reviews: aiResponseReviews,
  notifications: notificationRecords,
  emailSender: authEmailSender,
  listInstances: async () =>
    db.integrationInstance.findMany({
      where: {
        type: "zendesk",
        status: "active"
      },
      select: {
        id: true,
        slug: true,
        name: true,
        organizationId: true
      },
      orderBy: { createdAt: "asc" }
    }),
  resolveSettings: (instanceId) => zendeskSettingsStore.getForInstance(instanceId)
});
const zendeskAiReviewEmailReminderScheduler = new ZendeskAiReviewEmailReminderScheduler(
  zendeskAiReviewEmailReminderService
);
const brandingAssetStorage = new BrandingAssetStorage(appConfig.brandingAssetRoot);
const policyService = new PolicyService(resourcePolicies);
const integrationCenter = createIntegrationCenterService({
  db: db as unknown as IntegrationCenterDb,
  policies: resourcePolicies as never,
  policyService,
  usageLedger,
  zendeskAiReviewEmailReminders: {
    sendManualReminder: (input) => zendeskAiReviewEmailReminderService.sendManualReminder(input)
  },
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
      const alertUserIds = asStringArray(config.alertUserIds);
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
        redirectUri: asString(config.redirectUri),
        scope: asString(config.scope),
        apiBaseUrl,
        alertAgentId: asString(config.alertAgentId),
        alertUserIds,
        robot
      };
    })
    .filter((instance) => instance.robot.enabled);
}

async function listSuperAdminDingTalkUserIds(): Promise<string[]> {
  const rows = await db.user.findMany({
    where: {
      status: "active",
      role: "super_admin",
      dingtalkUserId: { not: null }
    },
    select: {
      dingtalkUserId: true
    },
    orderBy: { createdAt: "asc" }
  });
  return asStringArray(rows.map((row) => row.dingtalkUserId));
}

async function sendDingTalkBotErrorWorkNotice(input: {
  instance: DingTalkBotInstance;
  userIds: string[];
  message: string;
}): Promise<void> {
  const client = createDingTalkClient({
    ...appConfig.dingtalk,
    clientId: input.instance.clientId || appConfig.dingtalk.clientId,
    clientSecret: input.instance.clientSecret || appConfig.dingtalk.clientSecret,
    redirectUri: input.instance.redirectUri || appConfig.dingtalk.redirectUri,
    scope: input.instance.scope || appConfig.dingtalk.scope,
    apiBaseUrl: input.instance.apiBaseUrl,
    alertAgentId: input.instance.alertAgentId || appConfig.dingtalk.alertAgentId,
    alertUserIds: input.userIds
  });
  if (!client.sendWorkNotice) {
    throw new Error("DingTalk work notice sender is not available");
  }
  await client.sendWorkNotice({
    userIds: input.userIds,
    message: input.message
  });
}
const dingtalkBotStream = new DingTalkBotStreamService({
  listInstances: listDingTalkBotStreamInstances,
  handleMessage: handleDingTalkBotMessage,
  logger: console
});
const dingtalkBotErrorNotifier = new DingTalkBotErrorNotifier({
  notifications: notificationRecords,
  sendWorkNotice: sendDingTalkBotErrorWorkNotice,
  listSuperAdminDingTalkUserIds,
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
const broadcastAudienceResolver = new BroadcastAudienceResolver(db as never);
const collaborationReadService = new ThreadCollaborationService({
  threads,
  shares: threadShares,
  comments: threadComments,
  collaboration: threadCollaboration,
  inboxProjection,
  directory: {
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
    listUserIdsForDepartment,
    ensureUsersExist,
    getSecurityDomainIdForUser: (userId) => securityDomains.getDomainIdForUser(userId)
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
    ensureUsersExist,
    getSecurityDomainIdForUser: (userId) => securityDomains.getDomainIdForUser(userId)
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
    ensureUsersExist,
    getSecurityDomainIdForUser: (userId) => securityDomains.getDomainIdForUser(userId)
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
    ensureUsersExist,
    getSecurityDomainIdForUser: (userId) => securityDomains.getDomainIdForUser(userId)
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
    ensureUsersExist,
    getSecurityDomainIdForUser: (userId) => securityDomains.getDomainIdForUser(userId)
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
  notificationRecords,
  audienceResolver: broadcastAudienceResolver,
  emailSender: authEmailSender,
  getBranding: async () => (await resolvePublicBranding(systemSettings)).branding,
  portalBaseUrl: appConfig.appBaseUrl || appConfig.serviceRecoveryPortalUrl,
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
  installedPlugins,
  managedSkills: codexSkills,
  skillCatalog,
  recentSkills: {
    async listRecentSkillIds({ organizationId, userId, take }) {
      const rows = await db.thread.findMany({
        where: {
          userId,
          ...(organizationId ? { organizationId } : {}),
          channel: "portal"
        },
        orderBy: { updatedAt: "desc" },
        take,
        select: { codexRunConfig: true }
      });
      const recent: string[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        for (const skill of enabledSkillSelectionsFromRunConfig(asRecord(row.codexRunConfig) ?? undefined)) {
          if (seen.has(skill.id)) continue;
          seen.add(skill.id);
          recent.push(skill.id);
        }
      }
      return recent;
    }
  },
  policies: policyService
});
const runtimeKnowledgeSets = new RuntimeKnowledgeSetService({
  knowledgeSets,
  policies: policyService,
  storage: knowledgeSetStorage,
  resourceAccessLogs,
  securityAlerts: alertEvaluation
});
const dingtalkOrgProvider = new DingTalkOrgProvider(dingtalkClient, {
  loadUserDetailCache: createDingTalkDetailCacheLoader(db as unknown as DingTalkDetailCacheDb)
});
const orgSyncService = new OrgSyncService({
  provider: dingtalkOrgProvider,
  departments,
  users,
  memberships: departmentMemberships,
  organizations,
  organizationMemberships,
  jobs: syncJobs,
  resourceAccessLogs,
  afterSuccessfulSync: () => securityDomains.refreshAll()
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
const securityDomainAccess = new SecurityDomainAccessControl(db, {
  cookieName: `${appConfig.sessionCookie.name}_security_domain_access`,
  secret: appConfig.sessionCookie.secret,
  secure: appConfig.sessionCookie.secure
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
const RUNTIME_HINTS_RUN_CONFIG_KEY = "_agentStudioRuntimeHints";
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
  event: { delta?: string; text?: string; raw?: unknown },
  phaseByItemId?: Map<string, string>
): string {
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  const itemType = typeof item?.type === "string" ? item.type : "";
  if (itemType !== "agent_message") return current;
  const itemId = typeof item?.id === "string" ? item.id.trim() : "";
  const phase = normalizeRuntimeAgentMessagePhase(item?.phase);
  if (itemId && phase) {
    phaseByItemId?.set(itemId, phase);
  }
  const resolvedPhase = phase || (itemId ? phaseByItemId?.get(itemId) || "" : "");
  if (resolvedPhase && resolvedPhase !== "final_answer") return current;
  if (raw?.type === "item.completed") return current;
  if (event.delta) return current + event.delta;
  if (event.text && !current) return event.text;
  return current;
}

function normalizeRuntimeAgentMessagePhase(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[-\s]+/g, "_").toLowerCase() : "";
}

function runtimeErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function isRecoverableCodexResumeError(error: unknown): boolean {
  return /thread\/resume failed|no rollout found for thread id/i.test(runtimeErrorDetail(error));
}

function runtimeEventHasTurnSideEffect(event: { delta?: string; text?: string; raw?: unknown }): boolean {
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  const itemType = typeof item?.type === "string" ? item.type : "";
  return Boolean(
    event.delta ||
    itemType === "agent_message" ||
    portalRuntimeEventHasAnySideEffect(event)
  );
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

async function restoreLiveRuntimeThread(
  session: SessionRecord,
  timing?: RuntimeStartupTimer
): Promise<LiveRuntimeThread | undefined> {
  const cached = liveRuntimeThreads.get(session.sessionId);
  if (cached) {
    timing?.mark("restore_runtime.cached", { sessionId: session.sessionId });
    return cached;
  }

  const codexThreadId = trimOrUndefined(session.codexThreadId);
  if (!codexThreadId) {
    timing?.mark("restore_runtime.missing_codex_thread_id", { sessionId: session.sessionId });
    return undefined;
  }

  try {
    const time = async <T>(
      name: string,
      action: () => Promise<T>,
      metadata?: Record<string, unknown>
    ): Promise<T> => (timing ? timing.time(name, action, metadata) : action());
    const sourceCodexRunConfig = withoutInternalRuntimeMetadata(session.codexRunConfig);
    const existingCodexHome = codexHomeFromRunConfig(session.codexRunConfig);
    const materializedCodexHome = existingCodexHome
      ? {
          codexHome: existingCodexHome,
          codexRunConfig: withRunConfigCodexHome(sourceCodexRunConfig, existingCodexHome)
        }
      : (
          await time("restore_runtime.materialize_shared_codex_home", () =>
            materializeSharedCodexHomeForSessionRecord({
              session,
              codexRunConfig: sourceCodexRunConfig
            })
          )
        ) ??
        await time("restore_runtime.materialize_codex_home", () =>
          materializeCodexHomeForRunConfig({
            scopeId: session.threadId ? `thread-${session.threadId}` : `session-${session.sessionId}`,
            codexRunConfig: sourceCodexRunConfig
          })
        );
    const automaticPluginReconciliation = await time(
      "restore_runtime.reconcile_automatic_plugins",
      () => nativeCodexSkills.reconcileSharedPluginCaches(materializedCodexHome.codexHome)
    );
    if (automaticPluginReconciliation.changed) {
      console.info("automatic plugin caches reconciled", {
        sessionId: session.sessionId,
        expectedPluginCount: automaticPluginReconciliation.expectedPlugins.length,
        mountedPluginCount: automaticPluginReconciliation.mountedPlugins.length
      });
    }
    if (existingCodexHome) {
      timing?.mark("restore_runtime.reuse_codex_home", { sessionId: session.sessionId });
    }
    const runtimeLaunch = await time("restore_runtime.resolve_launch_config", () =>
      resolveRuntimeLaunchConfig({
        userId: session.userId,
        workspace: session.workspace,
        codexRunConfig: materializedCodexHome.codexRunConfig
      })
    );
    const providerSnapshot = await time("restore_runtime.resolve_provider_snapshot", () =>
      resolveProviderSnapshot({
        existingSnapshot: session.providerSnapshot,
        fallbackToLocalAuth: true
      })
    );
    const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
      configOverrides: runtimeLaunch.configOverrides,
      envOverrides: {
        ...(runtimeLaunch.envOverrides ?? {}),
        ...actionConnectorRuntimeEnvFromRunConfig(materializedCodexHome.codexRunConfig),
        CODEX_HOME: materializedCodexHome.codexHome
      }
    });
    const liveThread = await time("restore_runtime.resume_thread", () =>
      sessionRuntime.resumeThreadWithOptions({
        threadId: codexThreadId,
        model: session.model,
        reasoningEffort: session.reasoningEffort,
        workspace: session.workspace,
        codexRunConfig: stripInternalRunConfigMetadata(runtimeLaunch.codexRunConfig)
      })
    );
    await time("restore_runtime.refresh_skills", () =>
      sessionRuntime.refreshSkills(liveThread, {
        cwds: [session.workspace],
        fingerprint: automaticPluginReconciliation.fingerprint
      })
    );
    if (stableJson(session.codexRunConfig) !== stableJson(runtimeLaunch.codexRunConfig)) {
      await time("restore_runtime.persist_updated_config", () =>
        sessions.update(session.sessionId, {
          codexRunConfig: runtimeLaunch.codexRunConfig
        })
      );
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

function runtimePrewarmLimit(): number {
  const parsed = Number.parseInt((process.env.CODEX_APP_SERVER_MAX_PROCESSES || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function runtimePrewarmHours(): number {
  const parsed = Number.parseInt((process.env.CODEX_APP_SERVER_PREWARM_HOURS || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

async function prewarmAppServerRuntimeSessions(): Promise<void> {
  if (!isAppServerRuntimeEnabled()) return;
  const limit = runtimePrewarmLimit();
  const cutoff = new Date(Date.now() - runtimePrewarmHours() * 60 * 60_000);
  const rows = await (db as never as {
    runtimeSession: {
      findMany(args: {
        where: { status: "active"; updatedAt: { gte: Date }; externalId?: { not: null } };
        select: { externalId: true };
        orderBy: { updatedAt: "desc" };
        take: number;
      }): Promise<Array<{ externalId: string | null }>>;
    };
  }).runtimeSession.findMany({
    where: {
      status: "active",
      updatedAt: { gte: cutoff },
      externalId: { not: null }
    },
    select: { externalId: true },
    orderBy: { updatedAt: "desc" },
    take: Math.max(limit * 8, limit)
  });

  const seenScopes = new Set<string>();
  let attempted = 0;
  let restored = 0;
  for (const row of rows) {
    if (attempted >= limit) break;
    const sessionId = trimOrUndefined(row.externalId);
    if (!sessionId) continue;
    const session = await sessions.peek(sessionId);
    const codexHome = codexHomeFromRunConfig(session?.codexRunConfig);
    const codexThreadId = trimOrUndefined(session?.codexThreadId);
    if (!session || !codexHome || !codexThreadId) continue;
    const scopeKey = `${codexHome}::${stableJson(session.providerSnapshot?.runtimeOptions)}`;
    if (seenScopes.has(scopeKey)) continue;
    seenScopes.add(scopeKey);
    attempted += 1;
    const liveThread = await restoreLiveRuntimeThread(session);
    if (liveThread) restored += 1;
  }
  console.log("app-server runtime prewarm completed", {
    attempted,
    restored,
    limit,
    cutoff: cutoff.toISOString()
  });
}

async function materializeSharedCodexHomeForSessionRecord(input: {
  session: SessionRecord;
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> } | undefined> {
  return materializeSharedCodexHomeForRuntimeOwner({
    organizationId: input.session.organizationId,
    userId: input.session.userId,
    codexRunConfig: input.codexRunConfig
  });
}

async function materializeSharedCodexHomeForRuntimeOwner(input: {
  organizationId?: string | null;
  userId?: string | null;
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> } | undefined> {
  const organizationId = trimOrUndefined(input.organizationId);
  const userId = trimOrUndefined(input.userId);
  if (!organizationId || !userId) {
    return undefined;
  }
  const organization = await organizations.getById(organizationId).catch(() => undefined);
  const modeId = modeIdFromRunConfig(input.codexRunConfig) ?? "default";
  return await materializeSharedCodexHomeForRunConfig({
    currentUser: {
      id: userId,
      organizationId,
      organizationSlug: organization?.slug
    },
    modeId,
    codexRunConfig: input.codexRunConfig
  });
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
  try {
    if (session.threadId) {
      const agentThread = await threads.get(session.threadId, session.organizationId);
      const existingBinding = trimOrUndefined(agentThread?.codexThreadId);
      assertCodexThreadContinuity({
        expectedCodexThreadId: existingBinding,
        observedCodexThreadId: normalized,
        scope: "Agent thread"
      });
      if (!existingBinding) {
        await threads.update(session.threadId, { codexThreadId: normalized });
      }
    }
    return trimOrUndefined(session.codexThreadId) === normalized
      ? session
      : await sessions.update(session.sessionId, { codexThreadId: normalized });
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

async function retireLiveRuntimeSession(
  session: SessionRecord | undefined,
  input: { status?: "ended" | "failed"; reason: string; logLabel?: string }
): Promise<void> {
  if (!session?.sessionId) return;
  liveRuntimeThreads.delete(session.sessionId);
  try {
    await sessions.retire(session.sessionId, input.status ?? "ended");
  } catch (error) {
    console.warn(`${input.logLabel ?? "runtime"} failed to retire live runtime session`, {
      sessionId: session.sessionId,
      threadId: session.threadId,
      codexThreadId: session.codexThreadId,
      reason: input.reason,
      detail: error instanceof Error ? error.message : String(error)
    });
    return;
  }
  console.log(`${input.logLabel ?? "runtime"} retired live runtime session`, {
    sessionId: session.sessionId,
    threadId: session.threadId,
    codexThreadId: session.codexThreadId,
    status: input.status ?? "ended",
    reason: input.reason
  });
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
  client_run_id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  client_assistant_message_id: z.string().trim().min(1).max(256).optional(),
  user_message_id: z.string().trim().min(1).optional(),
  client_user_message_id: z.string().trim().min(1).optional(),
  parent_id: z.string().trim().min(1).nullable().optional(),
  user_message: z.unknown().optional(),
  display_message: z.string().optional(),
  selected_skill_ids: z.array(z.string().trim().min(1)).max(20).optional(),
  message: z.string().min(1)
});

const portalChatCancelSchema = z.object({
  session_id: z.string().trim().min(1),
  thread_id: z.string().trim().min(1).optional(),
  client_run_id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  user_message_id: z.string().trim().min(1).optional(),
  client_cancel_clicked_at: z.string().trim().min(1).optional(),
  client_cancel_source: z.string().trim().min(1).optional()
});

const portalChatSteerSchema = z.object({
  session_id: z.string().trim().min(1),
  thread_id: z.string().trim().min(1),
  client_run_id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  client_steer_id: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/),
  message: z.string().trim().min(1)
});

const DIRECT_CHAT_MESSAGE_MAX_CHARS = 20_000;
const DIRECT_CHAT_MESSAGE_TOO_LARGE_DETAIL =
  "This message is too large to send directly. Upload the content as a .txt or .log file, then send a short question. Direct messages are limited to 20,000 characters.";

class DirectChatMessageTooLargeError extends Error {
  readonly code = "DIRECT_CHAT_MESSAGE_TOO_LARGE";
  readonly reasonCode = "direct_chat_message_too_large";

  constructor(readonly characters: number) {
    super(DIRECT_CHAT_MESSAGE_TOO_LARGE_DETAIL);
    this.name = "DirectChatMessageTooLargeError";
  }
}

function isDirectChatMessageTooLargeError(error: unknown): error is DirectChatMessageTooLargeError {
  return error instanceof DirectChatMessageTooLargeError;
}

function assertDirectChatMessageWithinLimit(message: string): void {
  if (message.length <= DIRECT_CHAT_MESSAGE_MAX_CHARS) return;
  throw new DirectChatMessageTooLargeError(message.length);
}

const crestChatStreamSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  delegationToken: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional(),
  clientRunId: z.string().trim().min(1).max(80).optional(),
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

const crestChatCancelSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  delegationToken: z.string().trim().min(1),
  delegationRefreshToken: z.string().trim().min(1).optional(),
  delegationRefreshExpiresAt: z.string().trim().min(1).optional(),
  clientRunId: z.string().trim().min(1).max(80)
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
  codex_run_config: z.record(z.unknown()).optional(),
  folder_id: z.string().trim().min(1).nullable().optional(),
  start_session: z.boolean().optional()
});

const patchThreadSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  codex_run_config: z.record(z.unknown()).optional(),
  folder_id: z.string().trim().min(1).nullable().optional()
});

const updateThreadSkillsSchema = z.object({
  mode_id: z.string().trim().min(1),
  skill_ids: z.array(z.string().trim().min(1)).max(20)
});

const ensureThreadSessionSchema = z.object({
  model: z.string().optional(),
  reasoning_effort: reasoningEffortSchema.optional(),
  knowledge_set_ids: z.array(z.string()).optional(),
  selected_skill_ids: z.array(z.string().trim().min(1)).max(20).optional(),
  codex_run_config: z.record(z.unknown()).optional(),
  allow_mode_change: z.boolean().optional()
});

const appendMessageSchema = z.object({
  parent_id: z.string().nullable().optional(),
  message: z.unknown(),
  run_config: z.record(z.unknown()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
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
    path: z.string().optional(),
    preview: z.enum(["pdf", "auto", "text", "table", "diagram"]).optional(),
    offset: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    sheet: z.string().optional(),
    row_offset: z.string().optional(),
    row_limit: z.string().optional(),
    column_offset: z.string().optional(),
    column_limit: z.string().optional()
  })
  .refine((value) => Boolean(trimOrUndefined(value.relative_path) || trimOrUndefined(value.path)), {
    message: "Either relative_path or path is required"
  });

const attachmentContentQuerySchema = z.object({
  relative_path: z.string().trim().min(1)
});

const artifactResolveQuerySchema = z.object({
  path: z.string().trim().min(1)
});

const artifactContentQuerySchema = z.object({
  disposition: z.enum(["inline", "attachment"]).optional()
});

const artifactPathContentQuerySchema = artifactResolveQuerySchema.extend({
  disposition: z.enum(["inline", "attachment"]).optional(),
  preview: z.enum(["pdf", "auto", "text", "table", "diagram"]).optional(),
  offset: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  sheet: z.string().optional(),
  row_offset: z.string().optional(),
  row_limit: z.string().optional(),
  column_offset: z.string().optional(),
  column_limit: z.string().optional()
});

const inlineVisualizationContentQuerySchema = z.object({
  file: z.string().trim().min(1).max(255)
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
  envOverrides?: Record<string, string>;
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
  if (isDeploymentDrainError(error)) return 503;
  if (isDirectChatMessageTooLargeError(error)) return 413;
  if (isChatAccessDeniedError(error)) return 403;
  const detail = error instanceof Error ? error.message : "";
  return detail === QUOTA_ACCESS_DENIED_MESSAGE ? 403 : 400;
}

function payloadForSessionAccessError(error: unknown, fallbackDetail: string, locale?: string | null): {
  detail: string;
  code?: string;
  reason_code?: string;
} {
  if (isDeploymentDrainError(error)) {
    return {
      detail: error.message,
      code: DEPLOYMENT_DRAIN_ERROR_CODE,
      reason_code: "deployment_drain"
    };
  }
  const runtimeError = presentCodexRuntimeError(error, locale);
  if (runtimeError) {
    return {
      detail: runtimeError.message,
      code: runtimeError.code,
      reason_code: runtimeError.code.toLowerCase()
    };
  }
  const detail = error instanceof Error ? error.message : fallbackDetail;
  if (isDirectChatMessageTooLargeError(error)) {
    return {
      detail,
      code: error.code,
      reason_code: error.reasonCode
    };
  }
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

function runtimeHintsFromRunConfig(codexRunConfig?: Record<string, unknown>): string[] {
  const raw = codexRunConfig?.[RUNTIME_HINTS_RUN_CONFIG_KEY];
  if (!Array.isArray(raw)) return [];
  const hints: string[] = [];
  for (const item of raw) {
    const hint = trimOrUndefined(typeof item === "string" ? item : undefined);
    if (hint && !hints.includes(hint)) hints.push(hint);
  }
  return hints;
}

function withoutRuntimeHintsMetadata(
  codexRunConfig?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!codexRunConfig) return codexRunConfig;
  const next = { ...codexRunConfig };
  delete next[RUNTIME_HINTS_RUN_CONFIG_KEY];
  return next;
}

function withRuntimeHints(
  codexRunConfig: Record<string, unknown> | undefined,
  hints: string[]
): Record<string, unknown> | undefined {
  const next = withoutRuntimeHintsMetadata(codexRunConfig);
  const normalized = hints.map((hint) => trimOrUndefined(hint)).filter((hint): hint is string => Boolean(hint));
  if (normalized.length === 0) return next;
  return {
    ...(next ?? {}),
    [RUNTIME_HINTS_RUN_CONFIG_KEY]: Array.from(new Set(normalized))
  };
}

function withoutInternalRuntimeMetadata(
  codexRunConfig?: Record<string, unknown>
): Record<string, unknown> | undefined {
  return withoutRuntimeHintsMetadata(withoutRuntimeCapabilityMetadata(codexRunConfig));
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
  const next = withoutInternalRuntimeMetadata(codexRunConfig);
  if (!next) return next;
  const comparable = { ...next };
  delete comparable.enabledSkills;
  delete comparable[SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY];
  delete comparable.sandboxMode;
  delete comparable.approvalPolicy;
  delete comparable.networkAccessEnabled;
  delete comparable.webSearchMode;
  delete comparable.webSearchEnabled;
  delete comparable.additionalDirectories;
  return comparable;
}

function mergeRunConfigPreservingThreadSkills(
  persisted: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const persistedConfig = withoutInternalRuntimeMetadata(persisted);
  const incomingConfig = withoutInternalRuntimeMetadata(incoming);
  return mergeRunConfigPreservingSkillSelection(
    persistedConfig,
    incomingConfig,
    SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY
  );
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

function latestAssistantMessageAt(thread: ThreadRecord): string | undefined {
  let latestTimestamp = 0;
  let latestIso: string | undefined;
  for (const item of thread.messages) {
    if (storedMessageRole(item.message) !== "assistant") continue;
    const message = asRecord(item.message);
    const candidate =
      item.updatedAt ??
      item.createdAt ??
      (typeof message?.updated_at === "string" ? message.updated_at : undefined) ??
      (typeof message?.created_at === "string" ? message.created_at : undefined);
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (!Number.isFinite(timestamp) || timestamp <= latestTimestamp) continue;
    latestTimestamp = timestamp;
    latestIso = new Date(timestamp).toISOString();
  }
  return latestIso;
}

function hasUnreadAssistantCompletion(thread: ThreadRecord, lastReadAt?: string): boolean {
  if (!lastReadAt) return false;
  const latestAssistantAt = latestAssistantMessageAt(thread);
  if (!latestAssistantAt) return false;
  const readTimestamp = Date.parse(lastReadAt);
  const assistantTimestamp = Date.parse(latestAssistantAt);
  return Number.isFinite(readTimestamp) && Number.isFinite(assistantTimestamp) && assistantTimestamp > readTimestamp;
}

function threadOut(
  thread: ThreadRecord,
  options?: { isRunning?: boolean; hasUnreadCompletion?: boolean }
) {
  return {
    id: thread.id,
    organization_id: thread.organizationId ?? null,
    status: thread.status,
    title: thread.title,
    external_id: thread.externalId,
    model: thread.model,
    reasoning_effort: thread.reasoningEffort,
    mode_id: modeIdFromRunConfig(thread.codexRunConfig) ?? null,
    workspace_id: thread.userWorkspaceId ?? null,
    folder_id: thread.workspaceFolderId ?? null,
    enabled_skills: enabledSkillSelectionsFromRunConfig(thread.codexRunConfig).map((skill) => ({
      id: skill.id,
      name: skill.name,
      managed_skill_id: skill.managedSkillId ?? null
    })),
    enabled_skill_names: enabledSkillNamesFromRunConfig(thread.codexRunConfig),
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    ...(options?.isRunning !== undefined ? { is_running: options.isRunning } : {}),
    ...(options?.hasUnreadCompletion !== undefined
      ? { has_unread_completion: options.hasUnreadCompletion }
      : {})
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

function portalSteerEventOut(event: PortalSteerEventRecord) {
  return {
    id: event.id,
    thread_id: event.threadId,
    session_id: event.sessionId,
    source_user_message_id: event.sourceUserMessageId ?? null,
    turn_id: event.turnId ?? null,
    message: event.message,
    status: event.status,
    error_code: event.errorCode ?? null,
    resolved_at: event.resolvedAt ?? null,
    created_at: event.createdAt,
    updated_at: event.updatedAt
  };
}

function threadPublicShareOut(share: {
  id: string;
  token: string;
  title: string;
  selectedTurnCount: number;
  snapshot: unknown;
  expiresAt: string;
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
    expires_at: share.expiresAt,
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
  const [crestMcp, publishedSystemSettings] = await Promise.all([
    input.userId ? buildCrestMcpRuntimeConfigForUser(input.userId, input.workspace) : undefined,
    codexProviders.getPublishedSystemSettings()
  ]);
  const pythonRuntimeSettings =
    publishedSystemSettings?.payload.pythonRuntime ?? createDefaultSystemSettingsPayload().pythonRuntime;
  if (pythonRuntimeSettings.enabled && pythonRuntimeSettings.sessionTmpEnabled && input.workspace) {
    await ensureRuntimeWorkspaceTmp(input.workspace);
  }
  if (input.workspace) {
    await ensureToolRuntimeEnvDirs(input.workspace, appConfig.sharedCodexRuntime.runtimeRoot);
  }
  const toolEnv = buildToolRuntimeEnv({
    workspace: input.workspace
  });
  const pythonEnv = buildSharedPythonRuntimeEnv({
    settings: pythonRuntimeSettings,
    workspace: input.workspace
  });
  const runtimeHint = sharedPythonRuntimeHint(pythonRuntimeSettings);
  const runtimeHints = [
    ...(runtimeHint ? [runtimeHint] : []),
    ...(input.workspace && appConfig.sharedCodexRuntime.runtimeRoot ? [TOOL_RUNTIME_FRESHNESS_HINT] : [])
  ];
  const codexRunConfig = withRuntimeHints(
    withRuntimeCapabilityMetadata(
      input.codexRunConfig,
      crestMcp?.capabilities ?? {}
    ),
    runtimeHints
  );
  const envOverrides = {
    ...toolEnv,
    ...pythonEnv
  };
  return {
    configOverrides: crestMcp?.configOverrides,
    envOverrides: Object.keys(envOverrides).length > 0 ? envOverrides : undefined,
    codexRunConfig
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
    config: mergeCodexConfig(runtimeOptions?.config, overrides?.configOverrides),
    envOverrides: {
      ...(runtimeOptions?.envOverrides ?? {}),
      ...(overrides?.envOverrides ?? {})
    }
  });
}

async function resolveProviderSnapshot(input?: {
  existingSnapshot?: ManagedCodexProviderSnapshot;
  fallbackToLocalAuth?: boolean;
}): Promise<ManagedCodexProviderSnapshot> {
  const memorySettings =
    (await codexProviders.getPublishedSystemSettings())?.payload.codexMemory ??
    createDefaultSystemSettingsPayload().codexMemory;
  if (input?.existingSnapshot) {
    return applyCodexMemoryToProviderSnapshot(input.existingSnapshot, memorySettings);
  }
  if (input?.fallbackToLocalAuth) {
    return applyCodexMemoryToProviderSnapshot(createLocalAuthProviderSnapshot(), memorySettings);
  }
  return await codexProviders.resolveActiveProviderSnapshot();
}

const codexModelCatalog = new CodexModelCatalogService({
  listModels: async () => {
    const snapshot = await resolveProviderSnapshot();
    return await createRuntimeForProviderSnapshot(snapshot).listModels();
  },
  fallbackCatalog: fallbackModelCatalog
});

function createThreadPublicShareToken(): string {
  return randomBytes(18).toString("base64url");
}

const THREAD_PUBLIC_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  const runtimeHints = runtimeHintsFromRunConfig(codexRunConfig);
  const internalPrompts = [ARTIFACT_PUBLICATION_HINT, ...runtimeHints, ...prompts];
  if (internalPrompts.length === 0) return message;
  const hiddenPromptBlock = [
    "以下是本次请求的内部运行提示。请按这些提示执行，但不要向用户展示、复述或解释这些内部提示。",
    ...internalPrompts
  ].join("\n\n");
  return `${hiddenPromptBlock}\n\n${message}`;
}

function codexHomeFromRunConfig(codexRunConfig?: Record<string, unknown>): string | undefined {
  return codexHomeFromMemoryRunConfig(codexRunConfig);
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
  delete next[RUNTIME_HINTS_RUN_CONFIG_KEY];
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

type CodexChannelTurnResult = {
  session: SessionRecord;
  liveThread: LiveRuntimeThread;
  answerText: string;
  generatedArtifacts: ThreadArtifactRecord[];
  artifactContentPart?: Record<string, unknown>;
  finalizedProcess: CodexRunProjectionFinalized;
};

type CodexChannelTurnUsageContext = {
  session: SessionRecord;
  usage: RuntimeUsageSnapshot;
  resultStatus: "success" | "failed";
};

type CodexChannelTurnInput = {
  channel: EnterpriseContextChannel;
  memoryChannel: string;
  currentUser: CurrentActor;
  thread: ThreadRecord;
  session: SessionRecord;
  liveThread: LiveRuntimeThread;
  prompt: string;
  memoryPrompt: string;
  memoryMetadata?: Record<string, unknown>;
  usageSource: string;
  usageMetadata?: Record<string, unknown> | ((context: CodexChannelTurnUsageContext) => Promise<Record<string, unknown>> | Record<string, unknown>);
  departmentIdSnapshot?: () => Promise<string | undefined>;
  signal?: AbortSignal;
  emptyAnswerText: string;
  projectionOptions?: ConstructorParameters<typeof CodexRunProjection>[0];
  hasExternalContext?: (session: SessionRecord) => boolean;
  artifactScanStartedAt?: Date;
  logLabel: string;
  shouldSkipRetry?: () => boolean;
  onEvent?: (input: {
    event: RuntimeStreamEvent;
    projection: CodexRuntimeEventProjection;
    session: SessionRecord;
  }) => void;
  onArtifacts?: (input: {
    session: SessionRecord;
    artifacts: ThreadArtifactRecord[];
  }) => void;
  onArtifactError?: (error: unknown) => void;
  onDone?: (input: CodexChannelTurnResult) => Promise<void> | void;
  onRetry?: (input: { error: unknown; session: SessionRecord }) => Promise<void> | void;
  onTelemetryError?: (error: unknown) => void;
};

async function runCodexChannelTurn(input: CodexChannelTurnInput): Promise<CodexChannelTurnResult> {
  let currentSession = input.session;
  let liveThread = input.liveThread;
  let runProjection = new CodexRunProjection(input.projectionOptions);
  let runtimeFileChanges: RuntimeFileChange[] = [];
  let runtimeSideEffectStarted = false;
  let answerText = "";
  let generatedArtifacts: ThreadArtifactRecord[] = [];
  let artifactContentPart: Record<string, unknown> | undefined;
  let finalizedProcess: CodexRunProjectionFinalized = runProjection.finalize();

  const resetAttemptState = () => {
    runProjection = new CodexRunProjection(input.projectionOptions);
    runtimeFileChanges = [];
    runtimeSideEffectStarted = false;
    answerText = "";
    generatedArtifacts = [];
    artifactContentPart = undefined;
    finalizedProcess = runProjection.finalize();
  };

  const runOnce = async () => {
    const runtimeMessage = withSkillActivationPrompts(input.prompt, currentSession.codexRunConfig);
    const enterpriseRunContext = await enterpriseContext.resolveForRun({
      channel: input.channel,
      userId: input.currentUser.id,
      agentModeId: modeIdFromRunConfig(currentSession.codexRunConfig)
    });
    await codexExecution.streamFromRuntime({
      runtime,
      thread: liveThread,
      prompt: runtimeMessage,
      workspace: currentSession.workspace,
      enterpriseContext: enterpriseRunContext,
      signal: input.signal,
      memory: {
        channel: input.memoryChannel,
        prompt: input.memoryPrompt,
        codexHome: codexHomeFromRunConfig(currentSession.codexRunConfig),
        codexThreadId: currentSession.codexThreadId,
        sessionId: currentSession.sessionId,
        threadId: input.thread.id,
        organizationId: input.currentUser.organizationId,
        userId: input.currentUser.id,
        model: currentSession.model,
        hasExternalContext:
          input.hasExternalContext?.(currentSession) ?? codexRunConfigHasExternalContext(currentSession.codexRunConfig),
        metadata: input.memoryMetadata
      } satisfies CodexCompletionMemoryInput,
      onEvent(event) {
        const projection = runProjection.push(event);
        runtimeFileChanges.push(...extractRuntimeFileChanges(event));
        if (runtimeEventHasTurnSideEffect(event)) {
          runtimeSideEffectStarted = true;
        }
        const codexThreadId = extractCodexThreadIdFromRuntimeEvent(event);
        if (codexThreadId) {
          void persistSessionCodexThreadId(currentSession, codexThreadId).then((updated) => {
            currentSession = updated;
          });
        }
        input.onEvent?.({
          event,
          projection,
          session: currentSession
        });
      },
      async onDone(payload) {
        answerText = payload.answer.trim() || input.emptyAnswerText;
        try {
          generatedArtifacts = await registerGeneratedArtifactsForSession({
            currentUser: input.currentUser,
            session: currentSession,
            changes: runtimeFileChanges,
            answerText,
            changedAfter: input.artifactScanStartedAt
          });
          if (generatedArtifacts.length > 0) {
            input.onArtifacts?.({
              session: currentSession,
              artifacts: generatedArtifacts
            });
          }
        } catch (error) {
          console.warn(`${input.logLabel} artifact registration failed`, {
            threadId: input.thread.id,
            detail: error instanceof Error ? error.message : String(error)
          });
          input.onArtifactError?.(error);
        }
        finalizedProcess = runProjection.finalize({ finalAnswer: answerText });
        const artifactPolicy = await resolveArtifactPolicyForActor(input.currentUser);
        artifactContentPart = artifactContentPartForArtifacts(generatedArtifacts, artifactPolicy);
        await input.onDone?.({
          session: currentSession,
          liveThread,
          answerText,
          generatedArtifacts,
          artifactContentPart,
          finalizedProcess
        });
      },
      async recordUsage(usage, resultStatus = "success") {
        const codexThreadId = usage.codexThreadId ?? currentSession.codexThreadId;
        const extraMetadata =
          typeof input.usageMetadata === "function"
            ? await input.usageMetadata({ session: currentSession, usage, resultStatus })
            : input.usageMetadata ?? {};
        await usageRecorder.recordCodexUsage({
          organizationId: input.currentUser.organizationId,
          userId: input.currentUser.id,
          departmentIdSnapshot: input.departmentIdSnapshot ? await input.departmentIdSnapshot() : undefined,
          threadId: input.thread.id,
          sessionId: currentSession.sessionId,
          model: currentSession.model,
          featureType: "chat",
          usage,
          codexThreadId,
          resultStatus,
          metadata: {
            source: input.usageSource,
            ...extraMetadata
          }
        });
      },
      onTelemetryError(error) {
        if (input.onTelemetryError) {
          input.onTelemetryError(error);
          return;
        }
        console.warn(`${input.logLabel} usage telemetry failed`, {
          threadId: input.thread.id,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    });
  };

  try {
    await runOnce();
  } catch (error) {
    if (input.signal?.aborted || input.shouldSkipRetry?.()) {
      throw error;
    }
    const recoverable = isRecoverableCodexResumeError(error);
    console.warn(`${input.logLabel} runtime failed`, {
      threadId: input.thread.id,
      sessionId: currentSession.sessionId,
      codexThreadId: currentSession.codexThreadId,
      recoverable,
      runtimeSideEffectStarted,
      detail: runtimeErrorDetail(error)
    });
    if (!recoverable || runtimeSideEffectStarted) {
      throw error;
    }
    await input.onRetry?.({ error, session: currentSession });
    const replacement = await replaceUserAgentLiveRuntimeSession({
      currentUser: input.currentUser,
      session: currentSession,
      threadId: input.thread.id,
      failedCodexThreadId: currentSession.codexThreadId,
      error,
      logLabel: input.logLabel
    });
    currentSession = replacement.session;
    liveThread = replacement.liveThread;
    resetAttemptState();
    await runOnce();
  }

  return {
    session: currentSession,
    liveThread,
    answerText,
    generatedArtifacts,
    artifactContentPart,
    finalizedProcess
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
    const resumeCodexThreadId = await latestCodexThreadIdForAgentThread(activeThread.id);
    const session = await ensureThreadSession(input.currentUser, activeThread.id, {
      codex_run_config: activeThread.codexRunConfig,
      force_run_profile_controls: true,
      resume_codex_thread_id: resumeCodexThreadId
    });
    return { thread: (await threads.get(activeThread.id, input.currentUser.organizationId)) ?? activeThread, session };
  }

  const threadId = randomUUID().replace(/-/g, "");
  const allocated = await allocateUserAgentWorkspacePath({
    currentUser: input.currentUser
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

type CrestActiveChatRun = {
  userId: string;
  controller: AbortController;
  createdAt: number;
  session?: SessionRecord;
};

const crestActiveChatRuns = new Map<string, CrestActiveChatRun>();
const CREST_ACTIVE_CHAT_RUN_TTL_MS = 2 * 60 * 60_000;

function gcCrestActiveChatRuns(): void {
  const cutoff = Date.now() - CREST_ACTIVE_CHAT_RUN_TTL_MS;
  for (const [runId, entry] of crestActiveChatRuns.entries()) {
    if (entry.createdAt < cutoff) {
      crestActiveChatRuns.delete(runId);
    }
  }
}

function registerCrestActiveChatRun(input: {
  clientRunId?: string;
  userId: string;
  controller: AbortController;
}): (() => void) | undefined {
  const runId = trimOrUndefined(input.clientRunId);
  if (!runId) return undefined;
  gcCrestActiveChatRuns();
  const existing = crestActiveChatRuns.get(runId);
  if (existing && !existing.controller.signal.aborted) {
    throw new Error("Crest chat run is already active");
  }
  crestActiveChatRuns.set(runId, {
    userId: input.userId,
    controller: input.controller,
    createdAt: Date.now()
  });
  return () => {
    const current = crestActiveChatRuns.get(runId);
    if (current?.controller === input.controller) {
      crestActiveChatRuns.delete(runId);
    }
  };
}

function attachCrestActiveChatRunSession(input: {
  clientRunId?: string;
  userId: string;
  session: SessionRecord;
}): void {
  const runId = trimOrUndefined(input.clientRunId);
  if (!runId) return;
  const entry = crestActiveChatRuns.get(runId);
  if (!entry || entry.userId !== input.userId) return;
  entry.session = input.session;
}

async function cancelCrestActiveChatRun(clientRunId: string, userId: string): Promise<boolean> {
  gcCrestActiveChatRuns();
  const runId = trimOrUndefined(clientRunId);
  if (!runId) return false;
  const entry = crestActiveChatRuns.get(runId);
  if (!entry || entry.userId !== userId) return false;
  if (!entry.controller.signal.aborted) {
    entry.controller.abort(new Error("crest_user_cancelled"));
  }
  crestActiveChatRuns.delete(runId);
  await retireLiveRuntimeSession(entry.session, {
    status: "ended",
    reason: "crest explicit cancel request",
    logLabel: "crest chat"
  });
  return true;
}

function mergeAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? new Error("aborted"));
    }
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      continue;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const item of listeners) {
        item.signal.removeEventListener("abort", item.listener);
      }
    }
  };
}

type PortalActiveChatRun = {
  userId: string;
  organizationId: string;
  controller: AbortController;
  createdAt: number;
  runId: string;
  traceId?: string;
  session?: SessionRecord;
  threadId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  assistantMessageWritten?: boolean;
};

const portalActiveChatRuns = new Map<string, PortalActiveChatRun>();
const portalLatestRunIds = new Map<string, { runId: string; createdAt: number }>();
const portalLatestRunIdsByParent = new Map<string, { runId: string; createdAt: number }>();
const PORTAL_ACTIVE_CHAT_RUN_TTL_MS = 2 * 60 * 60_000;

function portalRunParentKey(threadId?: string, userMessageId?: string): string | undefined {
  const normalizedThreadId = trimOrUndefined(threadId);
  const normalizedUserMessageId = trimOrUndefined(userMessageId);
  return normalizedThreadId && normalizedUserMessageId
    ? `${normalizedThreadId}:${normalizedUserMessageId}`
    : undefined;
}

function gcPortalActiveChatRuns(): void {
  const cutoff = Date.now() - PORTAL_ACTIVE_CHAT_RUN_TTL_MS;
  for (const [sessionId, entry] of portalActiveChatRuns.entries()) {
    if (entry.createdAt < cutoff) {
      portalActiveChatRuns.delete(sessionId);
    }
  }
  for (const [sessionId, entry] of portalLatestRunIds.entries()) {
    if (entry.createdAt < cutoff) {
      portalLatestRunIds.delete(sessionId);
    }
  }
  for (const [parentKey, entry] of portalLatestRunIdsByParent.entries()) {
    if (entry.createdAt < cutoff) {
      portalLatestRunIdsByParent.delete(parentKey);
    }
  }
}

type ActiveThreadStatus = {
  thread_id: string;
  user_id: string;
  organization_id: string;
  channel: string;
  started_at: string;
  age_ms: number;
};

function activeThreadStatus(): ActiveThreadStatus[] {
  const now = Date.now();
  const byThreadId = new Map<string, ActiveThreadStatus>();
  const add = (input: {
    threadId?: string;
    userId?: string;
    organizationId?: string;
    channel?: string;
    startedAtMs: number;
  }) => {
    const threadId = trimOrUndefined(input.threadId);
    const userId = trimOrUndefined(input.userId);
    const organizationId = trimOrUndefined(input.organizationId);
    if (!threadId || !userId || !organizationId) return;
    const current = byThreadId.get(threadId);
    if (current && Date.parse(current.started_at) <= input.startedAtMs) return;
    byThreadId.set(threadId, {
      thread_id: threadId,
      user_id: userId,
      organization_id: organizationId,
      channel: trimOrUndefined(input.channel) ?? "unknown",
      started_at: new Date(input.startedAtMs).toISOString(),
      age_ms: Math.max(0, now - input.startedAtMs)
    });
  };

  for (const turn of activeRuntimeTurns.values()) {
    add({
      threadId: turn.threadId,
      userId: turn.userId,
      organizationId: turn.organizationId,
      channel: turn.channel,
      startedAtMs: turn.startedAtMs
    });
  }
  for (const run of portalActiveChatRuns.values()) {
    add({
      threadId: run.threadId,
      userId: run.userId,
      organizationId: run.organizationId,
      channel: "portal",
      startedAtMs: run.createdAt
    });
  }

  return Array.from(byThreadId.values()).sort((left, right) => left.started_at.localeCompare(right.started_at));
}

function logPortalStreamLifecycle(stage: string, details: Record<string, unknown>): void {
  try {
    console.info(
      JSON.stringify({
        event: "agent_studio_portal_stream_lifecycle",
        stage,
        at: new Date().toISOString(),
        ...details
      })
    );
  } catch (error) {
    console.info("agent_studio_portal_stream_lifecycle", {
      stage,
      logError: error instanceof Error ? error.message : String(error)
    });
  }
}

function registerPortalActiveChatRun(input: {
  sessionId: string;
  runId: string;
  userId: string;
  organizationId: string;
  controller: AbortController;
  threadId?: string;
  traceId?: string;
  assistantMessageId?: string;
}): () => void {
  const sessionId = trimOrUndefined(input.sessionId);
  if (!sessionId) return () => undefined;
  gcPortalActiveChatRuns();
  const existing = portalActiveChatRuns.get(sessionId);
  if (existing && existing.userId === input.userId && !existing.controller.signal.aborted) {
    existing.controller.abort(new Error("portal_run_superseded"));
  }
  portalActiveChatRuns.set(sessionId, {
    userId: input.userId,
    organizationId: input.organizationId,
    controller: input.controller,
    createdAt: Date.now(),
    runId: input.runId,
    traceId: trimOrUndefined(input.traceId),
    threadId: trimOrUndefined(input.threadId),
    assistantMessageId: trimOrUndefined(input.assistantMessageId)
  });
  portalLatestRunIds.set(sessionId, { runId: input.runId, createdAt: Date.now() });
  return () => {
    const current = portalActiveChatRuns.get(sessionId);
    if (current?.controller === input.controller) {
      portalActiveChatRuns.delete(sessionId);
    }
  };
}

function attachPortalActiveChatRun(input: {
  sessionId: string;
  userId: string;
  session?: SessionRecord;
  threadId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}): void {
  const sessionId = trimOrUndefined(input.sessionId);
  if (!sessionId) return;
  const entry = portalActiveChatRuns.get(sessionId);
  if (!entry || entry.userId !== input.userId) return;
  entry.session = input.session ?? entry.session;
  entry.threadId = trimOrUndefined(input.threadId) ?? entry.threadId;
  entry.userMessageId = trimOrUndefined(input.userMessageId) ?? entry.userMessageId;
  entry.assistantMessageId = trimOrUndefined(input.assistantMessageId) ?? entry.assistantMessageId;
  const parentKey = portalRunParentKey(entry.threadId, entry.userMessageId);
  if (parentKey) {
    portalLatestRunIdsByParent.set(parentKey, { runId: entry.runId, createdAt: Date.now() });
  }
}

function markPortalActiveChatRunAssistantWritten(input: {
  sessionId: string;
  userId: string;
}): void {
  const sessionId = trimOrUndefined(input.sessionId);
  if (!sessionId) return;
  const entry = portalActiveChatRuns.get(sessionId);
  if (!entry || entry.userId !== input.userId) return;
  entry.assistantMessageWritten = true;
}

function portalRunMayPersist(input: {
  sessionId: string;
  runId: string;
  threadId: string;
  userMessageId: string;
}): boolean {
  if (portalLatestRunIds.get(input.sessionId)?.runId !== input.runId) return false;
  const parentKey = portalRunParentKey(input.threadId, input.userMessageId);
  return Boolean(parentKey && portalLatestRunIdsByParent.get(parentKey)?.runId === input.runId);
}

type PortalCancelActiveChatRunResult = {
  cancelled: boolean;
  matchReason: string;
  activeRunFound: boolean;
  runtimeAbortRequested: boolean;
  streamTraceId?: string;
  runId?: string;
  sessionId?: string;
  threadId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
};

async function cancelPortalActiveChatRun(input: {
  sessionId: string;
  currentUser: CurrentActor;
  threadId?: string;
  runId?: string;
  userMessageId?: string;
  cancelTraceId?: string;
}): Promise<PortalCancelActiveChatRunResult> {
  gcPortalActiveChatRuns();
  const sessionId = trimOrUndefined(input.sessionId);
  if (!sessionId) {
    return {
      cancelled: false,
      matchReason: "missing_session_id",
      activeRunFound: false,
      runtimeAbortRequested: false
    };
  }
  const entry = portalActiveChatRuns.get(sessionId);
  const requestedRunId = trimOrUndefined(input.runId);
  if (entry && requestedRunId && entry.runId !== requestedRunId) {
    return {
      cancelled: false,
      matchReason: "run_mismatch",
      activeRunFound: true,
      runtimeAbortRequested: false,
      streamTraceId: entry.traceId,
      runId: entry.runId,
      sessionId,
      threadId: entry.threadId,
      userMessageId: entry.userMessageId,
      assistantMessageId: entry.assistantMessageId
    };
  }
  if (entry && entry.userId !== input.currentUser.id) {
    return {
      cancelled: false,
      matchReason: "active_run_user_mismatch",
      activeRunFound: true,
      runtimeAbortRequested: false,
      streamTraceId: entry.traceId,
      runId: entry.runId,
      sessionId,
      threadId: entry.threadId,
      userMessageId: entry.userMessageId,
      assistantMessageId: entry.assistantMessageId
    };
  }
  const session =
    entry?.session ??
    (await sessions.getOwned(sessionId, input.currentUser.id, input.currentUser.organizationId));
  if (!session) {
    return {
      cancelled: false,
      matchReason: entry ? "active_run_session_missing" : "no_active_run_or_session",
      activeRunFound: Boolean(entry),
      runtimeAbortRequested: false,
      streamTraceId: entry?.traceId,
      runId: entry?.runId,
      sessionId,
      threadId: entry?.threadId,
      userMessageId: entry?.userMessageId,
      assistantMessageId: entry?.assistantMessageId
    };
  }

  const requestedThreadId = trimOrUndefined(input.threadId);
  const threadId = requestedThreadId ?? trimOrUndefined(entry?.threadId) ?? trimOrUndefined(session.threadId);
  if (requestedThreadId && trimOrUndefined(session.threadId) && requestedThreadId !== trimOrUndefined(session.threadId)) {
    return {
      cancelled: false,
      matchReason: "thread_mismatch",
      activeRunFound: Boolean(entry),
      runtimeAbortRequested: false,
      streamTraceId: entry?.traceId,
      runId: entry?.runId,
      sessionId,
      threadId,
      userMessageId: trimOrUndefined(input.userMessageId) ?? trimOrUndefined(entry?.userMessageId),
      assistantMessageId: entry?.assistantMessageId
    };
  }
  const userMessageId = trimOrUndefined(input.userMessageId) ?? trimOrUndefined(entry?.userMessageId);

  const runtimeAbortRequested = Boolean(entry && !entry.controller.signal.aborted);
  if (entry && !entry.controller.signal.aborted) {
    logPortalStreamLifecycle("runtime_abort_requested", {
      cancel_trace_id: input.cancelTraceId,
      trace_id: entry.traceId,
      session_id: sessionId,
      thread_id: threadId,
      user_message_id: userMessageId,
      user_id: input.currentUser.id,
      organization_id: input.currentUser.organizationId
    });
    entry.controller.abort(new Error("portal_user_cancelled"));
  }
  portalActiveChatRuns.delete(sessionId);

  if (entry && threadId && userMessageId && entry.assistantMessageWritten !== true) {
    await appendPortalStoppedAssistant({
      threadId,
      userMessageId,
      sessionId,
      runId: entry.runId,
      assistantMessageId: entry.assistantMessageId,
      reason: "explicit_cancel"
    }).catch((error) => {
      console.warn("portal chat failed to append stopped assistant", {
        threadId,
        userMessageId,
        sessionId,
        detail: error instanceof Error ? error.message : String(error)
      });
    });
  }
  await retireLiveRuntimeSession(session, {
    status: "ended",
    reason: "portal explicit cancel request",
    logLabel: "portal chat"
  });
  return {
    cancelled: true,
    matchReason: runtimeAbortRequested ? "matched_active_run" : "matched_session_only",
    activeRunFound: Boolean(entry),
    runtimeAbortRequested,
    streamTraceId: entry?.traceId,
    runId: entry?.runId,
    sessionId,
    threadId,
    userMessageId,
    assistantMessageId: entry?.assistantMessageId
  };
}

const ACTION_CONNECTOR_CHANNEL = "action_connector";

type ActionConnectorRuntimeOptions = {
  agentModeId: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig: Record<string, unknown>;
  codexHome: string;
  providerSnapshot: ManagedCodexProviderSnapshot;
  configOverrides?: Record<string, unknown>;
  envOverrides: Record<string, string>;
  cliPath: string;
  runtimeConfigPath: string;
};

type ActionConnectorPreparedTurn = {
  connectorId: string;
  runId: string;
  conversationId: string;
  externalConversationKey: string;
  identity: ConnectorIdentity;
  runtimeOwner: CurrentActor;
  thread: ThreadRecord;
  session: SessionRecord;
  liveThread: LiveRuntimeThread;
  runtime: ActionConnectorRuntimeOptions;
  disposeBridge?: () => void;
};

function actionConnectorRuntimeOwnerId(connectorId: string): string {
  return `integration:${ACTION_CONNECTOR_CHANNEL}:${connectorId}`;
}

function isActionConnectorRuntimeOwner(session: SessionRecord, actor: CurrentActor): boolean {
  const actionConnector = asRecord(asRecord(session.codexRunConfig)?.actionConnector);
  const connectorId = trimOrUndefined(
    typeof actionConnector?.integrationInstanceId === "string"
      ? actionConnector.integrationInstanceId
      : undefined
  );
  return Boolean(connectorId && actor.id === actionConnectorRuntimeOwnerId(connectorId));
}

function actionConnectorRuntimeActor(input: ActionConnectorCodexRunnerInput): CurrentActor {
  return {
    id: actionConnectorRuntimeOwnerId(input.connector.id),
    userType: "service",
    role: "integration",
    organizationId: trimOrUndefined(input.connector.organizationId ?? undefined) ?? "",
    organizationType: "integration",
    membershipType: "service"
  };
}

function actionConnectorExternalUserKey(identity: ActionConnectorPreparedTurn["identity"]): string {
  const externalUserId =
    trimOrUndefined(identity?.externalUserId) ??
    trimOrUndefined(identity?.externalUnionId) ??
    trimOrUndefined(identity?.externalUserName);
  if (!externalUserId) {
    throw new Error("Action connector identity is missing external user id");
  }
  return externalUserId;
}

function actionConnectorIdentityFromRequest(input: ActionConnectorCodexRunnerInput) {
  const context = asRecord(input.request.context) ?? {};
  const externalIdentity = asRecord(context.externalIdentity) ?? {};
  const text = (key: string) => {
    const value = externalIdentity[key];
    return trimOrUndefined(typeof value === "string" ? value : undefined);
  };
  const externalUserId =
    text("externalUserId") ??
    text("userId") ??
    `delegated:${createHash("sha256").update(input.delegationHeaderValue).digest("hex").slice(0, 16)}`;
  return {
    externalUserId,
    externalUserName: text("externalUserName") ?? text("username") ?? text("name"),
    externalUnionId: text("externalUnionId"),
    organizationId: text("organizationId"),
    roles: Array.isArray(externalIdentity?.roles)
      ? externalIdentity.roles.filter((item): item is string => typeof item === "string")
      : undefined,
    scopes: Array.isArray(externalIdentity?.scopes)
      ? externalIdentity.scopes.filter((item): item is string => typeof item === "string")
      : undefined,
    metadata: asRecord(externalIdentity.metadata) ?? undefined
  };
}

function actionConnectorConversationKey(input: {
  connectorId: string;
  externalUserKey: string;
  conversationId: string;
}): string {
  return `${ACTION_CONNECTOR_CHANNEL}:${input.connectorId}:${input.externalUserKey}:${input.conversationId}`;
}

function actionConnectorThreadExternalId(externalConversationKey: string): string {
  return `${externalConversationKey}:thread`;
}

function actionConnectorThreadTitle(input: {
  displayName: string;
  message: string;
  context?: Record<string, unknown>;
}): string {
  const sourceTitle = asString(asRecord(input.context)?.title);
  const normalized = (sourceTitle || input.message).replace(/\s+/g, " ").trim();
  return `${input.displayName}: ${normalized ? normalized.slice(0, 64) : "Embedded agent conversation"}`;
}

function actionConnectorStoredMessage(
  role: "user" | "assistant",
  id: string,
  text: string,
  metadata: Record<string, unknown>,
  contentParts: Record<string, unknown>[] = []
) {
  return {
    id,
    role,
    content: [{ type: "text", text }, ...contentParts],
    createdAt: new Date().toISOString(),
    ...(role === "assistant" ? { status: { type: "completed" } } : {}),
    metadata: {
      channel: ACTION_CONNECTOR_CHANNEL,
      ...metadata
    }
  };
}

function actionConnectorCliSource(): string {
  return `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const command = process.argv[2];
const args = process.argv.slice(3);

function required(value, name) {
  if (!value || !String(value).trim()) throw new Error(name + " is required");
  return String(value).trim();
}

function runtimeConfig() {
  const filePath = required(process.env.ACTION_CONNECTOR_RUNTIME_CONFIG, "ACTION_CONNECTOR_RUNTIME_CONFIG");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseJsonArg(value, fallback) {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error("Invalid JSON argument: " + error.message);
  }
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (Object.prototype.hasOwnProperty.call(payload, "ret")) {
    if (payload.ret === 1) return payload.data;
    throw new Error(typeof payload.msg === "string" ? payload.msg : "Connector request failed");
  }
  return payload;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function connectorBridgeUrl(config) {
  const baseUrl = required(config.bridgeBaseUrl, "bridgeBaseUrl").replace(/\\/+$/, "");
  const connectorId = encodeURIComponent(required(config.connectorId, "connectorId"));
  return baseUrl + "/api/action-connectors/" + connectorId + "/tool-requests";
}

async function submitToolRequest(input, toolCallId) {
  const config = runtimeConfig();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Action-Connector-Bridge-Token": required(config.bridgeToken, "bridgeToken")
  };
  const response = await fetch(connectorBridgeUrl(config), {
    method: "POST",
    headers,
    body: JSON.stringify({
      runId: required(config.runId, "runId"),
      toolCallId: toolCallId || randomUUID(),
      input
    })
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : "External tool bridge failed with HTTP " + response.status;
    throw new Error(detail);
  }
  if (payload && typeof payload === "object" && payload.status === "error") {
    const error = payload.error && typeof payload.error === "object" ? payload.error : {};
    throw new Error(typeof error.message === "string" ? error.message : "External tool request failed");
  }
  const output = unwrap(payload && typeof payload === "object" && "output" in payload ? payload.output : payload);
  const files = payload && typeof payload === "object" && Array.isArray(payload.files) ? payload.files : [];
  console.log(JSON.stringify(files.length ? { output, files } : output, null, 2));
}

try {
  const config = runtimeConfig();
  if (command === "identity") {
    console.log(JSON.stringify(config.identity || {}, null, 2));
  } else if (command === "catalog" || command === "list" || command === "search") {
    const query = command === "catalog" || command === "search" ? args.join(" ").trim() : "";
    await submitToolRequest({
      operationId: "agent.catalog.search",
      method: "GET",
      path: "/api/v1/agent/catalog",
      query: query ? { q: query } : {}
    });
  } else if (command === "describe") {
    await submitToolRequest({
      operationId: "agent.catalog.describe",
      method: "GET",
      path: "/api/v1/agent/catalog/describe",
      query: { operationId: required(args[0], "operationId") }
    });
  } else if (command === "request") {
    const method = required(args[0], "method").toUpperCase();
    const requestPath = required(args[1], "path");
    const input = parseJsonArg(args[2], {});
    await submitToolRequest({
      operationId: typeof input.operationId === "string" ? input.operationId : undefined,
      method,
      path: requestPath,
      query: input.query && typeof input.query === "object" ? input.query : undefined,
      body: Object.prototype.hasOwnProperty.call(input, "body") ? input.body : undefined,
      reason: typeof input.reason === "string" ? input.reason : undefined
    });
  } else {
    throw new Error("Unknown command. Use identity, catalog, search, describe, or request.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
}

async function materializeActionConnectorRuntimeFiles(input: {
  runner: ActionConnectorCodexRunnerInput;
  workspace: string;
  runId: string;
  bridgeToken?: string;
  identity: unknown;
}): Promise<{ cliPath: string; runtimeConfigPath: string }> {
  const targetDir = path.join(input.workspace, ".agent-studio");
  const cliPath = path.join(targetDir, "action-connector-cli.mjs");
  const runtimeConfigPath = path.join(targetDir, "action-connector-runtime.json");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(cliPath, actionConnectorCliSource(), "utf8");
  await fs.chmod(cliPath, 0o755).catch(() => undefined);
  await fs.writeFile(
    runtimeConfigPath,
    JSON.stringify({
      bridgeBaseUrl: `http://127.0.0.1:${appConfig.port}`,
      connectorId: input.runner.connector.id,
      runId: input.runId,
      bridgeToken: input.bridgeToken,
      identity: input.identity,
      displayName: input.runner.config.displayName,
      policy: input.runner.config.policy
    }, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );
  await fs.chmod(runtimeConfigPath, 0o600).catch(() => undefined);
  return { cliPath, runtimeConfigPath };
}

async function resolveActionConnectorRuntimeOptions(
  input: ActionConnectorCodexRunnerInput,
  context: { runId: string; conversationId: string; bridgeToken?: string; identity: ConnectorIdentity }
): Promise<ActionConnectorRuntimeOptions> {
  const agentModeId = trimOrUndefined(input.config.agentModeId) ?? "default";
  const agentMode = await agentModes.get(agentModeId);
  if (!agentMode || trimOrUndefined(agentMode.status) !== "active") {
    throw new Error("Action connector agent mode does not exist or is disabled");
  }
  const runProfile = await runProfiles.get(agentMode.runProfileId);
  if (!runProfile || trimOrUndefined(runProfile.status) !== "active") {
    throw new Error("Action connector run profile does not exist or is disabled");
  }

  const selectedModel = normalizeModel(runProfile.defaultModel || appConfig.defaultModel);
  const selectedReasoningEffort = normalizeReasoningEffortForModel(
    selectedModel,
    (runProfile.defaultReasoningEffort as ReasoningEffort | undefined) || appConfig.defaultReasoningEffort
  );
  const workspaceRoot = await resolveEffectiveSessionWorkspaceRootPath();
  const integrationWorkspace = buildIntegrationAgentWorkspacePath({
    rootPath: workspaceRoot,
    provider: ACTION_CONNECTOR_CHANNEL,
    integrationInstanceId: input.connector.id,
    modeId: agentModeId
  });
  const conversationScope = createHash("sha256")
    .update(`${actionConnectorExternalUserKey(context.identity)}:${context.conversationId}`)
    .digest("hex")
    .slice(0, 24);
  const workspace = path.join(integrationWorkspace, "conversations", conversationScope);
  await fs.mkdir(workspace, { recursive: true });
  const workspaceAgentsMd = await applyWorkspaceAgentsMdForMode(agentModeId, workspace);
  const files = await materializeActionConnectorRuntimeFiles({
    runner: input,
    workspace,
    runId: context.runId,
    bridgeToken: context.bridgeToken,
    identity: context.identity
  });
  const enabledSkills = await resolveEnabledSkillsForBotMode(agentModeId);
  const actionConnectorRunConfig: Record<string, unknown> = {
    integrationInstanceId: input.connector.id,
    displayName: input.config.displayName,
    runtimeConfigPath: files.runtimeConfigPath
  };
  if (workspaceAgentsMd.fingerprint) {
    actionConnectorRunConfig.workspaceAgentsMdFingerprint = workspaceAgentsMd.fingerprint;
  }
  const baseCodexRunConfig = withRunConfigEnabledSkillSelection(
    {
      sandboxMode: runProfile.sandboxMode,
      approvalPolicy: runProfile.approvalPolicy,
      networkAccessEnabled: runProfile.networkAccessEnabled,
      webSearchMode: runProfile.webSearchMode,
      mode: agentModeId,
      actionConnector: actionConnectorRunConfig
    },
    enabledSkills
  );
  const materializedCodexHome = await materializeSharedIntegrationCodexHomeForRunConfig({
    provider: ACTION_CONNECTOR_CHANNEL,
    integrationInstanceId: input.connector.id,
    modeId: agentModeId,
    codexRunConfig: baseCodexRunConfig
  });
  const runtimeLaunch = await resolveRuntimeLaunchConfig({
    workspace,
    codexRunConfig: materializedCodexHome.codexRunConfig
  });

  return {
    agentModeId,
    model: selectedModel,
    reasoningEffort: selectedReasoningEffort,
    workspace,
    codexRunConfig: runtimeLaunch.codexRunConfig ?? {},
    codexHome: materializedCodexHome.codexHome,
    providerSnapshot: await resolveProviderSnapshot(),
    configOverrides: runtimeLaunch.configOverrides,
    envOverrides: {
      ...(runtimeLaunch.envOverrides ?? {}),
      ACTION_CONNECTOR_RUNTIME_CONFIG: files.runtimeConfigPath
    },
    ...files
  };
}

async function ensureActionConnectorThread(input: {
  connector: ActionConnectorCodexRunnerInput["connector"];
  config: ActionConnectorCodexRunnerInput["config"];
  identity: ActionConnectorPreparedTurn["identity"];
  conversationId: string;
  message: string;
  context: Record<string, unknown>;
  runtime: ActionConnectorRuntimeOptions;
}): Promise<{ thread: ThreadRecord; externalConversationKey: string }> {
  const externalUserKey = actionConnectorExternalUserKey(input.identity);
  const organizationId = trimOrUndefined(input.connector.organizationId ?? undefined);
  const externalConversationKey = actionConnectorConversationKey({
    connectorId: input.connector.id,
    externalUserKey,
    conversationId: input.conversationId
  });
  const externalId = actionConnectorThreadExternalId(externalConversationKey);
  const binding = await conversationRecords.getExternalConversationBinding(externalConversationKey);
  let thread = binding
    ? await conversationRecords.getThread(binding.threadId, organizationId)
    : await conversationRecords.getThreadByExternalId(externalId, organizationId);

  const codexRunConfig = withRunConfigCodexHome(input.runtime.codexRunConfig, input.runtime.codexHome);
  if (!thread) {
    thread = await conversationRecords.createThread({
      id: randomUUID().replace(/-/g, ""),
      organizationId,
      title: actionConnectorThreadTitle({
        displayName: input.config.displayName,
        message: input.message,
        context: input.context
      }),
      externalId,
      model: input.runtime.model,
      reasoningEffort: input.runtime.reasoningEffort,
      workspace: input.runtime.workspace,
      codexRunConfig
    });
    return { thread, externalConversationKey };
  }

  let next = thread.status === "archived"
    ? await conversationRecords.updateThread(thread.id, { status: "regular" })
    : thread;
  if (
    next.model !== input.runtime.model ||
    next.reasoningEffort !== input.runtime.reasoningEffort ||
    next.workspace !== input.runtime.workspace ||
    stableJson(next.codexRunConfig) !== stableJson(codexRunConfig)
  ) {
    next = await conversationRecords.updateThread(next.id, {
      model: input.runtime.model,
      reasoningEffort: input.runtime.reasoningEffort,
      workspace: input.runtime.workspace,
      codexRunConfig
    });
  }
  return { thread: next, externalConversationKey };
}

async function startActionConnectorRuntimeSession(input: {
  runner: ActionConnectorCodexRunnerInput;
  runtime: ActionConnectorRuntimeOptions;
  thread: ThreadRecord;
  runtimeOwner: CurrentActor;
  resumeCodexThreadId?: string;
}): Promise<{ session: SessionRecord; liveThread: LiveRuntimeThread }> {
  const sessionRuntime = createRuntimeForProviderSnapshot(input.runtime.providerSnapshot, {
    configOverrides: input.runtime.configOverrides,
    envOverrides: {
      ...input.runtime.envOverrides,
      CODEX_HOME: input.runtime.codexHome
    }
  });
  const resumeCodexThreadId = trimOrUndefined(input.resumeCodexThreadId);
  const started = resumeCodexThreadId
    ? await sessionRuntime.resumeThreadWithOptions({
        threadId: resumeCodexThreadId,
        model: input.runtime.model,
        reasoningEffort: input.runtime.reasoningEffort,
        workspace: input.runtime.workspace,
        codexRunConfig: stripInternalRunConfigMetadata(input.runtime.codexRunConfig)
      }).then((liveThread) => {
        const codexThreadId =
          typeof (liveThread as { id?: unknown })?.id === "string"
            ? trimOrUndefined((liveThread as { id?: string }).id)
            : undefined;
        return {
          liveThread,
          codexRunConfig: input.runtime.codexRunConfig,
          codexThreadId: codexThreadId ?? resumeCodexThreadId
        };
      })
    : await startLiveRuntimeSession({
        runtime: sessionRuntime,
        model: input.runtime.model,
        reasoningEffort: input.runtime.reasoningEffort,
        workspace: input.runtime.workspace,
        codexRunConfig: input.runtime.codexRunConfig
      });

  const session = await sessions.create({
    organizationId: trimOrUndefined(input.runner.connector.organizationId ?? undefined),
    threadId: input.thread.id,
    model: input.runtime.model,
    reasoningEffort: input.runtime.reasoningEffort,
    workspace: input.runtime.workspace,
    codexRunConfig: started.codexRunConfig,
    codexThreadId: started.codexThreadId,
    providerSnapshot: input.runtime.providerSnapshot
  });
  liveRuntimeThreads.set(session.sessionId, started.liveThread);
  return { session, liveThread: started.liveThread };
}

async function ensureActionConnectorRuntimeSession(input: {
  runner: ActionConnectorCodexRunnerInput;
  runtime: ActionConnectorRuntimeOptions;
  thread: ThreadRecord;
  runtimeOwner: CurrentActor;
}): Promise<{ session: SessionRecord; liveThread: LiveRuntimeThread }> {
  const active = input.thread.sessionId ? await sessions.get(input.thread.sessionId) : undefined;
  const liveThread = active
    ? liveRuntimeThreads.get(active.sessionId) || await restoreLiveRuntimeThread(active)
    : undefined;
  const changed =
    !active ||
    !liveThread ||
    active.model !== input.runtime.model ||
    active.reasoningEffort !== input.runtime.reasoningEffort ||
    active.workspace !== input.runtime.workspace ||
    stableJson(active.codexRunConfig) !== stableJson(input.runtime.codexRunConfig);

  if (!changed && active && liveThread) {
    return { session: active, liveThread };
  }

  const resumeCodexThreadId = await resolveCodexThreadContinuityWithHistory({
    threadCodexThreadId: input.thread.codexThreadId,
    activeSessionCodexThreadId: active?.codexThreadId,
    loadHistoricalSessionCodexThreadId: () => latestCodexThreadIdForAgentThread(input.thread.id)
  });

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }

  const started = await startActionConnectorRuntimeSession({
    runner: input.runner,
    runtime: input.runtime,
    thread: input.thread,
    runtimeOwner: input.runtimeOwner,
    resumeCodexThreadId
  });
  assertCodexThreadContinuity({
    expectedCodexThreadId: resumeCodexThreadId,
    observedCodexThreadId: started.session.codexThreadId,
    scope: "Action Connector conversation"
  });
  return {
    session: await persistSessionCodexThreadId(started.session, started.session.codexThreadId ?? ""),
    liveThread: started.liveThread
  };
}

async function prepareActionConnectorRuntimeTurn(input: ActionConnectorCodexRunnerInput): Promise<ActionConnectorPreparedTurn> {
  const runId = trimOrUndefined(input.request.clientRunId) ?? randomUUID();
  const conversationId = input.request.conversationId || randomUUID();
  const identity = actionConnectorIdentityFromRequest(input);
  actionConnectorExternalUserKey(identity);
  const runtimeOwner = actionConnectorRuntimeActor(input);
  const bridgeRegistration = input.bridge?.registerRun({
    connectorId: input.connector.id,
    runId,
    delegationHeaderValue: input.delegationHeaderValue,
    emit: input.emit
  });
  try {
    const runtime = await resolveActionConnectorRuntimeOptions(input, {
      runId,
      conversationId,
      bridgeToken: bridgeRegistration?.bridgeToken,
      identity
    });
    bridgeRegistration?.setFileMaterializer(async (files) => {
      const materialized = await actionConnectorAttachments.materialize({
        connectorId: input.connector.id,
        externalUserId: actionConnectorExternalUserKey(identity),
        conversationId,
        attachmentIds: files.map((file) => file.attachmentId),
        workspacePath: runtime.workspace
      });
      return materialized.map((file) => ({
        attachmentId: file.attachmentId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        createdAt: file.createdAt,
        relativePath: file.relativePath
      }));
    });
    const { thread, externalConversationKey } = await ensureActionConnectorThread({
      connector: input.connector,
      config: input.config,
      identity,
      conversationId,
      message: input.request.message,
      context: input.request.context,
      runtime
    });
    const { session, liveThread } = await ensureActionConnectorRuntimeSession({
      runner: input,
      runtime,
      thread,
      runtimeOwner
    });
    const externalUserId =
      trimOrUndefined(identity?.externalUserId) ??
      trimOrUndefined(identity?.externalUnionId);
    const externalUserName = trimOrUndefined(identity?.externalUserName);
    await conversationRecords.upsertExternalConversation({
      organizationId: trimOrUndefined(input.connector.organizationId ?? undefined) ?? null,
      integrationInstanceId: input.connector.id,
      threadId: thread.id,
      userId: null,
      channel: ACTION_CONNECTOR_CHANNEL,
      externalConversationKey,
      externalConversationId: conversationId,
      conversationType: "embedded_agent",
      agentModeId: runtime.agentModeId,
      externalUserId,
      externalUnionId: trimOrUndefined(identity?.externalUnionId),
      externalUserName,
      botName: input.config.displayName || input.connector.name,
      lastExternalMessageId: runId,
      lastMessageAt: new Date(),
      metadata: {
        integrationSlug: trimOrUndefined(input.connector.slug ?? undefined),
        sourcePath: asString(asRecord(input.request.context)?.path),
        sourceTitle: asString(asRecord(input.request.context)?.title),
        locale: input.request.locale,
        timezone: input.request.timezone,
        runtimeOwnerId: runtimeOwner.id,
        externalIdentity: identity ?? null
      }
    });
    return {
      connectorId: input.connector.id,
      runId,
      conversationId,
      externalConversationKey,
      identity,
      runtimeOwner,
      thread,
      session,
      liveThread,
      runtime,
      disposeBridge: bridgeRegistration?.dispose
    };
  } catch (error) {
    bridgeRegistration?.dispose();
    throw error;
  }
}

function actionConnectorRuntimePrompt(input: ActionConnectorCodexRunnerInput & {
  prepared: ActionConnectorPreparedTurn;
  attachments: MaterializedActionConnectorAttachment[];
}): string {
  const base = buildActionConnectorRuntimePrompt({
    config: input.config,
    request: input.request,
    conversationId: input.prepared.conversationId,
    runId: input.prepared.runId,
    cliPath: input.prepared.runtime.cliPath
  });
  if (!input.attachments.length) return base;
  return [
    base,
    "",
    "Attached files",
    "The external user attached the following files. Read them from the exact workspace-relative paths when relevant. Do not search the filesystem for alternate copies.",
    ...input.attachments.map((file) =>
      `- ${file.filename} | ${file.mimeType} | ${file.sizeBytes} bytes | ${file.relativePath}`
    )
  ].join("\n");
}

async function materializeActionConnectorTurnAttachments(input: {
  request: ActionConnectorCodexRunnerInput["request"];
  prepared: ActionConnectorPreparedTurn;
}): Promise<MaterializedActionConnectorAttachment[]> {
  const attachmentIds = (input.request.attachments ?? []).map((item) => item.attachmentId);
  if (!attachmentIds.length) return [];
  return await actionConnectorAttachments.materialize({
    connectorId: input.prepared.connectorId,
    externalUserId: actionConnectorExternalUserKey(input.prepared.identity),
    conversationId: input.prepared.conversationId,
    attachmentIds,
    workspacePath: input.prepared.runtime.workspace
  });
}

type ActionConnectorActiveRun = {
  connectorId: string;
  externalUserId: string;
  controller: AbortController;
  session: SessionRecord;
};

const actionConnectorActiveRuns = new Map<string, ActionConnectorActiveRun>();

async function cancelActionConnectorRun(input: { connectorId: string; externalUserId: string; runId: string }): Promise<boolean> {
  const entry = actionConnectorActiveRuns.get(input.runId);
  if (!entry || entry.connectorId !== input.connectorId || entry.externalUserId !== input.externalUserId) return false;
  if (!entry.controller.signal.aborted) entry.controller.abort(new Error("action_connector_user_cancelled"));
  actionConnectorActiveRuns.delete(input.runId);
  await retireLiveRuntimeSession(entry.session, {
    status: "ended",
    reason: "action connector explicit cancel request",
    logLabel: "action connector chat"
  });
  return true;
}

async function resolveActionConnectorConversation(input: {
  connectorId: string;
  externalUserId: string;
  conversationId: string;
}): Promise<{ thread: ThreadRecord; externalConversationKey: string }> {
  const externalConversationKey = actionConnectorConversationKey({
    connectorId: input.connectorId,
    externalUserKey: input.externalUserId,
    conversationId: input.conversationId
  });
  const binding = await conversationRecords.getExternalConversationBinding(externalConversationKey);
  if (!binding || binding.integrationInstanceId !== input.connectorId) {
    throw new Error("Action connector conversation does not exist");
  }
  const thread = await conversationRecords.getThread(binding.threadId, binding.organizationId);
  if (!thread) throw new Error("Action connector thread does not exist");
  return { thread, externalConversationKey };
}

function actionConnectorMessageText(message: Record<string, unknown>): string {
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .map((part) => asRecord(part))
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => String(part?.text ?? ""))
    .join("");
}

function actionConnectorMessageList(value: unknown, key: "attachments" | "artifacts"): Record<string, unknown>[] {
  const metadata = asRecord(asRecord(value)?.metadata);
  const items = metadata && Array.isArray(metadata[key]) ? metadata[key] : [];
  return items.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
}

async function getActionConnectorConversationMessages(input: {
  connectorId: string;
  externalUserId: string;
  conversationId: string;
}): Promise<Record<string, unknown>> {
  const { thread } = await resolveActionConnectorConversation(input);
  const repository = await conversationRecords.getMessageRepository(thread.id);
  const messages = repository.messages.flatMap((item) => {
    const message = asRecord(item.message);
    const role = message?.role === "user" || message?.role === "assistant" ? message.role : undefined;
    if (!message || !role) return [];
    return [{
      id: asString(message.id) || `${role}-${item.createdAt ?? thread.createdAt}`,
      role,
      text: actionConnectorMessageText(message),
      createdAt: asString(message.createdAt) || item.createdAt || thread.createdAt,
      status: role === "assistant" ? "completed" : undefined,
      attachments: actionConnectorMessageList(message, "attachments"),
      artifacts: actionConnectorMessageList(message, "artifacts")
    }];
  });
  return { conversationId: input.conversationId, messages };
}

async function sendActionConnectorArtifact(input: {
  connectorId: string;
  externalUserId: string;
  conversationId: string;
  artifactId: string;
  disposition: "inline" | "attachment";
  request: Request;
  response: Response;
}): Promise<void> {
  const { thread } = await resolveActionConnectorConversation(input);
  const currentUser: CurrentActor = {
    id: actionConnectorRuntimeOwnerId(input.connectorId),
    userType: "service",
    role: "integration",
    organizationId: trimOrUndefined(thread.organizationId) ?? "",
    organizationType: "integration",
    membershipType: "service"
  };
  await sendThreadArtifactContent({
    currentUser,
    threadId: thread.id,
    artifactId: input.artifactId,
    disposition: input.disposition,
    authorizedThread: thread,
    req: input.request,
    res: input.response
  });
}

function emitActionConnectorRuntimeEvent(
  emit: ActionConnectorCodexRunnerInput["emit"],
  projection: CodexRuntimeEventProjection
): void {
  for (const event of projectActionConnectorRuntimeEvents(projection)) {
    emit(event);
  }
}

async function runActionConnectorCodexChat(input: ActionConnectorCodexRunnerInput): Promise<void> {
  const prepared = await prepareActionConnectorRuntimeTurn(input);
  const startedAt = Date.now();
  const explicitCancel = new AbortController();
  const mergedAbort = mergeAbortSignals([...(input.signal ? [input.signal] : []), explicitCancel.signal]);
  const attachments = await materializeActionConnectorTurnAttachments({ request: input.request, prepared });
  const activeRun: ActionConnectorActiveRun = {
    connectorId: input.connector.id,
    externalUserId: actionConnectorExternalUserKey(prepared.identity),
    controller: explicitCancel,
    session: prepared.session
  };
  actionConnectorActiveRuns.set(prepared.runId, activeRun);
  try {
  input.emit({
    type: "start",
    runId: prepared.runId,
    conversationId: prepared.conversationId
  });

  const externalUserId =
    trimOrUndefined(prepared.identity?.externalUserId) ??
    trimOrUndefined(prepared.identity?.externalUnionId);
  const externalUserName = trimOrUndefined(prepared.identity?.externalUserName);
  const userMessageId = `${ACTION_CONNECTOR_CHANNEL}-user-${prepared.runId}`;
  await conversationRecords.appendMessage({
    threadId: prepared.thread.id,
    parentId: prepared.thread.headId ?? null,
    message: actionConnectorStoredMessage("user", userMessageId, input.request.message, {
      integrationInstanceId: input.connector.id,
      externalConversationKey: prepared.externalConversationKey,
      conversationId: prepared.conversationId,
      runId: prepared.runId,
      context: input.request.context,
      attachments: attachments.map((file) => ({
        attachmentId: file.attachmentId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256
      })),
      externalUserId,
      externalUserName
    }),
    runConfig: {
      channel: ACTION_CONNECTOR_CHANNEL,
      integrationInstanceId: input.connector.id,
      externalConversationKey: prepared.externalConversationKey,
      runId: prepared.runId
    }
  });

  await runCodexChannelTurn({
    channel: "openai_compatible_api",
    memoryChannel: ACTION_CONNECTOR_CHANNEL,
    currentUser: prepared.runtimeOwner,
    thread: prepared.thread,
    session: prepared.session,
    liveThread: prepared.liveThread,
    prompt: actionConnectorRuntimePrompt({ ...input, prepared, attachments }),
    memoryPrompt: input.request.message,
    memoryMetadata: {
      channel: ACTION_CONNECTOR_CHANNEL,
      integrationInstanceId: input.connector.id,
      externalConversationKey: prepared.externalConversationKey,
      conversationId: prepared.conversationId
    },
    usageSource: "action_connector_chat_stream",
    usageMetadata: {
      channel: ACTION_CONNECTOR_CHANNEL,
      integrationInstanceId: input.connector.id,
      externalConversationKey: prepared.externalConversationKey,
      conversationId: prepared.conversationId,
      runId: prepared.runId,
      externalUserId,
      externalUserName
    },
    signal: mergedAbort.signal,
    emptyAnswerText: input.request.locale.toLowerCase().startsWith("zh") ? "没有生成回答。" : "No answer was generated.",
    artifactScanStartedAt: new Date(startedAt - 2000),
    logLabel: "action connector chat",
    shouldSkipRetry: () => true,
    hasExternalContext: () => true,
    onEvent({ projection }) {
      emitActionConnectorRuntimeEvent(input.emit, projection);
    },
    onArtifacts({ artifacts: generatedArtifacts }) {
      input.emit({
        type: "artifact",
        files: generatedArtifacts.map((artifact) => ({
          artifactId: artifact.id,
          filename: artifact.displayName,
          mimeType: artifact.mimeType ?? null,
          sizeBytes: artifact.sizeBytes ?? null,
          previewStatus: artifact.previewStatus,
          downloadStatus: artifact.downloadStatus,
          blockedReason: artifact.blockedReason ?? null
        }))
      });
    },
    async onDone({ answerText, session: sessionForRun, generatedArtifacts, artifactContentPart, finalizedProcess }) {
      for (const event of actionConnectorCommentaryEntriesToEvents(finalizedProcess.liveCommentaryEntries)) {
        input.emit(event);
      }
      await conversationRecords.appendMessage({
        threadId: prepared.thread.id,
        parentId: userMessageId,
        message: actionConnectorStoredMessage(
          "assistant",
          `${ACTION_CONNECTOR_CHANNEL}-assistant-${prepared.runId}`,
          answerText,
          {
            integrationInstanceId: input.connector.id,
            externalConversationKey: prepared.externalConversationKey,
            conversationId: prepared.conversationId,
            runId: prepared.runId,
            sessionId: sessionForRun.sessionId,
            runtimeOwnerId: prepared.runtimeOwner.id,
            artifacts: generatedArtifacts.map((artifact) => ({
              artifactId: artifact.id,
              filename: artifact.displayName,
              mimeType: artifact.mimeType ?? null,
              sizeBytes: artifact.sizeBytes ?? null,
              previewStatus: artifact.previewStatus,
              downloadStatus: artifact.downloadStatus,
              blockedReason: artifact.blockedReason ?? null
            }))
          },
          artifactContentPart ? [...finalizedProcess.contentParts, artifactContentPart] : finalizedProcess.contentParts
        ),
        runConfig: {
          channel: ACTION_CONNECTOR_CHANNEL,
          integrationInstanceId: input.connector.id,
          externalConversationKey: prepared.externalConversationKey,
          runId: prepared.runId,
          sessionId: sessionForRun.sessionId
        }
      });
      await conversationRecords.touchExternalConversation({
        externalConversationKey: prepared.externalConversationKey,
        lastExternalMessageId: prepared.runId,
        lastMessageAt: new Date(),
        metadata: {
          integrationSlug: trimOrUndefined(input.connector.slug ?? undefined),
          lastRunId: prepared.runId,
          lastSessionId: sessionForRun.sessionId,
          runtimeOwnerId: prepared.runtimeOwner.id,
          externalIdentity: prepared.identity ?? null
        }
      });
      input.emit({ type: "done", durationMs: Date.now() - startedAt });
    },
    onTelemetryError(error) {
      console.warn("action connector chat usage telemetry failed", {
        connectorId: input.connector.id,
        conversationId: prepared.conversationId,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
  } finally {
    const current = actionConnectorActiveRuns.get(prepared.runId);
    if (current === activeRun) actionConnectorActiveRuns.delete(prepared.runId);
    mergedAbort.dispose();
    prepared.disposeBridge?.();
  }
}

async function handleCrestChatStream(req: Request, res: Response): Promise<void> {
  initSSE(res);
  const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);
  const streamAbort = createSseAbortLifecycle(req, res);
  const explicitCancel = new AbortController();
  const runAbort = mergeAbortSignals([explicitCancel.signal]);
  let unregisterRun: (() => void) | undefined;
  let crestInput: z.infer<typeof crestChatStreamSchema> | undefined;
  let crestThreadId: string | undefined;
  let crestUserMessageId: string | undefined;
  let crestCurrentActor: CurrentActor | undefined;
  let crestAssistantMessageWritten = false;
  let crestRuntimeSession: SessionRecord | undefined;
  let crestRuntimeFailure: string | undefined;
  try {
    const input = crestChatStreamSchema.parse(req.body || {});
    crestInput = input;
    const drainReason = await getDeploymentDrainReason();
    if (drainReason) {
      sendSSE(res, "error", { message: drainReason });
      return;
    }

    const currentUser = await resolveCrestActor(input);
    crestCurrentActor = currentUser;
    unregisterRun = registerCrestActiveChatRun({
      clientRunId: input.clientRunId,
      userId: currentUser.id,
      controller: explicitCancel
    });
    const { thread, session } = await ensureCrestChatThread({
      currentUser,
      conversationId: input.conversationId,
      message: input.message,
      context: input.context
    });
    crestThreadId = thread.id;
    let currentSession = session;
    crestRuntimeSession = currentSession;
    attachCrestActiveChatRunSession({
      clientRunId: input.clientRunId,
      userId: currentUser.id,
      session: currentSession
    });
    let liveThread = liveRuntimeThreads.get(currentSession.sessionId) || await restoreLiveRuntimeThread(currentSession);
    if (!liveThread) {
      const resumeCodexThreadId = await latestCodexThreadIdForAgentThread(thread.id);
      currentSession = await ensureThreadSession(currentUser, thread.id, {
        codex_run_config: thread.codexRunConfig,
        force_run_profile_controls: true,
        resume_codex_thread_id: resumeCodexThreadId
      });
      crestRuntimeSession = currentSession;
      attachCrestActiveChatRunSession({
        clientRunId: input.clientRunId,
        userId: currentUser.id,
        session: currentSession
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
      workspacePath: currentSession.workspace,
      threadId: thread.id
    });

    const parentForUserMessage = await closeDanglingCrestUserHead({
      threadId: thread.id,
      headId: thread.headId ?? null,
      conversationId: input.conversationId,
      context: input.context ?? {}
    });

    const userMessageId = `crest-user-${randomUUID().replace(/-/g, "")}`;
    crestUserMessageId = userMessageId;
    await conversationRecords.appendMessage({
      threadId: thread.id,
      parentId: parentForUserMessage,
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

    const turnResult = await runCodexChannelTurn({
      channel: "crest",
      memoryChannel: "crest",
      currentUser,
      thread,
      session: currentSession,
      liveThread,
      prompt: crestRuntimePrompt(input, preparedAttachments),
      memoryPrompt: input.message,
      memoryMetadata: {
        conversationId: input.conversationId
      },
      usageSource: "crest_chat_stream",
      signal: runAbort.signal,
      emptyAnswerText: "(无输出)",
      artifactScanStartedAt: new Date(Date.now() - 2000),
      logLabel: "crest chat",
      shouldSkipRetry: () => explicitCancel.signal.aborted,
      hasExternalContext: (sessionForRun) =>
        preparedAttachments.length > 0 || codexRunConfigHasExternalContext(sessionForRun.codexRunConfig),
      onEvent({ projection }) {
        emitCrestRuntimeEvent(res, projection, { emitReasoningThought: false });
        emitCrestCommentaryThoughts(res, projection.liveCommentaryEntries);
      },
      onArtifacts({ session: sessionForRun, artifacts }) {
        sendSSE(res, "artifacts", {
          threadId: thread.id,
          sessionId: sessionForRun.sessionId,
          artifacts: artifacts.map(artifactOut)
        });
      },
      onArtifactError() {
        sendSSE(res, "artifact_warning", {
          detail: "Generated files could not be registered for Crest download"
        });
      },
      async onDone({ answerText, session: sessionForRun, generatedArtifacts, artifactContentPart, finalizedProcess }) {
        if (explicitCancel.signal.aborted) return;
        emitCrestCommentaryThoughts(res, finalizedProcess.liveCommentaryEntries);
        const processContentParts = finalizedProcess.contentParts;
        await conversationRecords.appendMessage({
          threadId: thread.id,
          parentId: userMessageId,
          message: crestStoredMessage(
            "assistant",
            `crest-assistant-${randomUUID().replace(/-/g, "")}`,
            answerText,
            {
              conversationId: input.conversationId,
              sessionId: sessionForRun.sessionId,
              artifacts: generatedArtifacts.map(artifactOut)
            },
            [],
            artifactContentPart ? [...processContentParts, artifactContentPart] : processContentParts
          ),
          runConfig: { channel: "crest", conversationId: input.conversationId }
        });
        crestAssistantMessageWritten = true;
        streamAbort.markSettled();
        sendSSE(res, "done", {
          output: answerText,
          durationMs: 0,
          threadId: thread.id,
          sessionId: sessionForRun.sessionId
        });
      },
      onRetry() {
        sendSSE(res, "thought", {
          text: "检测到底层运行时会话已过期，正在重建运行环境并重试本轮请求。"
        });
      },
      onTelemetryError(error) {
        console.warn("crest chat usage telemetry failed", {
          threadId: thread.id,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    });
    crestRuntimeSession = turnResult.session;

  } catch (error) {
    if (crestRuntimeSession && !explicitCancel.signal.aborted) {
      crestRuntimeFailure = error instanceof Error ? error.message : String(error);
    }
    const runtimeError = presentCodexRuntimeError(error, req.header("accept-language"));
    const errorSent =
      !streamAbort.disconnected &&
      !explicitCancel.signal.aborted &&
      !res.writableEnded &&
      sendSSE(
        res,
        "error",
        runtimeError ?? { message: error instanceof Error ? error.message : "Crest chat stream failed" }
      );
    if (errorSent && crestRuntimeFailure) {
      reportVisibleConversationFailure({
        source: "crest_chat_stream",
        channel: "crest",
        organizationId: crestCurrentActor?.organizationId,
        userId: crestCurrentActor?.id,
        threadId: crestThreadId,
        sessionId: crestRuntimeSession?.sessionId,
        userMessageId: crestUserMessageId,
        externalConversationId: crestInput?.conversationId,
        audience: recoveryAudienceForActor(crestCurrentActor),
        severity: "high",
        reasonCode: "runtime_error",
        title: "CREST 回答失败",
        questionPreview: crestInput?.message,
        failureDetail: crestRuntimeFailure,
        metadata: {
          clientRunId: crestInput?.clientRunId,
          conversationId: crestInput?.conversationId,
          assistantMessageWritten: crestAssistantMessageWritten
        }
      });
    }
  } finally {
    if (explicitCancel.signal.aborted && crestThreadId && crestUserMessageId && !crestAssistantMessageWritten && crestInput) {
      await appendCrestStoppedAssistant({
        threadId: crestThreadId,
        parentId: crestUserMessageId,
        conversationId: crestInput.conversationId,
        context: crestInput.context ?? {},
        reason: "explicit_cancel"
      }).catch((error) => {
        console.warn("crest chat failed to append stopped assistant", {
          threadId: crestThreadId,
          userMessageId: crestUserMessageId,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
    }
    if (explicitCancel.signal.aborted) {
      await retireLiveRuntimeSession(crestRuntimeSession, {
        status: "ended",
        reason: "crest explicit cancel",
        logLabel: "crest chat"
      });
    } else if (crestRuntimeFailure) {
      await retireLiveRuntimeSession(crestRuntimeSession, {
        status: "failed",
        reason: `crest runtime failure: ${crestRuntimeFailure}`,
        logLabel: "crest chat"
      });
    }
    unregisterRun?.();
    runAbort.dispose();
    streamAbort.markSettled();
    streamAbort.dispose();
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

async function handleCrestChatCancel(req: Request, res: Response): Promise<void> {
  try {
    const input = crestChatCancelSchema.parse(req.body || {});
    const currentUser = await resolveCrestActor(input);
    const cancelled = await cancelCrestActiveChatRun(input.clientRunId, currentUser.id);
    res.json({ cancelled });
  } catch (error) {
    res.status(400).json({
      detail: error instanceof Error ? error.message : "Crest chat cancel failed"
    });
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
      req,
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

async function closeDanglingCrestUserHead(input: {
  threadId: string;
  headId?: string | null;
  conversationId: string;
  context: Record<string, unknown>;
}): Promise<string | null> {
  const headId = trimOrUndefined(input.headId ?? undefined);
  if (!headId) return null;
  try {
    const repository = await conversationRecords.getMessageRepository(input.threadId);
    const headMessage = repository.messages.find((item) => storedMessageId(item.message) === headId);
    if (!headMessage || storedMessageRole(headMessage.message) !== "user") return headId;
    const message = asRecord(headMessage.message);
    const metadata = asRecord(message?.metadata);
    if (metadata?.channel !== "crest") return headId;
    const stoppedId = await appendCrestStoppedAssistant({
      threadId: input.threadId,
      parentId: headId,
      conversationId: input.conversationId,
      context: input.context,
      reason: "dangling_user_head"
    });
    return stoppedId;
  } catch (error) {
    console.warn("crest chat failed to close dangling user head", {
      threadId: input.threadId,
      headId,
      detail: error instanceof Error ? error.message : String(error)
    });
    return headId;
  }
}

async function appendCrestStoppedAssistant(input: {
  threadId: string;
  parentId: string;
  conversationId: string;
  context: Record<string, unknown>;
  reason: "explicit_cancel" | "dangling_user_head";
}): Promise<string> {
  const assistantId = `crest-assistant-stopped-${randomUUID().replace(/-/g, "")}`;
  await conversationRecords.appendMessage({
    threadId: input.threadId,
    parentId: input.parentId,
    message: crestStoredMessage("assistant", assistantId, "已停止回答。", {
      conversationId: input.conversationId,
      context: input.context,
      stopped: true,
      stopReason: input.reason
    }),
    runConfig: { channel: "crest", conversationId: input.conversationId }
  });
  return assistantId;
}

function crestStoredMessage(
  role: "user" | "assistant",
  id: string,
  text: string,
  metadata: Record<string, unknown>,
  attachments: PreparedCrestAttachment[] = [],
  contentParts: Record<string, unknown>[] = []
) {
  const stopped = role === "assistant" && metadata.stopped === true;
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
    content: [{ type: "text", text }, ...contentParts],
    ...(storedAttachments.length > 0 ? { attachments: storedAttachments } : {}),
    createdAt: new Date().toISOString(),
    ...(role === "assistant"
      ? { status: stopped ? { type: "incomplete", reason: "cancelled" } : { type: "completed" } }
      : {}),
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
  threadId: string;
}): Promise<PreparedCrestAttachment[]> {
  const attachments = input.input.attachments ?? [];
  if (attachments.length === 0) return [];
  const config = await assertCrestClient(input.input);
  const uploadDir = getThreadWorkspaceUploadDir(input.workspacePath, input.threadId);
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
  projection: CodexRuntimeEventProjection,
  options: { emitReasoningThought?: boolean } = {}
): void {
  if (projection.answerDelta) {
    sendSSE(res, "delta", { text: projection.answerDelta });
    return;
  }
  if (projection.commentaryDelta) {
    sendSSE(res, "thought", projection.commentaryDelta);
    return;
  }
  if (projection.reasoningText && options.emitReasoningThought !== false) {
    sendSSE(res, "thought", { text: truncateText(projection.reasoningText, 1200) });
    return;
  }
  if (projection.toolCall) {
    sendSSE(res, "tool_call", { name: projection.toolCall.name, args: projection.toolCall.args });
    const actionPayload = parseCrestActionPayload(projection.toolCall.result);
    if (actionPayload?.requiresConfirmation === true) {
      sendSSE(res, "action_preview", { name: projection.toolCall.name, preview: actionPayload });
    } else {
      sendSSE(res, "tool_result", {
        name: projection.toolCall.name,
        output: stringifyToolResult(projection.toolCall.result)
      });
    }
    const uiIntent = asRecord(actionPayload?.uiIntent);
    if (uiIntent) sendSSE(res, "ui_intent", uiIntent);
  }
}

function emitCrestCommentaryThoughts(res: Response, entries: CodexCommentaryEntry[] | undefined): void {
  for (const entry of entries ?? []) {
    const payload = crestCommentaryEntryToThoughtPayload(entry);
    if (payload) sendSSE(res, "thought", payload);
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

async function portalSecurityDomainIdForActor(actor: CurrentActor): Promise<string | undefined> {
  return (await securityDomains.getForUser({
    organizationId: actor.organizationId,
    userId: actor.id
  }))?.id;
}

async function getPortalOwnedThread(threadId: string, actor: CurrentActor): Promise<ThreadRecord | undefined> {
  const [thread, securityDomainId] = await Promise.all([
    threads.getOwned(threadId, actor.id, actor.organizationId),
    portalSecurityDomainIdForActor(actor)
  ]);
  if (!thread) return undefined;
  return trimOrUndefined(thread.securityDomainId) === trimOrUndefined(securityDomainId) ? thread : undefined;
}

async function getPortalReadableThread(threadId: string, actor: CurrentActor): Promise<ThreadRecord | undefined> {
  const owned = await getPortalOwnedThread(threadId, actor);
  if (owned) return owned;
  if (!isInternalOrganizationType(actor.organizationType)) return undefined;
  return trainingCatalog.getThread({
    viewer: {
      userId: actor.id,
      organizationId: actor.organizationId,
      organizationType: actor.organizationType || ""
    },
    threadId
  });
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
  return resolveSelectedSkillIdsForMode({
    currentUser: input.currentUser,
    modeId: input.modeId,
    skillIds: requested.map((skill) => skill.id)
  });
}

async function resolveSelectedSkillIdsForMode(input: {
  currentUser: CurrentActor;
  modeId: string;
  skillIds: string[];
}): Promise<EnabledSkillSelection[]> {
  const requestedIds = Array.from(new Set(input.skillIds.map((skillId) => skillId.trim()).filter(Boolean)));
  if (requestedIds.length === 0) return [];

  const runtimeOptions = await portalRuntimeOptions.resolve({
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    roleIds: roleIdsForActor(input.currentUser),
    departmentIds: await listDepartmentIdsForActor(input.currentUser)
  });
  const selectedMode = runtimeOptions.modes.find((mode) => mode.id === input.modeId);
  const availableById = new Map((selectedMode?.availableSkills ?? []).map((skill) => [skill.id, skill] as const));
  const denied = requestedIds.filter((skillId) => !availableById.has(skillId));
  if (denied.length > 0) {
    throw new Error(`Selected skill is not available for this agent mode: ${denied.join(", ")}`);
  }
  return requestedIds.map((skillId) => {
    const availableSkill = availableById.get(skillId)!;
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
  scopeId?: string;
  scopeSegments?: string[];
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> }> {
  const enabledSkills = enabledSkillSelectionsFromRunConfig(input.codexRunConfig);
  const codexHome = await nativeCodexSkills.materializeSessionHome({
    scopeId: input.scopeId,
    scopeSegments: input.scopeSegments,
    enabledSkills: enabledSkills.map((skill) => ({
      name: skill.name,
      sourcePath: skill.sourcePath
    }))
  });
  await syncAgentStudioMemoryProjection(codexHome);
  return {
    codexHome,
    codexRunConfig: withRunConfigCodexHome(input.codexRunConfig, codexHome)
  };
}

async function materializeSharedCodexHomeForRunConfig(input: {
  currentUser: CurrentActor;
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> }> {
  const scope = buildSharedCodexHomeScope({
    actor: {
      organizationId: input.currentUser.organizationId,
      organizationSlug: input.currentUser.organizationSlug,
      userId: input.currentUser.id
    },
    modeId: input.modeId,
    codexRunConfig: input.codexRunConfig
  });
  return materializeCodexHomeForRunConfig({
    scopeSegments: scope.scopeSegments,
    codexRunConfig: input.codexRunConfig
  });
}

async function materializeSharedIntegrationCodexHomeForRunConfig(input: {
  provider: string;
  integrationInstanceId: string;
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> }> {
  const scope = buildSharedIntegrationCodexHomeScope({
    provider: input.provider,
    integrationInstanceId: input.integrationInstanceId,
    modeId: input.modeId,
    codexRunConfig: input.codexRunConfig
  });
  return materializeCodexHomeForRunConfig({
    scopeSegments: scope.scopeSegments,
    codexRunConfig: input.codexRunConfig
  });
}

async function allocateUserAgentWorkspacePath(input: {
  currentUser: CurrentActor;
  modeHint?: string;
  securityDomainId?: string;
  threadId?: string;
}): Promise<ModeSelection & { workspacePath: string }> {
  const selection = await resolveModeSelection({
    currentUser: input.currentUser,
    modeHint: input.modeHint
  });
  const baseWorkspacePath = buildUserAgentWorkspacePath({
    rootPath: selection.workspaceRootPath,
    actor: {
      organizationId: input.currentUser.organizationId,
      organizationSlug: input.currentUser.organizationSlug,
      userId: input.currentUser.id
    },
    modeId: selection.modeId,
    securityDomainId: input.securityDomainId
  });
  const workspacePath = input.threadId
    ? path.join(baseWorkspacePath, `thread-${sanitizePathSegment(input.threadId, "thread")}`)
    : baseWorkspacePath;
  await fs.mkdir(workspacePath, { recursive: true });
  return {
    ...selection,
    workspacePath
  };
}

function userAgentWorkspacePathForSelection(input: {
  currentUser: CurrentActor;
  selection: ModeSelection;
  securityDomainId?: string;
  threadId?: string;
}): string {
  const baseWorkspacePath = buildUserAgentWorkspacePath({
    rootPath: input.selection.workspaceRootPath,
    actor: {
      organizationId: input.currentUser.organizationId,
      organizationSlug: input.currentUser.organizationSlug,
      userId: input.currentUser.id
    },
    modeId: input.selection.modeId,
    securityDomainId: input.securityDomainId
  });
  return input.threadId
    ? path.join(baseWorkspacePath, `thread-${sanitizePathSegment(input.threadId, "thread")}`)
    : baseWorkspacePath;
}

async function materializeUserAgentCodexHomeForRunConfig(input: {
  currentUser: CurrentActor;
  modeId: string;
  codexRunConfig?: Record<string, unknown>;
}): Promise<{ codexHome: string; codexRunConfig?: Record<string, unknown> }> {
  return materializeSharedCodexHomeForRunConfig({
    currentUser: input.currentUser,
    modeId: input.modeId,
    codexRunConfig: input.codexRunConfig
  });
}

function getThreadUploadTempDir(threadId: string): string {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9_-]/g, "_").trim() || "thread";
  return path.join(appConfig.uploadTempRoot, safeThreadId);
}

function getLegacyThreadWorkspaceUploadDir(workspacePath: string): string {
  return path.join(workspacePath, ".uploads");
}

function getThreadWorkspaceUploadDir(workspacePath: string, threadId?: string): string {
  const normalizedThreadId = trimOrUndefined(threadId);
  if (!normalizedThreadId) {
    return getLegacyThreadWorkspaceUploadDir(workspacePath);
  }
  return path.join(
    workspacePath,
    ".agent-studio",
    "uploads",
    sanitizePathSegment(normalizedThreadId, "thread")
  );
}

function getThreadWorkspaceUploadDirs(workspacePath: string, threadId?: string): string[] {
  const dirs = [getThreadWorkspaceUploadDir(workspacePath, threadId), getLegacyThreadWorkspaceUploadDir(workspacePath)];
  return [...new Set(dirs)];
}

function shouldRemoveWorkspaceOnThreadHardDelete(threadId: string, workspacePath: string): boolean {
  const normalizedThreadId = sanitizePathSegment(threadId, "thread");
  return path.basename(path.resolve(workspacePath)) === `thread-${normalizedThreadId}`;
}

function ensureThreadUploadDirsInRunConfig(
  codexRunConfig: Record<string, unknown> | undefined,
  threadId: string,
  workspacePath: string
): Record<string, unknown> {
  return ensureThreadUploadInRunConfig(codexRunConfig, getThreadWorkspaceUploadDir(workspacePath, threadId));
}

async function createSession(
  options: SessionOptions,
  threadId?: string,
  timing?: RuntimeStartupTimer,
  resumeCodexThreadId?: string
) {
  const time = async <T>(
    name: string,
    action: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> => (timing ? timing.time(name, action, metadata) : action());
  if (threadId) {
    await time("create_session.prepare_upload_dir", () =>
      fs.mkdir(getThreadWorkspaceUploadDir(options.workspace, threadId), { recursive: true })
    );
  }

  const sessionCodexRunConfig = withoutInternalRuntimeMetadata(
    threadId
      ? ensureThreadUploadDirsInRunConfig(options.codexRunConfig, threadId, options.workspace)
      : options.codexRunConfig
  );
  const initialTurnSkillInputs = await time("create_session.resolve_initial_skill_inputs", () =>
    resolvePortalTurnSkillInputs(enabledSkillSelectionsFromRunConfig(sessionCodexRunConfig))
  );
  const existingCodexHome = options.codexHome ?? codexHomeFromRunConfig(sessionCodexRunConfig);
  const materializedCodexHome =
    existingCodexHome
      ? { codexHome: existingCodexHome, codexRunConfig: withRunConfigCodexHome(sessionCodexRunConfig, existingCodexHome) }
      : (
          await time("create_session.materialize_shared_codex_home", () =>
            materializeSharedCodexHomeForRuntimeOwner({
              organizationId: options.organizationId,
              userId: options.userId,
              codexRunConfig: sessionCodexRunConfig
            })
          )
        ) ??
        await time("create_session.materialize_codex_home", () =>
          materializeCodexHomeForRunConfig({
            scopeId: threadId ? `thread-${threadId}` : `session-${randomUUID()}`,
            codexRunConfig: sessionCodexRunConfig
          })
        );
  if (existingCodexHome) {
    timing?.mark("create_session.reuse_codex_home", { threadId });
  }

  const providerSnapshot = await time("create_session.resolve_provider_snapshot", () =>
    resolveProviderSnapshot({
      existingSnapshot: options.providerSnapshot
    })
  );
  const runtimeLaunch = await time("create_session.resolve_launch_config", () =>
    resolveRuntimeLaunchConfig({
      userId: options.userId,
      workspace: options.workspace,
      codexRunConfig: materializedCodexHome.codexRunConfig
    })
  );
  const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
    configOverrides: runtimeLaunch.configOverrides,
    envOverrides: {
      ...(runtimeLaunch.envOverrides ?? {}),
      CODEX_HOME: materializedCodexHome.codexHome
    }
  });
  const normalizedResumeCodexThreadId = trimOrUndefined(resumeCodexThreadId);
  const started = normalizedResumeCodexThreadId
    ? await time("create_session.resume_live_runtime_thread", async () => {
        const liveThread = await sessionRuntime.resumeThreadWithOptions({
          threadId: normalizedResumeCodexThreadId,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          workspace: options.workspace,
          codexRunConfig: stripInternalRunConfigMetadata(runtimeLaunch.codexRunConfig),
          skills: initialTurnSkillInputs
        });
        const codexThreadId =
          typeof (liveThread as { id?: unknown })?.id === "string"
            ? trimOrUndefined((liveThread as { id?: string }).id)
            : undefined;
        return {
          liveThread,
          codexRunConfig: runtimeLaunch.codexRunConfig,
          codexThreadId: codexThreadId ?? normalizedResumeCodexThreadId
        };
      }, { codexThreadId: normalizedResumeCodexThreadId })
    : await time("create_session.start_live_runtime_thread", () =>
        startLiveRuntimeSession({
          runtime: sessionRuntime,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          workspace: options.workspace,
          codexRunConfig: runtimeLaunch.codexRunConfig,
          skills: initialTurnSkillInputs
        })
      );
  const codexRunConfig = started.codexRunConfig;
  const codexThreadId = started.codexThreadId;
  const session = await time("create_session.persist_runtime_session", () =>
    sessions.create({
      organizationId: options.organizationId,
      userId: options.userId,
      threadId,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      workspace: options.workspace,
      codexRunConfig,
      codexThreadId,
      providerSnapshot
    })
  );
  liveRuntimeThreads.set(session.sessionId, started.liveThread);
  return session;
}

async function replaceUserAgentLiveRuntimeSession(input: {
  currentUser: CurrentActor;
  session: SessionRecord;
  threadId: string;
  failedCodexThreadId?: string;
  error: unknown;
  logLabel: string;
}): Promise<{ session: SessionRecord; liveThread: LiveRuntimeThread }> {
  const userId = trimOrUndefined(input.session.userId) ?? input.currentUser.id;
  const codexRunConfig = withoutInternalRuntimeMetadata(
    ensureThreadUploadDirsInRunConfig(input.session.codexRunConfig, input.threadId, input.session.workspace)
  );
  await fs.mkdir(getThreadWorkspaceUploadDir(input.session.workspace, input.threadId), { recursive: true });
  const modeSelection = await resolveModeSelection({
    currentUser: input.currentUser,
    modeHint: modeIdFromRunConfig(codexRunConfig)
  });
  const materializedCodexHome = await materializeUserAgentCodexHomeForRunConfig({
    currentUser: input.currentUser,
    modeId: modeSelection.modeId,
    codexRunConfig
  });
  const providerSnapshot = await resolveProviderSnapshot({
    existingSnapshot: input.session.providerSnapshot,
    fallbackToLocalAuth: !input.session.providerSnapshot
  });
  const runtimeLaunch = await resolveRuntimeLaunchConfig({
    userId,
    workspace: input.session.workspace,
    codexRunConfig: materializedCodexHome.codexRunConfig
  });
  const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
    configOverrides: runtimeLaunch.configOverrides,
    envOverrides: {
      ...(runtimeLaunch.envOverrides ?? {}),
      CODEX_HOME: materializedCodexHome.codexHome
    }
  });
  console.warn(`${input.logLabel} replacing stale codex runtime session`, {
    threadId: input.threadId,
    sessionId: input.session.sessionId,
    failedCodexThreadId: input.failedCodexThreadId,
    detail: runtimeErrorDetail(input.error)
  });
  const updated = await replaceLiveRuntimeSession({
    runtime: sessionRuntime,
    liveRuntimeThreads,
    sessionId: input.session.sessionId,
    threadId: input.threadId,
    model: input.session.model,
    reasoningEffort: input.session.reasoningEffort,
    workspace: input.session.workspace,
    codexRunConfig: runtimeLaunch.codexRunConfig,
    persist: async (payload) =>
      sessions.update(input.session.sessionId, {
        model: payload.model,
        reasoningEffort: payload.reasoningEffort,
        workspace: payload.workspace,
        codexRunConfig: payload.codexRunConfig,
        codexThreadId: payload.codexThreadId,
        providerSnapshot
      })
  });
  const liveThread = liveRuntimeThreads.get(updated.sessionId);
  if (!liveThread) {
    throw new Error("Replacement Agent Studio runtime session is not available");
  }
  return { session: updated, liveThread };
}

async function latestCodexThreadIdForAgentThread(threadId: string): Promise<string | undefined> {
  const latestSession = await sessions.latestForThread(threadId).catch((error) => {
    console.warn("failed to resolve latest codex thread id for Agent Studio thread", {
      threadId,
      detail: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  });
  return trimOrUndefined(latestSession?.codexThreadId);
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

function fingerprintWorkspaceAgentsMdContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function applyWorkspaceAgentsMdForMode(
  modeId: string,
  workspacePath: string
): Promise<{ fingerprint?: string }> {
  const content = await resolveWorkspaceAgentsMdContentForMode(modeId);
  if (!content) return {};
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(path.join(workspacePath, "AGENTS.md"), content, "utf8");
  return { fingerprint: fingerprintWorkspaceAgentsMdContent(content) };
}

const PORTAL_WORKSPACE_INSTRUCTIONS_START = "<!-- agent-studio:portal-workspace:start -->";
const PORTAL_WORKSPACE_INSTRUCTIONS_END = "<!-- agent-studio:portal-workspace:end -->";

async function applyPortalWorkspaceInstructions(
  workspacePath: string,
  materialized: { directoryName: string; fileCount: number; truncated: boolean }
): Promise<void> {
  const agentsMdPath = path.join(workspacePath, "AGENTS.md");
  const existing = await fs.readFile(agentsMdPath, "utf8").catch(() => "");
  const managedSectionPattern = new RegExp(
    `\\n?${PORTAL_WORKSPACE_INSTRUCTIONS_START}[\\s\\S]*?${PORTAL_WORKSPACE_INSTRUCTIONS_END}\\n?`,
    "g"
  );
  const base = existing.replace(managedSectionPattern, "\n").trimEnd();
  const managedSection = [
    PORTAL_WORKSPACE_INSTRUCTIONS_START,
    "## Portal user workspace",
    "",
    `The files selected by the user for this task are materialized in \`${materialized.directoryName}/\`.`,
    "Treat that directory like the user's working folder: read its files for context and edit them when the task requires it.",
    "New deliverables may be created in the runtime workspace; Agent Studio will version and surface eligible outputs in the task's file panel.",
    `Currently materialized files: ${materialized.fileCount}.`,
    ...(materialized.truncated
      ? [
          "The selected folder exceeded the safe per-run materialization limit. If a needed file is missing, ask the user to move it into a smaller folder or attach it to the task."
        ]
      : []),
    PORTAL_WORKSPACE_INSTRUCTIONS_END
  ].join("\n");
  await fs.writeFile(
    agentsMdPath,
    base ? `${base}\n\n${managedSection}\n` : `${managedSection}\n`,
    "utf8"
  );
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
  runtimeProfile: PortalRuntimeOptionRunProfile,
  timing?: RuntimeStartupTimer
): Promise<SessionOptions> {
  const time = async <T>(
    name: string,
    action: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> => (timing ? timing.time(name, action, metadata) : action());
  const [providerSnapshot, publishedSystemSettings] = await Promise.all([
    time("resolve_session_options.resolve_provider_snapshot", () =>
      resolveProviderSnapshot({ existingSnapshot: input.providerSnapshot })
    ),
    time("resolve_session_options.load_system_settings", () => codexProviders.getPublishedSystemSettings())
  ]);
  const defaults = resolveManagedCodexDefaults({
    systemSettings: publishedSystemSettings,
    providerSnapshot,
    model: input.model,
    reasoningEffort: input.reasoning_effort
  });
  const enabledSkills = await time("resolve_session_options.resolve_enabled_skills", () =>
    resolveEnabledSkillsForMode({
      currentUser,
      modeId,
      codexRunConfig: input.codex_run_config
    })
  );
  const sourceCodexRunConfig = withExternalRunProfileBoundaries(
    withRunConfigEnabledSkillSelection(
      withRunConfigMode(input.codex_run_config, modeId),
      enabledSkills
    ),
    currentUser,
    runtimeProfile
  );
  await time("resolve_session_options.apply_workspace_agents_md", () =>
    applyWorkspaceAgentsMdForMode(modeId, workspacePath)
  );
  const resolvedCodexRunConfig = await time("resolve_session_options.resolve_knowledge_sets", () =>
    resolveKnowledgeSetRunConfig({
      currentUser,
      workspacePath,
      knowledgeSetIds: input.knowledge_set_ids,
      codexRunConfig: sourceCodexRunConfig
    }),
    { selectedKnowledgeSetCount: input.knowledge_set_ids?.length ?? 0 }
  );
  const materializedCodexHome = await time("resolve_session_options.materialize_codex_home", () =>
    materializeUserAgentCodexHomeForRunConfig({
      currentUser,
      modeId,
      codexRunConfig: resolvedCodexRunConfig
    }),
    { enabledSkillCount: enabledSkills.length }
  );
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
    selected_skill_ids?: string[];
    codex_run_config?: Record<string, unknown>;
    allow_mode_change?: boolean;
    force_run_profile_controls?: boolean;
    resume_codex_thread_id?: string;
  },
  timing?: RuntimeStartupTimer,
  enforcePortalSecurityDomain = false
) {
  const time = async <T>(
    name: string,
    action: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> => (timing ? timing.time(name, action, metadata) : action());
  const thread = await time("ensure_thread_session.load_thread", () =>
    enforcePortalSecurityDomain
      ? getPortalOwnedThread(threadId, currentUser)
      : threads.getOwned(threadId, currentUser.id, currentUser.organizationId)
  );
  if (!thread) throw new Error("Thread does not exist");
  timing?.updateContext({
    threadId: thread.id,
    sessionId: thread.sessionId ?? undefined,
    model: thread.model ?? undefined
  });
  const existingSessionId = thread.sessionId;
  const active = existingSessionId
    ? await time("ensure_thread_session.load_active_session", () => sessions.get(existingSessionId))
    : undefined;
  const [providerSnapshot, publishedSystemSettings] = await Promise.all([
    time("ensure_thread_session.resolve_provider_snapshot", () =>
      resolveProviderSnapshot({
        existingSnapshot: active?.providerSnapshot,
        fallbackToLocalAuth: Boolean(active && !active.providerSnapshot)
      })
    ),
    time("ensure_thread_session.load_system_settings", () => codexProviders.getPublishedSystemSettings())
  ]);

  const guardedIncomingCodexRunConfig = guardPortalThreadModeChange({
    persistedConfig: thread.codexRunConfig,
    incomingConfig: patch?.codex_run_config,
    allowModeChange: patch?.allow_mode_change
  });
  const sourceCodexRunConfig = mergeRunConfigPreservingThreadSkills(
    thread.codexRunConfig,
    guardedIncomingCodexRunConfig
  );
  const modeHint = modeIdFromRunConfig(sourceCodexRunConfig);
  const modeSelection = await time("ensure_thread_session.resolve_mode_selection", () =>
    resolveModeSelection({
      currentUser,
      modeHint
    }),
    { modeHint }
  );
  const scopedWorkspacePath = userAgentWorkspacePathForSelection({
    currentUser,
    selection: modeSelection,
    securityDomainId: thread.securityDomainId,
    threadId
  });
  const legacyScopedWorkspacePath = userAgentWorkspacePathForSelection({
    currentUser,
    selection: modeSelection,
    securityDomainId: thread.securityDomainId
  });
  const existingWorkspacePath = trimOrUndefined(thread.workspace);
  const workspacePath =
    enforcePortalSecurityDomain
      ? scopedWorkspacePath
      : thread.securityDomainId &&
          existingWorkspacePath &&
          path.resolve(existingWorkspacePath) !== path.resolve(legacyScopedWorkspacePath) &&
          path.basename(path.resolve(existingWorkspacePath)) !== `thread-${sanitizePathSegment(threadId, "thread")}`
        ? legacyScopedWorkspacePath
        : existingWorkspacePath || scopedWorkspacePath;
  if (
    !enforcePortalSecurityDomain &&
    thread.securityDomainId &&
    existingWorkspacePath &&
    path.resolve(existingWorkspacePath) !== path.resolve(workspacePath)
  ) {
    await time("ensure_thread_session.migrate_security_domain_workspace", async () => {
      const existingStat = await fs.stat(existingWorkspacePath).catch(() => undefined);
      if (existingStat?.isDirectory()) {
        await fs.mkdir(workspacePath, { recursive: true });
        await fs.cp(existingWorkspacePath, workspacePath, {
          recursive: true,
          force: false,
          errorOnExist: false
        });
      }
    });
  }
  await time("ensure_thread_session.prepare_workspace", () => fs.mkdir(workspacePath, { recursive: true }));
  const enabledSkills = patch?.selected_skill_ids
    ? await time("ensure_thread_session.resolve_turn_skills", () =>
        resolveSelectedSkillIdsForMode({
          currentUser,
          modeId: modeSelection.modeId,
          skillIds: patch.selected_skill_ids!
        })
      )
    : await time("ensure_thread_session.resolve_enabled_skills", () =>
        resolveEnabledSkillsForMode({
          currentUser,
          modeId: modeSelection.modeId,
          codexRunConfig: sourceCodexRunConfig
        })
      );
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
    model: patch?.allow_mode_change ? patch.model || thread.model : thread.model,
    reasoningEffort: patch?.allow_mode_change
      ? patch.reasoning_effort || thread.reasoningEffort
      : thread.reasoningEffort
  });
  const desiredBaseCodexRunConfig = await time("ensure_thread_session.resolve_knowledge_sets", () =>
    resolveKnowledgeSetRunConfig({
      currentUser,
      workspacePath,
      knowledgeSetIds: patch?.knowledge_set_ids,
      codexRunConfig: boundedSourceCodexRunConfig
    }),
    { selectedKnowledgeSetCount: patch?.knowledge_set_ids?.length ?? 0 }
  );
  await time("ensure_thread_session.apply_workspace_agents_md", () =>
    applyWorkspaceAgentsMdForMode(modeSelection.modeId, workspacePath)
  );
  const materializedPortalWorkspace = await time(
    "ensure_thread_session.materialize_portal_workspace",
    () =>
      portalWorkspaces.materializeTaskWorkspace({
        actor: {
          userId: currentUser.id,
          organizationId: currentUser.organizationId,
          securityDomainId: thread.securityDomainId
        },
        threadId,
        runtimeWorkspacePath: workspacePath
      })
  );
  await time("ensure_thread_session.apply_portal_workspace_instructions", () =>
    applyPortalWorkspaceInstructions(workspacePath, materializedPortalWorkspace)
  );
  const desiredCodexRunConfig = ensureThreadUploadDirsInRunConfig(desiredBaseCodexRunConfig, threadId, workspacePath);
  const existingThreadCodexHome = codexHomeFromRunConfig(thread.codexRunConfig);
  const materializedCodexHome = existingThreadCodexHome
    ? {
        codexHome: existingThreadCodexHome,
        codexRunConfig: withRunConfigCodexHome(
          withRunConfigEnabledSkillSelection(desiredCodexRunConfig, []),
          existingThreadCodexHome
        )
      }
    : await time("ensure_thread_session.materialize_codex_home", () =>
        materializeUserAgentCodexHomeForRunConfig({
          currentUser,
          modeId: modeSelection.modeId,
          codexRunConfig: withRunConfigEnabledSkillSelection(desiredCodexRunConfig, [])
        }),
        { enabledSkillCount: enabledSkills.length }
      );
  const automaticPluginReconciliation = await time(
    "ensure_thread_session.reconcile_automatic_plugins",
    () => nativeCodexSkills.reconcileSharedPluginCaches(materializedCodexHome.codexHome)
  );
  const sessionCodexRunConfig = withRunConfigCodexHome(
    desiredCodexRunConfig,
    materializedCodexHome.codexHome
  );

  const desired: SessionOptions = {
    organizationId: currentUser.organizationId,
    userId: thread.userId ?? currentUser.id,
    model: defaults.model,
    reasoningEffort: defaults.reasoningEffort,
    workspace: workspacePath,
    providerSnapshot,
    codexRunConfig: sessionCodexRunConfig,
    codexHome: materializedCodexHome.codexHome
  };
  const persistedThreadCodexRunConfig = withRunConfigCodexHome(
    desiredBaseCodexRunConfig,
    materializedCodexHome.codexHome
  );

  const shouldPersistNormalizedThread =
    thread.model !== desired.model ||
    thread.reasoningEffort !== desired.reasoningEffort ||
    thread.workspace !== desired.workspace ||
    stableJson(thread.codexRunConfig) !== stableJson(persistedThreadCodexRunConfig);

  if (
    patch?.model ||
    patch?.reasoning_effort ||
    patch?.knowledge_set_ids ||
    patch?.codex_run_config ||
    shouldPersistNormalizedThread
  ) {
    await time("ensure_thread_session.persist_normalized_thread", () =>
      threads.update(threadId, {
        model: desired.model,
        reasoningEffort: desired.reasoningEffort,
        workspace: desired.workspace,
        codexRunConfig: persistedThreadCodexRunConfig
      })
    );
  }

  let activeForComparison = active;
  let hasLiveRuntime = false;
  if (active) {
    if (liveRuntimeThreads.has(active.sessionId)) {
      hasLiveRuntime = true;
      await time("ensure_thread_session.refresh_automatic_skills", () =>
        runtime.refreshSkills(liveRuntimeThreads.get(active.sessionId)!, {
          cwds: [workspacePath],
          fingerprint: automaticPluginReconciliation.fingerprint
        })
      );
      timing?.mark("ensure_thread_session.live_runtime_cache_hit", { sessionId: active.sessionId });
    } else {
      timing?.mark("ensure_thread_session.live_runtime_cache_miss", { sessionId: active.sessionId });
      hasLiveRuntime = Boolean(await time("ensure_thread_session.restore_live_runtime", () =>
        restoreLiveRuntimeThread(active, timing)
      ));
      if (hasLiveRuntime) {
        activeForComparison = await time("ensure_thread_session.peek_restored_session", () =>
          sessions.peek(active.sessionId)
        ) ?? active;
      }
    }
  }
  if (!thread.codexThreadId && activeForComparison?.codexThreadId) {
    await time("ensure_thread_session.backfill_codex_thread_binding", () =>
      threads.update(threadId, { codexThreadId: activeForComparison!.codexThreadId })
    );
  }
  let runtimeCapabilitiesCurrent = true;
  if (activeForComparison) {
    const sessionForCapabilities = activeForComparison;
    runtimeCapabilitiesCurrent = await time("ensure_thread_session.check_runtime_capabilities", () =>
      sessionRuntimeCapabilitiesAreCurrent(sessionForCapabilities, desired.userId)
    );
  }
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
    const sessionToRefresh = activeForComparison;
    const refreshed = await time("ensure_thread_session.refresh_live_runtime", () =>
      refreshLiveRuntimeThread(sessionToRefresh)
    );
    if (refreshed) {
      activeForComparison = refreshed;
      refreshedRuntimeCapabilitiesCurrent = await time("ensure_thread_session.recheck_runtime_capabilities", () =>
        sessionRuntimeCapabilitiesAreCurrent(refreshed, desired.userId)
      );
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
    timing?.mark("ensure_thread_session.reuse_active_session", { sessionId: activeForComparison.sessionId });
    return activeForComparison;
  }

  const onlyTurnScopedSettingsChanged = Boolean(
    activeForComparison &&
    hasLiveRuntime &&
    activeForComparison.workspace === desired.workspace &&
    stableJson(runtimeCapabilityComparableConfig(activeForComparison.codexRunConfig)) ===
      stableJson(runtimeCapabilityComparableConfig(desired.codexRunConfig)) &&
    refreshedRuntimeCapabilitiesCurrent
  );
  if (onlyTurnScopedSettingsChanged && activeForComparison) {
    const updated = await time("ensure_thread_session.update_turn_defaults", () =>
      sessions.update(activeForComparison.sessionId, {
        model: desired.model,
        reasoningEffort: desired.reasoningEffort,
        workspace: desired.workspace,
        codexRunConfig: desired.codexRunConfig,
        providerSnapshot: desired.providerSnapshot
      })
    );
    timing?.mark("ensure_thread_session.reuse_codex_thread", {
      sessionId: updated.sessionId,
      codexThreadId: updated.codexThreadId
    });
    return updated;
  }

  await time("ensure_thread_session.assert_chat_access", () =>
    assertChatAllowsNewSession({
      currentUser,
      model: desired.model,
      featureType: "chat"
    })
  );

  const resumeCodexThreadId = resolveCodexThreadContinuity({
    threadCodexThreadId: thread.codexThreadId,
    activeSessionCodexThreadId: activeForComparison?.codexThreadId,
    historicalSessionCodexThreadId: patch?.resume_codex_thread_id
  });

  if (enforcePortalSecurityDomain) {
    await time("ensure_thread_session.recheck_deploy_drain", () =>
      assertDeploymentAllowsRuntimeStart(getDeploymentDrainReason)
    );
  }

  if (active?.sessionId) {
    await time("ensure_thread_session.remove_stale_session", () => sessions.remove(active.sessionId));
    liveRuntimeThreads.delete(active.sessionId);
  }
  let sessionStartAttempt = 0;
  const startedSession = await startWithMissingCodexRolloutRecovery<SessionRecord>({
    resumeCodexThreadId,
    start: async (requestedCodexThreadId) => {
      sessionStartAttempt += 1;
      return await time(
        sessionStartAttempt === 1
          ? "ensure_thread_session.create_session"
          : "ensure_thread_session.create_replacement_session",
        () => createSession(desired, threadId, timing, requestedCodexThreadId)
      );
    },
    codexThreadId: (createdSession) => trimOrUndefined(createdSession.codexThreadId),
    persistRecoveredCodexThreadId: async (replacementCodexThreadId) => {
      await time("ensure_thread_session.persist_replacement_thread_binding", () =>
        threads.update(threadId, { codexThreadId: replacementCodexThreadId })
      );
    },
    rollbackRecovered: async (createdSession) => {
      liveRuntimeThreads.delete(createdSession.sessionId);
      await sessions.remove(createdSession.sessionId);
    },
    onRecover: ({ failedCodexThreadId, error }) => {
      timing?.mark("ensure_thread_session.recover_missing_rollout", {
        failedCodexThreadId,
        error: runtimeErrorDetail(error)
      });
      console.warn("Portal session replacing missing Codex rollout", {
        threadId,
        failedCodexThreadId,
        detail: runtimeErrorDetail(error)
      });
    }
  });
  const session = startedSession.value;
  const canonicalCodexThreadId = trimOrUndefined(thread.codexThreadId);
  const sessionCodexThreadId = trimOrUndefined(session.codexThreadId);
  assertCodexThreadContinuity({
    expectedCodexThreadId: startedSession.recovered
      ? sessionCodexThreadId
      : canonicalCodexThreadId ?? resumeCodexThreadId,
    observedCodexThreadId: sessionCodexThreadId,
    scope: "Agent thread"
  });
  if (!startedSession.recovered && !canonicalCodexThreadId && sessionCodexThreadId) {
    await time("ensure_thread_session.persist_codex_thread_binding", () =>
      threads.update(threadId, { codexThreadId: sessionCodexThreadId })
    );
  }
  timing?.updateContext({ sessionId: session.sessionId, model: session.model });
  return session;
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
    "This file is generated by Agent Studio for the current Zendesk integration workspace.",
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
  const workspacePath = buildIntegrationAgentWorkspacePath({
    rootPath: workspaceRoot,
    provider: ZENDESK_CHANNEL,
    integrationInstanceId: input.instanceId || "legacy",
    modeId: agentModeId
  });
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
  const materializedCodexHome = await materializeSharedIntegrationCodexHomeForRunConfig({
    provider: ZENDESK_CHANNEL,
    integrationInstanceId: input.instanceId || "legacy",
    modeId: agentModeId,
    codexRunConfig: baseCodexRunConfig
  });
  const runtimeLaunch = await resolveRuntimeLaunchConfig({
    workspace: workspacePath,
    codexRunConfig: materializedCodexHome.codexRunConfig
  });
  const providerSnapshot = await resolveProviderSnapshot();

  return {
    runtime: createRuntimeForProviderSnapshot(providerSnapshot, {
      configOverrides: runtimeLaunch.configOverrides,
      envOverrides: {
        ...(runtimeLaunch.envOverrides ?? {}),
        CODEX_HOME: materializedCodexHome.codexHome
      }
    }),
    model: selectedModel,
    reasoningEffort: selectedReasoningEffort,
    workspace: workspacePath,
    codexRunConfig: runtimeLaunch.codexRunConfig,
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
    ...(input.role === "assistant" ? { status: { type: "completed" } } : {}),
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
  const binding = await conversationRecords.getExternalConversationBinding(externalConversationKey);
  let thread = binding ? await threads.get(binding.threadId, integration.organizationId ?? undefined) : undefined;

  const runConfig = zendeskThreadRunConfig({
    runtime: input.runtime,
    instanceId,
    ticketId: input.ticketId,
    externalConversationKey
  });
  const existingThreadCodexHome = codexHomeFromRunConfig(runConfig);
  const persistedRunConfig = existingThreadCodexHome
    ? withRunConfigCodexHome(runConfig, existingThreadCodexHome)
    : (
        await materializeSharedIntegrationCodexHomeForRunConfig({
          provider: ZENDESK_CHANNEL,
          integrationInstanceId: instanceId,
          modeId: agentModeId,
          codexRunConfig: runConfig
        })
      ).codexRunConfig;
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
      codexRunConfig: persistedRunConfig
    });
  } else {
    const shouldUpdateThread =
      thread.title !== title ||
      thread.model !== input.runtime.model ||
      thread.reasoningEffort !== input.runtime.reasoningEffort ||
      thread.workspace !== input.runtime.workspace ||
      stableJson(thread.codexRunConfig) !== stableJson(persistedRunConfig);
    if (shouldUpdateThread) {
      thread = await threads.update(thread.id, {
        title,
        model: input.runtime.model,
        reasoningEffort: input.runtime.reasoningEffort,
        workspace: input.runtime.workspace,
        codexRunConfig: persistedRunConfig
      });
    }
  }

  const preparedComment = latestPreparedZendeskComment(input.context, input.requesterComment);
  const messageAt = preparedComment.createdAt ? new Date(preparedComment.createdAt) : new Date();
  await conversationRecords.upsertExternalConversation({
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

  const updated = await conversationRecords.appendMessage({
    threadId: ensured.thread.id,
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
  processContentParts?: Record<string, unknown>[];
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
  const contentParts = [
    ...(input.processContentParts ?? []),
    ...(tracePart ? [tracePart] : [])
  ];
  await conversationRecords.appendMessage({
    threadId: audit.threadId,
    parentId: audit.userMessageId ?? null,
    message: zendeskMessage({
      id: `zendesk-agent-${input.runId}`,
      role: "assistant",
      text: zendeskAssistantAuditText(input),
      contentParts: contentParts.length > 0 ? contentParts : undefined,
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
    await conversationRecords.touchExternalConversation({
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
  await fs.mkdir(getThreadWorkspaceUploadDir(input.runtimeOptions.workspace, thread.id), { recursive: true });
  const codexRunConfig = zendeskDesiredRuntimeConfig(input, thread);
  return await materializeSharedIntegrationCodexHomeForRunConfig({
    provider: ZENDESK_CHANNEL,
    integrationInstanceId: input.instanceId || "legacy",
    modeId: modeIdFromRunConfig(codexRunConfig) ?? "default",
    codexRunConfig
  });
}

async function startZendeskRuntimeSession(
  input: ZendeskRuntimeSessionInput,
  thread: ThreadRecord,
  status: ZendeskRuntimeSessionLease["status"],
  existingProviderSnapshot?: ManagedCodexProviderSnapshot,
  resumeCodexThreadId?: string
): Promise<ZendeskRuntimeSessionLease> {
  const providerSnapshot = await resolveProviderSnapshot({
    existingSnapshot: existingProviderSnapshot
  });
  const materializedCodexHome = await materializeZendeskRuntimeConfig(input, thread);
  const runtimeLaunch = await resolveRuntimeLaunchConfig({
    userId: thread.userId ?? undefined,
    workspace: input.runtimeOptions.workspace,
    codexRunConfig: materializedCodexHome.codexRunConfig
  });
  const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
    configOverrides: runtimeLaunch.configOverrides,
    envOverrides: {
      ...(runtimeLaunch.envOverrides ?? {}),
      CODEX_HOME: materializedCodexHome.codexHome
    }
  });
  const normalizedResumeCodexThreadId = trimOrUndefined(resumeCodexThreadId);
  const started = normalizedResumeCodexThreadId
    ? await sessionRuntime.resumeThreadWithOptions({
        threadId: normalizedResumeCodexThreadId,
        model: input.runtimeOptions.model,
        reasoningEffort: input.runtimeOptions.reasoningEffort,
        workspace: input.runtimeOptions.workspace,
        codexRunConfig: stripInternalRunConfigMetadata(runtimeLaunch.codexRunConfig)
      }).then((liveThread) => ({
        liveThread,
        codexRunConfig: runtimeLaunch.codexRunConfig,
        codexThreadId: trimOrUndefined((liveThread as { id?: string }).id) ?? normalizedResumeCodexThreadId
      }))
    : await startLiveRuntimeSession({
        runtime: sessionRuntime,
        model: input.runtimeOptions.model,
        reasoningEffort: input.runtimeOptions.reasoningEffort,
        workspace: input.runtimeOptions.workspace,
        codexRunConfig: runtimeLaunch.codexRunConfig
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

  const resumeCodexThreadId = await resolveCodexThreadContinuityWithHistory({
    threadCodexThreadId: thread.codexThreadId,
    activeSessionCodexThreadId: active?.codexThreadId,
    loadHistoricalSessionCodexThreadId: () => latestCodexThreadIdForAgentThread(thread.id)
  });

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }

  const started = await startZendeskRuntimeSession(
    input,
    thread,
    "started",
    active?.providerSnapshot,
    resumeCodexThreadId
  );
  assertCodexThreadContinuity({
    expectedCodexThreadId: resumeCodexThreadId,
    observedCodexThreadId: started.codexThreadId,
    scope: "Zendesk conversation"
  });
  return started;
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
  contentParts?: Record<string, unknown>[];
}) {
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
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    ...(input.role === "assistant" ? { status: { type: "completed" } } : {}),
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
  const workspaceRootPath = await resolveEffectiveSessionWorkspaceRootPath();
  const agentModeId = trimOrUndefined(input.instance.robot.agentModeId) ?? "default";
  const workspacePath =
    trimOrUndefined(input.thread.workspace) ||
    buildUserAgentWorkspacePath({
      rootPath: workspaceRootPath,
      actor: {
        organizationId: input.currentUser.organizationId,
        organizationSlug: input.currentUser.organizationSlug,
        userId: input.currentUser.id
      },
      modeId: agentModeId
    });
  await fs.mkdir(workspacePath, { recursive: true });
  const desired = await resolveDingTalkBotSessionOptions({
    currentUser: input.currentUser,
    instance: input.instance,
    workspacePath
  });
  const desiredCodexRunConfig = ensureThreadUploadDirsInRunConfig(desired.baseCodexRunConfig, input.thread.id, workspacePath);
  const materializedCodexHome = await materializeUserAgentCodexHomeForRunConfig({
    currentUser: input.currentUser,
    modeId: agentModeId,
    codexRunConfig: desiredCodexRunConfig
  });
  const persistedThreadCodexRunConfig = withRunConfigCodexHome(
    desired.baseCodexRunConfig,
    materializedCodexHome.codexHome
  );

  const shouldPersistThread =
    input.thread.model !== desired.model ||
    input.thread.reasoningEffort !== desired.reasoningEffort ||
    input.thread.workspace !== desired.workspace ||
    stableJson(input.thread.codexRunConfig) !== stableJson(persistedThreadCodexRunConfig);
  if (shouldPersistThread) {
    await threads.update(input.thread.id, {
      model: desired.model,
      reasoningEffort: desired.reasoningEffort,
      workspace: desired.workspace,
      codexRunConfig: persistedThreadCodexRunConfig
    });
  }

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

  const resumeCodexThreadId = await resolveCodexThreadContinuityWithHistory({
    threadCodexThreadId: input.thread.codexThreadId,
    activeSessionCodexThreadId: active?.codexThreadId,
    loadHistoricalSessionCodexThreadId: () => latestCodexThreadIdForAgentThread(input.thread.id)
  });

  await assertChatAllowsNewSession({
    currentUser: input.currentUser,
    model: desiredSession.model,
    featureType: "chat"
  });

  if (active?.sessionId) {
    await sessions.remove(active.sessionId);
    liveRuntimeThreads.delete(active.sessionId);
  }
  const session = await createSession(desiredSession, input.thread.id, undefined, resumeCodexThreadId);
  assertCodexThreadContinuity({
    expectedCodexThreadId: resumeCodexThreadId,
    observedCodexThreadId: session.codexThreadId,
    scope: "DingTalk conversation"
  });
  return await persistSessionCodexThreadId(session, session.codexThreadId ?? "");
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
  const agentModeId = trimOrUndefined(input.instance.robot.agentModeId) ?? "default";
  const workspacePath = buildUserAgentWorkspacePath({
    rootPath: workspaceRoot,
    actor: {
      organizationId: input.currentUser.organizationId,
      organizationSlug: input.currentUser.organizationSlug,
      userId: input.currentUser.id
    },
    modeId: agentModeId
  });
  await fs.mkdir(workspacePath, { recursive: true });
  const options = await resolveDingTalkBotSessionOptions({
    currentUser: input.currentUser,
    instance: input.instance,
    workspacePath
  });
  const desiredCodexRunConfig = ensureThreadUploadDirsInRunConfig(options.baseCodexRunConfig, threadId, workspacePath);
  const materializedCodexHome = await materializeUserAgentCodexHomeForRunConfig({
    currentUser: input.currentUser,
    modeId: agentModeId,
    codexRunConfig: desiredCodexRunConfig
  });
  const persistedThreadCodexRunConfig = withRunConfigCodexHome(
    options.baseCodexRunConfig,
    materializedCodexHome.codexHome
  );
  const thread = await threads.create({
    id: threadId,
    organizationId: input.currentUser.organizationId,
    userId: input.currentUser.id,
    title: input.title,
    externalId: dingtalkThreadExternalId(input.externalConversationKey),
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workspace: options.workspace,
    codexRunConfig: persistedThreadCodexRunConfig
  });
  const session = await createSession({
    ...options,
    codexRunConfig: materializedCodexHome.codexRunConfig,
    codexHome: materializedCodexHome.codexHome
  }, thread.id);
  await persistSessionCodexThreadId(session, session.codexThreadId ?? "");
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
  return conversationRecords.upsertExternalConversation({
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

function reportDingTalkBotError(input: {
  incoming: DingTalkBotIncomingMessage;
  error: unknown;
  actor?: DingTalkBotActor;
  thread?: ThreadRecord;
  session?: SessionRecord;
}): void {
  const failureDetail = dingTalkErrorDetail(input.error);
  void conversationRecovery
    .recordFailure({
      recoveryKey: dingtalkBotRecoveryKey(input, failureDetail),
      organizationId: input.actor?.currentUser.organizationId ?? input.incoming.instance.organizationId,
      userId: input.actor?.currentUser.id,
      threadId: input.thread?.id,
      source: "dingtalk_bot_error",
      channel: DINGTALK_BOT_CHANNEL,
      audience: recoveryAudienceForActor(input.actor?.currentUser),
      severity: "high",
      reasonCode: "runtime_error",
      title: `钉钉机器人问答失败：${
        trimOrUndefined(input.actor?.displayName) ||
        trimOrUndefined(input.incoming.robotMessage.senderNick) ||
        input.incoming.instance.name
      }`,
      questionPreview: input.incoming.text,
      failureDetail,
      metadata: {
        integrationInstanceId: input.incoming.instance.id,
        integrationSlug: input.incoming.instance.slug,
        botName: input.incoming.instance.name,
        sessionId: input.session?.sessionId,
        externalMessageId: trimOrUndefined(input.incoming.robotMessage.msgId),
        externalConversationId: trimOrUndefined(input.incoming.robotMessage.conversationId),
        conversationType: trimOrUndefined(input.incoming.robotMessage.conversationType),
        senderStaffId: trimOrUndefined(input.incoming.robotMessage.senderStaffId),
        senderNick: trimOrUndefined(input.incoming.robotMessage.senderNick)
      }
    })
    .catch((error) => {
      console.warn("DingTalk bot recovery case record failed", {
        instanceId: input.incoming.instance.id,
        detail: error instanceof Error ? error.message : String(error)
      });
    });

  void dingtalkBotErrorNotifier
    .notify({
      instance: input.incoming.instance,
      robotMessage: input.incoming.robotMessage,
      text: input.incoming.text,
      error: input.error,
      actor: input.actor
        ? {
            id: input.actor.currentUser.id,
            organizationId: input.actor.currentUser.organizationId,
            displayName: input.actor.displayName,
            dingtalkUserId: input.actor.dingtalkUserId
          }
        : undefined,
      threadId: input.thread?.id,
      sessionId: input.session?.sessionId
    })
    .catch((error) => {
      console.warn("DingTalk bot error alert dispatch failed", {
        instanceId: input.incoming.instance.id,
        detail: error instanceof Error ? error.message : String(error)
      });
    });
}

function reportVisibleConversationFailure(input: VisibleConversationFailureInput): void {
  void visibleConversationFailureReporter.report(input).catch((error) => {
    console.warn("visible conversation failure report failed", {
      source: input.source,
      channel: input.channel,
      threadId: input.threadId,
      sessionId: input.sessionId,
      detail: error instanceof Error ? error.message : String(error)
    });
  });
}

function dingtalkBotRecoveryKey(
  input: {
    incoming: DingTalkBotIncomingMessage;
    thread?: ThreadRecord;
  },
  failureDetail: string
): string {
  return [
    "dingtalk_bot_error",
    input.incoming.instance.id,
    trimOrUndefined(input.thread?.id),
    trimOrUndefined(input.incoming.robotMessage.msgId) ??
      trimOrUndefined(input.incoming.robotMessage.conversationId) ??
      summarizeText(failureDetail, 80)
  ]
    .filter(Boolean)
    .join(":");
}

function recoveryAudienceForActor(actor?: CurrentActor): "internal" | "external" | "unknown" {
  if (!actor) return "unknown";
  if (actor.userType === "external_user" || actor.organizationType === "customer") return "external";
  if (actor.userType === "internal_employee" || actor.organizationType === "internal") return "internal";
  return "unknown";
}

function dingTalkErrorDetail(error: unknown): string {
  if (error instanceof Error) return summarizeText(error.message || "DingTalk bot message failed", 500);
  if (typeof error === "string") return summarizeText(error || "DingTalk bot message failed", 500);
  return "DingTalk bot message failed";
}

async function handleDingTalkBotMessage(input: DingTalkBotIncomingMessage): Promise<DingTalkBotHandleResult> {
  const agentModeId = trimOrUndefined(input.instance.robot.agentModeId);
  if (!agentModeId) {
    reportDingTalkBotError({
      incoming: input,
      error: new Error("DingTalk bot is not bound to an Agent Mode")
    });
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
  let binding = await conversationRecords.getExternalConversationBinding(externalConversationKey);
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
    await conversationRecords.appendMessage({
      threadId: thread.id,
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
  const streamingCardAgentMessagePhaseById = new Map<string, string>();
  try {
    const turnResult = await runCodexChannelTurn({
      channel: "dingtalk",
      prompt: runtimePrompt,
      memoryChannel: DINGTALK_BOT_CHANNEL,
      currentUser: actor.currentUser,
      thread,
      session: currentSession,
      liveThread,
      memoryPrompt: input.text,
      memoryMetadata: {
        integrationInstanceId: input.instance.id,
        externalConversationKey,
        conversationType: scope
      },
      usageSource: DINGTALK_BOT_CHANNEL,
      usageMetadata: {
        integrationInstanceId: input.instance.id,
        integrationSlug: input.instance.slug,
        agentModeId,
        conversationType: scope,
        externalConversationKey,
        externalConversationId: input.robotMessage.conversationId,
        externalMessageId: input.robotMessage.msgId
      },
      departmentIdSnapshot: async () =>
        trimOrUndefined(actor.currentUser.organizationType) === "internal"
          ? await departmentMemberships.getPreferredDepartmentIdForUser(actor.currentUser.id)
          : undefined,
      emptyAnswerText: "已完成处理，但没有生成可发送的文本回复。",
      artifactScanStartedAt: new Date(Date.now() - 2000),
      logLabel: "DingTalk bot",
      onEvent({ event }) {
        if (streamingCardReply) {
          const nextPreview = appendRuntimeAnswerPreview(streamedAnswerPreview, event, streamingCardAgentMessagePhaseById);
          if (nextPreview !== streamedAnswerPreview) {
            streamedAnswerPreview = nextPreview;
            void streamingCardReply.update(streamedAnswerPreview);
          }
        }
      },
      async onDone({ answerText: output, artifactContentPart, finalizedProcess }) {
        answerText = output;
        if (streamingCardReply) {
          await streamingCardReply.finish(answerText);
          streamingCardFinalized = true;
        }
        const processContentParts = finalizedProcess.contentParts;
        await conversationRecords.appendMessage({
          threadId: thread.id,
          parentId: input.robotMessage.msgId,
          message: dingtalkMessage({
            id: `dingtalk-assistant-${randomUUID().replace(/-/g, "")}`,
            role: "assistant",
            text: answerText,
            contentParts: artifactContentPart ? [...processContentParts, artifactContentPart] : processContentParts,
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
      onRetry() {
        if (streamingCardReply) {
          void streamingCardReply.update("正在重建运行环境并重试本轮请求。");
        }
      },
      onTelemetryError(error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn("DingTalk bot usage telemetry ingestion failed", {
          threadId: thread.id,
          detail
        });
      }
    });
    currentSession = turnResult.session;
    liveThread = turnResult.liveThread;
  } catch (error) {
    if (streamingCardReply) {
      await streamingCardReply.fail(input.instance.robot.errorMessage || "这条消息处理失败，请稍后重试。").catch(() => undefined);
    }
    reportDingTalkBotError({
      incoming: input,
      error,
      actor,
      thread,
      session: currentSession
    });
    throw error;
  }

  await conversationRecords.touchExternalConversation({
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

function storedPortalRunId(message: unknown, runConfig?: Record<string, unknown>): string | undefined {
  const metadata = asRecord(asRecord(message)?.metadata);
  const custom = asRecord(metadata?.custom);
  return trimOrUndefined(runConfig?.runId as string | undefined) ??
    trimOrUndefined(runConfig?.run_id as string | undefined) ??
    trimOrUndefined(custom?.runId as string | undefined) ??
    trimOrUndefined(custom?.run_id as string | undefined);
}

function withStoredMessageId(message: unknown, id: string): unknown {
  const obj = asRecord(message);
  if (!obj) return message;
  return {
    ...obj,
    id
  };
}

async function normalizePortalAssistantMessageAppend(input: {
  threadId: string;
  parentId?: string | null;
  message: unknown;
  runConfig?: Record<string, unknown>;
}): Promise<unknown> {
  if (storedMessageRole(input.message) !== "assistant") return input.message;
  const parentId = trimOrUndefined(input.parentId ?? undefined);
  const channel = trimOrUndefined(input.runConfig?.channel as string | undefined);
  if (channel && channel !== "portal") return input.message;
  const repository = await conversationRecords.getMessageRepository(input.threadId);
  assertPortalAssistantHasUserParent({
    role: "assistant",
    parentId,
    existingMessages: repository.messages.map((item) => ({
      id: storedMessageId(item.message),
      role: storedMessageRole(item.message),
      parentId: item.parentId
    }))
  });
  const existingAssistant = repository.messages.find((item) => {
    return item.parentId === parentId && storedMessageRole(item.message) === "assistant";
  });
  const existingId = existingAssistant ? storedMessageId(existingAssistant.message) : undefined;
  if (!existingId || !existingAssistant) return input.message;
  const incomingRunId = storedPortalRunId(input.message, input.runConfig);
  const existingRunId = storedPortalRunId(existingAssistant.message, existingAssistant.runConfig);
  if (incomingRunId && incomingRunId !== existingRunId) return input.message;
  return preserveCompletedPortalAssistantMessage({
    existing: existingAssistant.message,
    incoming: withStoredMessageId(input.message, existingId)
  });
}

function portalAssistantMessage(input: {
  id: string;
  answerText: string;
  sessionId: string;
  runId: string;
  contentParts?: Record<string, unknown>[];
}) {
  const leadingContentParts = (input.contentParts ?? []).filter((part) =>
    part.type === "data" && part.name === "codex_instruction_reads"
  );
  const trailingContentParts = (input.contentParts ?? []).filter((part) =>
    !(part.type === "data" && part.name === "codex_instruction_reads")
  );
  return {
    id: input.id,
    role: "assistant",
    content: [
      ...leadingContentParts,
      {
        type: "text",
        text: input.answerText
      },
      ...trailingContentParts
    ],
    status: {
      type: "complete",
      reason: "stop"
    },
    createdAt: new Date().toISOString(),
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        sessionId: input.sessionId,
        runId: input.runId,
        serverPersisted: true
      }
    }
  };
}

function portalStoppedAssistantMessage(input: {
  id: string;
  sessionId: string;
  runId: string;
  reason: string;
}) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Response stopped."
      },
      {
        type: "data",
        name: "codex_process_audit",
        data: {
          kind: "cancelled",
          at: now,
          title: "Stopped",
          detail: "The response was stopped before it completed.",
          reason: input.reason
        }
      }
    ],
    status: {
      type: "incomplete",
      reason: "cancelled"
    },
    createdAt: now,
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        sessionId: input.sessionId,
        runId: input.runId,
        serverPersisted: true,
        stopped: true,
        stopReason: input.reason
      }
    }
  };
}

function portalUserMessage(input: {
  id: string;
  message: unknown;
  displayText: string;
  sessionId: string;
}) {
  const payload = asRecord(input.message);
  const now = new Date().toISOString();
  const baseMetadata = asRecord(payload?.metadata) ?? {};
  const customMetadata = asRecord(baseMetadata.custom) ?? {};
  if (payload?.role === "user") {
    return {
      ...payload,
      id: input.id,
      role: "user",
      createdAt: typeof payload.createdAt === "string" ? payload.createdAt : now,
      status: {
        type: "in_progress",
        at: now
      },
      metadata: {
        ...baseMetadata,
        custom: {
          ...customMetadata,
          channel: "portal",
          sessionId: input.sessionId,
          serverPersisted: true
        }
      }
    };
  }
  return {
    id: input.id,
    role: "user",
    content: [
      {
        type: "text",
        text: input.displayText
      }
    ],
    attachments: [],
    createdAt: now,
    status: {
      type: "in_progress",
      at: now
    },
    metadata: {
      custom: {
        channel: "portal",
        sessionId: input.sessionId,
        serverPersisted: true
      }
    }
  };
}

function portalFailedAssistantMessage(input: {
  id: string;
  sessionId: string;
  runId: string;
  autoRecoveryAttempted?: boolean;
}) {
  if (input.autoRecoveryAttempted) {
    return portalAutoRecoveryFailureAssistantMessage({
      id: input.id,
      sessionId: input.sessionId,
      runId: input.runId
    });
  }
  const now = new Date().toISOString();
  return {
    id: input.id,
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I couldn't complete this response. Please try again."
      }
    ],
    status: {
      type: "incomplete",
      reason: "error"
    },
    createdAt: now,
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        sessionId: input.sessionId,
        runId: input.runId,
        serverPersisted: true,
        failed: true,
        autoRecoveryAttempted: false
      }
    }
  };
}

function findStoredMessageById(
  repository: {
    messages: Array<{
      message: unknown;
      parentId?: string | null;
      runConfig?: Record<string, unknown>;
    }>;
  },
  messageId?: string
): {
  message: unknown;
  parentId?: string | null;
  runConfig?: Record<string, unknown>;
} | undefined {
  const normalizedId = trimOrUndefined(messageId);
  if (!normalizedId) return undefined;
  return repository.messages.find((item) => storedMessageId(item.message) === normalizedId);
}

async function ensurePortalStreamUserMessage(input: {
  threadId: string;
  userMessageId?: string;
  parentId?: string | null;
  userMessage?: unknown;
  displayText: string;
  sessionId: string;
}): Promise<string> {
  const requestedUserMessageId = trimOrUndefined(input.userMessageId);
  const payloadId = storedMessageId(input.userMessage);
  const userMessageId =
    requestedUserMessageId ??
    payloadId ??
    `portal-user-${createHash("sha256")
      .update(`${input.threadId}:${input.sessionId}:${input.displayText}`)
      .digest("hex")
      .slice(0, 24)}`;
  const displayText = trimOrUndefined(input.displayText) ?? "User message";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const repository = await conversationRecords.getMessageRepository(input.threadId);
      const existingUserMessage = findStoredMessageById(repository, userMessageId);
      if (existingUserMessage) {
        if (storedMessageRole(existingUserMessage.message) !== "user") {
          throw new Error("Existing portal message id is not a user message");
        }
        await conversationRecords.appendMessage({
          threadId: input.threadId,
          parentId: existingUserMessage.parentId ?? null,
          message: portalUserMessage({
            id: userMessageId,
            message: existingUserMessage.message,
            displayText,
            sessionId: input.sessionId
          }),
          runConfig: {
            ...(existingUserMessage.runConfig ?? {}),
            channel: "portal",
            sessionId: input.sessionId,
            serverPersisted: true,
            pendingUserMessage: false
          }
        });
        return userMessageId;
      }

      const requestedParentId = trimOrUndefined(input.parentId ?? undefined);
      const requestedParent = findStoredMessageById(repository, requestedParentId);
      const repositoryHeadId = trimOrUndefined(repository.headId ?? undefined);
      const repositoryHead = findStoredMessageById(repository, repositoryHeadId);
      const parentId = requestedParent ? requestedParentId ?? null : repositoryHead ? repositoryHeadId ?? null : null;
      const message = portalUserMessage({
        id: userMessageId,
        message: input.userMessage,
        displayText,
        sessionId: input.sessionId
      });

      await conversationRecords.appendMessage({
        threadId: input.threadId,
        parentId,
        message,
        runConfig: { channel: "portal", sessionId: input.sessionId, serverPersisted: true }
      });
      return userMessageId;
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  return userMessageId;
}

async function appendPortalStoppedAssistant(input: {
  threadId: string;
  userMessageId: string;
  sessionId: string;
  runId: string;
  assistantMessageId?: string;
  reason: string;
}): Promise<boolean> {
  if (!portalRunMayPersist(input)) return false;
  const parentId = await requirePortalUserMessageParent({
    threadId: input.threadId,
    userMessageId: input.userMessageId
  });
  const repository = await conversationRecords.getMessageRepository(input.threadId);
  const existingAssistant = repository.messages.find((item) => {
    return item.parentId === parentId &&
      storedMessageRole(item.message) === "assistant" &&
      storedPortalRunId(item.message, item.runConfig) === input.runId;
  });
  if (existingAssistant) return false;
  const assistantId = trimOrUndefined(input.assistantMessageId) ??
    `portal-assistant-cancelled-${createHash("sha256")
      .update(`${input.threadId}:${parentId}:${input.runId}`)
      .digest("hex")
      .slice(0, 24)}`;
  await conversationRecords.appendMessage({
    threadId: input.threadId,
    parentId,
    message: portalStoppedAssistantMessage({
      id: assistantId,
      sessionId: input.sessionId,
      runId: input.runId,
      reason: input.reason
    }),
    runConfig: {
      channel: "portal",
      sessionId: input.sessionId,
      runId: input.runId,
      serverPersisted: true,
      stopped: true
    }
  });
  return true;
}

async function appendPortalFailedAssistant(input: {
  threadId: string;
  userMessageId: string;
  sessionId: string;
  runId: string;
  assistantMessageId?: string;
  autoRecoveryAttempted?: boolean;
}): Promise<boolean> {
  if (!portalRunMayPersist(input)) return false;
  const parentId = await requirePortalUserMessageParent({
    threadId: input.threadId,
    userMessageId: input.userMessageId
  });
  const repository = await conversationRecords.getMessageRepository(input.threadId);
  const existingAssistant = repository.messages.find((item) => {
    return item.parentId === parentId &&
      storedMessageRole(item.message) === "assistant" &&
      storedPortalRunId(item.message, item.runConfig) === input.runId;
  });
  if (existingAssistant) return false;
  const assistantId = trimOrUndefined(input.assistantMessageId) ??
    `portal-assistant-failed-${createHash("sha256")
      .update(`${input.threadId}:${parentId}:${input.runId}`)
      .digest("hex")
      .slice(0, 24)}`;
  await conversationRecords.appendMessage({
    threadId: input.threadId,
    parentId,
    message: portalFailedAssistantMessage({
      id: assistantId,
      sessionId: input.sessionId,
      runId: input.runId,
      autoRecoveryAttempted: input.autoRecoveryAttempted
    }),
    runConfig: {
      channel: "portal",
      sessionId: input.sessionId,
      runId: input.runId,
      serverPersisted: true,
      failed: true,
      autoRecoveryAttempted: input.autoRecoveryAttempted === true
    }
  });
  return true;
}

async function requirePortalUserMessageParent(input: {
  threadId: string;
  userMessageId: string;
}): Promise<string> {
  const userMessageId = trimOrUndefined(input.userMessageId);
  if (!userMessageId) throw new Error("Portal assistant persistence requires a user message id");
  const repository = await conversationRecords.getMessageRepository(input.threadId);
  const userMessage = findStoredMessageById(repository, userMessageId);
  if (!userMessage || storedMessageRole(userMessage.message) !== "user") {
    throw new Error("Portal assistant persistence requires an existing user message parent");
  }
  return userMessageId;
}

async function persistPortalAssistantMessageWithRetry(input: {
  threadId: string;
  userMessageId: string;
  sessionId: string;
  runId: string;
  assistantMessageId?: string;
  answerText: string;
  contentParts?: Record<string, unknown>[];
}): Promise<boolean> {
  const answerText = trimOrUndefined(input.answerText);
  if (!answerText) return false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (!portalRunMayPersist(input)) return false;
      const parentId = await requirePortalUserMessageParent({
        threadId: input.threadId,
        userMessageId: input.userMessageId
      });
      if (!portalRunMayPersist(input)) return false;
      const assistantId = trimOrUndefined(input.assistantMessageId) ??
        `portal-assistant-${createHash("sha256")
          .update(`${input.threadId}:${parentId}:${input.runId}`)
          .digest("hex")
          .slice(0, 24)}`;
      const message = portalAssistantMessage({
        id: assistantId,
        answerText,
        sessionId: input.sessionId,
        runId: input.runId,
        contentParts: input.contentParts
      });
      const normalizedMessage = await normalizePortalAssistantMessageAppend({
        threadId: input.threadId,
        parentId,
        message,
        runConfig: { channel: "portal", sessionId: input.sessionId, runId: input.runId, serverPersisted: true }
      });
      if (!portalRunMayPersist(input)) return false;
      await conversationRecords.appendMessage({
        threadId: input.threadId,
        parentId,
        message: normalizedMessage,
        runConfig: {
          channel: "portal",
          sessionId: input.sessionId,
          runId: input.runId,
          serverPersisted: true
        }
      });
      return true;
    } catch (error) {
      if (attempt >= 3) {
        console.warn("portal assistant persistence failed", {
          threadId: input.threadId,
          sessionId: input.sessionId,
          detail: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  return false;
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

function createUploadAttachmentId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function attachmentIdFromRelativePath(value: string): string {
  const normalized = normalizeRelativePath(value).replace(/^\/+/, "");
  const fileName = path.posix.basename(normalized);
  const match = fileName.match(/^\d+-([a-f0-9]{12})-/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function uploadDisplayNameFromStoredPath(filePath: string): string {
  const fileName = path.basename(filePath);
  const match = fileName.match(/^\d+-[a-f0-9]{12}-(.+)$/i);
  return sanitizeUploadFilename(match?.[1] || fileName);
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

async function resolveExistingThreadFileAbsolutePath(input: {
  workspacePath: string;
  threadId: string;
  relativePath?: string;
  filePath?: string;
}): Promise<string> {
  if (!trimOrUndefined(input.relativePath)) {
    return resolveThreadFileAbsolutePath({
      workspacePath: input.workspacePath,
      uploadDir: getThreadWorkspaceUploadDir(input.workspacePath, input.threadId),
      filePath: input.filePath
    });
  }

  let firstCandidate: string | undefined;
  for (const uploadDir of getThreadWorkspaceUploadDirs(input.workspacePath, input.threadId)) {
    const candidate = resolveThreadFileAbsolutePath({
      workspacePath: input.workspacePath,
      uploadDir,
      relativePath: input.relativePath
    });
    firstCandidate ??= candidate;
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isFile()) {
      return candidate;
    }
  }
  return firstCandidate ?? resolveThreadFileAbsolutePath({
    workspacePath: input.workspacePath,
    uploadDir: getThreadWorkspaceUploadDir(input.workspacePath, input.threadId),
    relativePath: input.relativePath
  });
}

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
  ".mp4": "video/mp4",
  ".srt": "application/x-subrip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

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
    workspace_file_id: artifact.workspaceFileId ?? null,
    workspace_file_version_id: artifact.workspaceFileVersionId ?? null,
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

function artifactContentPartForArtifacts(
  artifacts: ThreadArtifactRecord[],
  policy: ResolvedArtifactAccessPolicy,
  at = new Date()
): Record<string, unknown> | undefined {
  const changes: Record<string, unknown>[] = [];
  for (const artifact of artifacts) {
    const filePath = normalizeArtifactRelativePath(artifact.relativePath);
    if (!filePath) continue;
    const canPreview = policy.previewEnabled && artifact.previewStatus === "ready";
    const canDownload = policy.downloadEnabled && artifact.downloadStatus === "ready";
    if (!canPreview && !canDownload) continue;
    const change: Record<string, unknown> = {
      path: filePath,
      kind: "ready",
      artifact_id: artifact.id,
      workspace_file_id: artifact.workspaceFileId ?? null,
      workspace_file_version_id: artifact.workspaceFileVersionId ?? null,
      preview_status: artifact.previewStatus,
      download_status: artifact.downloadStatus,
      can_preview: canPreview,
      can_download: canDownload
    };
    if (artifact.blockedReason) change.blocked_reason = artifact.blockedReason;
    changes.push(change);
  }
  if (changes.length === 0) return undefined;
  return {
    type: "data",
    name: "codex_file_change",
    data: {
      at: at.toISOString(),
      artifact_only: true,
      changes
    }
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
  if (!policy.allowedExtensions.includes("*") && (!extension || !policy.allowedExtensions.includes(extension))) {
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

type ArtifactFileInspection = {
  missing: boolean;
  updating: boolean;
  sizeBytes?: number;
  modifiedAt?: Date;
  fileBuffer?: Buffer;
  checksum?: string;
  blockedReason?: string;
};

async function inspectArtifactFileForPolicy(input: {
  absolutePath: string;
  relativePath: string;
  policy: ResolvedArtifactAccessPolicy;
  approvedChecksum?: string;
}): Promise<ArtifactFileInspection> {
  const statBefore = await fs.stat(input.absolutePath).catch(() => null);
  if (!statBefore || !statBefore.isFile()) {
    return { missing: true, updating: false };
  }

  let blockedReason =
    detectBlockedArtifactPath(input.relativePath, input.policy) ||
    (statBefore.size > input.policy.maxFileBytes ? "File is larger than the artifact size limit" : undefined);
  let fileBuffer: Buffer | undefined;
  let checksum: string | undefined;
  if (!blockedReason || input.policy.blockKnowledgeSetCopies) {
    fileBuffer = await fs.readFile(input.absolutePath).catch(() => undefined);
    if (!fileBuffer) return { missing: true, updating: false };
    const statAfter = await fs.stat(input.absolutePath).catch(() => null);
    if (
      !statAfter ||
      !statAfter.isFile() ||
      statAfter.size !== statBefore.size ||
      statAfter.mtimeMs !== statBefore.mtimeMs
    ) {
      return { missing: false, updating: true };
    }
    checksum = createHash("sha256").update(fileBuffer).digest("hex");
  }

  const contentAlreadyApproved = Boolean(checksum && checksum === trimOrUndefined(input.approvedChecksum));
  if (
    !blockedReason &&
    !contentAlreadyApproved &&
    input.policy.blockKnowledgeSetCopies &&
    checksum &&
    await checksumExistsInKnowledgeSets(checksum)
  ) {
    blockedReason = "File matches a managed knowledge-set source file";
  }
  const extension = extensionForArtifact(input.relativePath);
  if (
    !blockedReason &&
    !contentAlreadyApproved &&
    input.policy.secretScanEnabled &&
    fileBuffer &&
    ARTIFACT_TEXT_SCAN_EXTENSIONS.has(extension) &&
    fileBuffer.length <= 2 * 1024 * 1024
  ) {
    blockedReason = detectSecretLikeContent(fileBuffer);
  }

  return {
    missing: false,
    updating: false,
    sizeBytes: statBefore.size,
    modifiedAt: statBefore.mtime,
    fileBuffer,
    checksum,
    blockedReason
  };
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

  const thread = input.currentUser.userType === "service"
    ? await threads.get(threadId, input.currentUser.organizationId)
    : await threads.getOwned(threadId, input.currentUser.id, input.currentUser.organizationId);
  if (!thread) return [];
  if (
    input.currentUser.userType === "service" &&
    (
      trimOrUndefined(input.session.threadId) !== thread.id ||
      (
        trimOrUndefined(input.session.userId)
          ? trimOrUndefined(input.session.userId) !== input.currentUser.id
          : !isActionConnectorRuntimeOwner(input.session, input.currentUser)
      )
    )
  ) return [];

  return await registerGeneratedArtifactsForThread({
    actor: input.currentUser,
    session: input.session,
    thread,
    changes: input.changes,
    answerText: input.answerText,
    changedAfter: input.changedAfter
  });
}

function serviceArtifactActorForThread(thread: ThreadRecord, session?: SessionRecord): CurrentActor {
  return {
    id: trimOrUndefined(thread.userId) ?? trimOrUndefined(session?.userId) ?? `service:${thread.id}`,
    userType: trimOrUndefined(thread.userId ?? session?.userId) ? undefined : "service",
    role: trimOrUndefined(thread.userId ?? session?.userId) ? undefined : "system",
    organizationId: trimOrUndefined(thread.organizationId) ?? trimOrUndefined(session?.organizationId) ?? "system"
  };
}

async function registerGeneratedArtifactsForRuntimeSession(input: {
  sessionId?: string;
  threadId?: string;
  changes: RuntimeFileChange[];
  answerText?: string;
  changedAfter?: Date;
}): Promise<Record<string, unknown>[]> {
  const sessionId = trimOrUndefined(input.sessionId);
  if (!sessionId) return [];
  const session = await sessions.get(sessionId);
  if (!session) return [];

  const threadId = trimOrUndefined(input.threadId) ?? trimOrUndefined(session.threadId);
  if (!threadId) return [];
  const thread = await threads.get(threadId, session.organizationId);
  if (!thread) return [];

  const actor = serviceArtifactActorForThread(thread, session);
  const artifacts = await registerGeneratedArtifactsForThread({
    actor,
    session,
    thread,
    changes: input.changes,
    answerText: input.answerText,
    changedAfter: input.changedAfter
  });
  if (artifacts.length === 0) return [];

  const policy = await resolveArtifactPolicyForActor(actor);
  const contentPart = artifactContentPartForArtifacts(artifacts, policy);
  return contentPart ? [contentPart] : [];
}

async function registerGeneratedArtifactsForThread(input: {
  actor: CurrentActor;
  session: SessionRecord;
  thread: ThreadRecord;
  changes: RuntimeFileChange[];
  answerText?: string;
  changedAfter?: Date;
}): Promise<ThreadArtifactRecord[]> {
  const threadId = trimOrUndefined(input.thread.id);
  const workspacePath = trimOrUndefined(input.session.workspace) ?? trimOrUndefined(input.thread.workspace);
  if (!threadId || !workspacePath) return [];

  const policy = await resolveArtifactPolicyForActor(input.actor);
  if (!policy.enabled || !policy.autoRegisterGeneratedFiles) return [];

  const codexHome = codexHomeFromRunConfig(input.session.codexRunConfig);
  const codexGeneratedImageChanges = await collectRuntimeGeneratedImageChanges({
    codexHome,
    codexThreadId: input.session.codexThreadId,
    changedAfter: input.changedAfter
  });
  const runtimeChanges = await materializeRuntimeGeneratedImageChanges({
    changes: [...input.changes, ...codexGeneratedImageChanges],
    workspacePath,
    codexHome
  });

  const referencedChanges = extractReferencedArtifactChanges({
    text: input.answerText ?? "",
    workspacePath
  });
  const publishedChanges = await collectPublishedArtifactChanges({
    workspacePath,
    changedAfter: input.changedAfter
  });
  const scannedChanges = await collectGeneratedArtifactChanges({
    workspacePath,
    changedAfter: input.changedAfter,
    allowedExtensions: policy.allowedExtensions
  });
  const candidates = selectGeneratedArtifactChanges({
    publishedChanges,
    referencedChanges,
    runtimeChanges,
    scannedChanges
  });
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

    const inspection = await inspectArtifactFileForPolicy({
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      policy
    });
    if (inspection.missing || inspection.updating || inspection.sizeBytes === undefined) continue;

    const status = inspection.blockedReason ? "blocked" : "ready";
    const artifactMetadata: Record<string, unknown> = {
      changeKind: change.kind,
      originalPath: change.path
    };
    if (change.sourcePath) artifactMetadata.sourcePath = change.sourcePath;
    if (change.metadata) {
      for (const [key, value] of Object.entries(change.metadata)) {
        if (value !== undefined) artifactMetadata[key] = value;
      }
    }
    const displayName =
      trimOrUndefined(
        typeof change.metadata?.displayName === "string" ? change.metadata.displayName : undefined
      ) ?? path.basename(resolved.relativePath);
    const previousArtifact = await threadArtifacts.getByThreadPath(threadId, resolved.relativePath);
    let artifact = await threadArtifacts.upsertForThreadPath({
      organizationId: input.thread.organizationId ?? input.actor.organizationId,
      threadId,
      userId: input.thread.userId ?? input.actor.id,
      source: "assistant_generated",
      relativePath: resolved.relativePath,
      displayName,
      mimeType: mimeTypeForArtifactPath(resolved.relativePath),
      sizeBytes: inspection.sizeBytes,
      checksum: inspection.checksum,
      previewStatus: status,
      downloadStatus: status,
      blockedReason: inspection.blockedReason,
      metadata: artifactMetadata,
      expiresAt: addDays(new Date(), policy.retentionDays)
    });

    const ownerUserId = trimOrUndefined(input.thread.userId);
    if (status === "ready" && inspection.fileBuffer && ownerUserId) {
      const workspaceActor = {
        userId: ownerUserId,
        organizationId: trimOrUndefined(input.thread.organizationId) ?? input.actor.organizationId,
        securityDomainId: trimOrUndefined(input.thread.securityDomainId)
      };
      try {
        const scope = await portalWorkspaces.resolveTaskScope({
          actor: workspaceActor,
          folderId: input.thread.workspaceFolderId
        });
        if (
          input.thread.userWorkspaceId !== scope.workspaceId ||
          input.thread.workspaceFolderId !== scope.folderId
        ) {
          await threads.update(threadId, {
            userWorkspaceId: scope.workspaceId,
            workspaceFolderId: scope.folderId
          });
        }
        const outputTarget = await portalWorkspaces.resolveTaskOutputTarget({
          actor: workspaceActor,
          threadId,
          relativePath: resolved.relativePath
        });
        const preferredFileId =
          outputTarget.preferredFileId ??
          previousArtifact?.workspaceFileId ??
          await portalWorkspaces.latestBoundFileForThreadName({
            actor: workspaceActor,
            threadId,
            name: displayName
          });
        const beforeVersionId =
          outputTarget.previousVersionId ??
          previousArtifact?.workspaceFileVersionId;
        const saved = await portalWorkspaces.saveFile({
          actor: workspaceActor,
          parentId: outputTarget.parentId,
          name: displayName,
          content: inspection.fileBuffer,
          mimeType: mimeTypeForArtifactPath(resolved.relativePath),
          conflict: preferredFileId ? "replace" : "keep_both",
          createdByType: "agent",
          threadId,
          role: "output",
          preferredFileId
        });
        await portalWorkspaces.recordAppliedChange({
          actor: workspaceActor,
          threadId,
          fileId: saved.file.id,
          versionId: saved.version.id,
          kind: beforeVersionId ? "update" : "create",
          beforeVersionId,
          summary: beforeVersionId
            ? `智能体更新了 ${saved.file.name}`
            : `智能体创建了 ${saved.file.name}`
        });
        artifact = await threadArtifacts.linkWorkspaceFile(
          artifact.id,
          saved.file.id,
          saved.version.id
        );
      } catch (error) {
        console.warn(
          `[workspace] Failed to persist generated artifact ${artifact.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    registered.push(artifact);
  }

  return registered;
}

async function sendThreadArtifactContent(input: {
  currentUser: CurrentActor;
  threadId: string;
  artifactId?: string;
  filePath?: string;
  disposition?: "inline" | "attachment";
  preview?: "pdf" | StructuredPreviewMode;
  previewQuery?: Record<string, unknown>;
  enforcePortalSecurityDomain?: boolean;
  authorizedThread?: ThreadRecord;
  req: Request;
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
    input.authorizedThread
      ? Promise.resolve(input.authorizedThread.id === threadId ? input.authorizedThread : undefined)
      : input.enforcePortalSecurityDomain
        ? getPortalReadableThread(threadId, input.currentUser)
        : threads.getOwned(threadId, input.currentUser.id, input.currentUser.organizationId),
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

  let artifact: ThreadArtifactRecord | undefined;
  if (artifactId) {
    artifact = await threadArtifacts.getForThread(threadId, artifactId);
  } else if (filePath) {
    const workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      input.res.status(404).json({ detail: "Thread workspace does not exist" });
      return;
    }
    const resolvedForLookup = resolveWorkspaceFilePath({ workspacePath, filePath });
    artifact = await threadArtifacts.getByThreadPath(threadId, resolvedForLookup.relativePath);
  }

  if (!artifact) {
    input.res.status(404).json({ detail: "Artifact does not exist" });
    return;
  }

  if (artifact.expiresAt) {
    const expiresAt = new Date(artifact.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      await recordAccess(artifact.id, "denied", { reason: "artifact_expired" });
      input.res.status(410).json({ detail: "This file is no longer available. Ask the assistant to generate it again." });
      return;
    }
  }

  if (artifact.workspaceFileId) {
    if (
      artifact.blockedReason ||
      (actionType === "download" ? artifact.downloadStatus : artifact.previewStatus) !== "ready"
    ) {
      await recordAccess(artifact.id, "denied", {
        reason: artifact.blockedReason ?? "artifact_not_ready",
        stable_workspace_file: true
      });
      input.res.status(403).json({
        detail: artifact.blockedReason
          ? `This file cannot be downloaded: ${artifact.blockedReason}`
          : "This file is not available"
      });
      return;
    }
    try {
      const stableFile = await portalWorkspaces.getFile({
        actor: {
          userId: thread.userId ?? input.currentUser.id,
          organizationId: input.currentUser.organizationId,
          securityDomainId: thread.securityDomainId
        },
        fileId: artifact.workspaceFileId,
        versionId: artifact.workspaceFileVersionId
      });
      const fileName = artifact.displayName || stableFile.file.name;
      if (
        actionType === "preview" &&
        await sendOfficePdfPreview(input.res, {
          requested: input.preview === "pdf",
          fileName,
          content: stableFile.content,
          fingerprint: stableFile.version.checksum
        })
      ) {
        await recordAccess(artifact.id, "success", {
          disposition: actionType,
          stable_workspace_file: true,
          workspace_file_id: stableFile.file.id,
          workspace_file_version_id: stableFile.version.id,
          checksum: stableFile.version.checksum
        });
        return;
      }
      if (
        actionType === "preview" &&
        await sendStructuredPreview(input.res, {
          requested: input.preview === "pdf" ? undefined : input.preview,
          fileName,
          content: stableFile.content,
          mimeType: stableFile.version.mimeType || stableFile.file.mimeType || artifact.mimeType || "",
          query: input.previewQuery
        })
      ) {
        await recordAccess(artifact.id, "success", {
          disposition: actionType,
          stable_workspace_file: true,
          workspace_file_id: stableFile.file.id,
          workspace_file_version_id: stableFile.version.id,
          checksum: stableFile.version.checksum
        });
        return;
      }
      const registeredMimeType =
        stableFile.version.mimeType || stableFile.file.mimeType || artifact.mimeType || "";
      input.res.type(
        registeredMimeType && registeredMimeType !== "application/octet-stream"
          ? registeredMimeType
          : path.extname(fileName) || await detectedContentType({ fileName, content: stableFile.content })
      );
      const delivery = await sendBufferContent({
        req: input.req,
        res: input.res,
        content: stableFile.content,
        contentType: String(input.res.getHeader("Content-Type") || "application/octet-stream"),
        contentDisposition:
          `${actionType === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`
      });
      await recordAccess(artifact.id, delivery.completed ? "success" : "incomplete", {
        disposition: actionType,
        stable_workspace_file: true,
        workspace_file_id: stableFile.file.id,
        workspace_file_version_id: stableFile.version.id,
        checksum: stableFile.version.checksum,
        partial: delivery.partial,
        bytes_sent: delivery.bytesSent
      });
      return;
    } catch (error) {
      if (input.res.headersSent) {
        console.warn(`[workspace] Stable artifact ${artifact.id} delivery did not complete cleanly:`, {
          detail: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      console.warn(`[workspace] Stable artifact ${artifact.id} is unavailable; trying the legacy path:`, {
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const workspacePath = trimOrUndefined(thread.workspace);
  if (!workspacePath) {
    input.res.status(404).json({ detail: "Thread workspace does not exist" });
    return;
  }
  const resolved = resolveWorkspaceFilePath({ workspacePath, filePath: artifact.relativePath });
  if (resolved.relativePath !== artifact.relativePath) {
    await recordAccess(artifact.id, "denied", { reason: "artifact_path_mismatch" });
    input.res.status(403).json({ detail: "Artifact path is invalid" });
    return;
  }

  const inspection = await inspectArtifactFileForPolicy({
    absolutePath: resolved.absolutePath,
    relativePath: artifact.relativePath,
    policy,
    approvedChecksum:
      artifact.previewStatus === "ready" && artifact.downloadStatus === "ready" && !artifact.blockedReason
        ? artifact.checksum
        : undefined
  });
  if (inspection.missing) {
    input.res.status(404).json({ detail: "Artifact file does not exist" });
    return;
  }
  if (inspection.updating) {
    await recordAccess(artifact.id, "denied", { reason: "artifact_changed_during_download" });
    input.res.status(409).json({ detail: "This file is still being updated. Try the download again in a moment." });
    return;
  }

  const currentChecksum = inspection.checksum;
  const versionChanged = Boolean(currentChecksum && currentChecksum !== artifact.checksum);
  if (versionChanged && hasActiveRuntimeTurnForThread(threadId)) {
    await recordAccess(artifact.id, "denied", { reason: "artifact_is_updating" });
    input.res.status(409).json({
      detail: "This file is still being updated. Try the download again when the current response is complete."
    });
    return;
  }
  const currentStatus = inspection.blockedReason ? "blocked" : "ready";
  const registeredStatus = actionType === "download" ? artifact.downloadStatus : artifact.previewStatus;
  const registrationNeedsRefresh =
    versionChanged ||
    artifact.sizeBytes !== inspection.sizeBytes ||
    registeredStatus !== currentStatus ||
    artifact.blockedReason !== inspection.blockedReason;
  if (registrationNeedsRefresh) {
    const previousMetadata = asRecord(artifact.metadata) ?? {};
    artifact = await threadArtifacts.upsertForThreadPath({
      organizationId: artifact.organizationId ?? thread.organizationId ?? input.currentUser.organizationId,
      threadId,
      userId: artifact.userId ?? thread.userId ?? input.currentUser.id,
      source: artifact.source,
      relativePath: artifact.relativePath,
      displayName: artifact.displayName,
      mimeType: mimeTypeForArtifactPath(artifact.relativePath),
      sizeBytes: inspection.sizeBytes,
      checksum: currentChecksum,
      previewStatus: currentStatus,
      downloadStatus: currentStatus,
      blockedReason: inspection.blockedReason,
      metadata: {
        ...previousMetadata,
        latestVersionApprovedAt: new Date().toISOString(),
        latestFileModifiedAt: inspection.modifiedAt?.toISOString(),
        refreshedOnAccess: true
      },
      expiresAt: versionChanged ? addDays(new Date(), policy.retentionDays) : artifact.expiresAt ? new Date(artifact.expiresAt) : undefined
    });
  }

  if (inspection.blockedReason) {
    await recordAccess(artifact.id, "denied", {
      reason: inspection.blockedReason,
      latest_version_revalidated: registrationNeedsRefresh
    });
    input.res.status(403).json({ detail: `The latest version cannot be downloaded: ${inspection.blockedReason}` });
    return;
  }
  if (!inspection.fileBuffer) {
    input.res.status(409).json({ detail: "This file is not ready to download yet. Try again in a moment." });
    return;
  }
  const fileName = artifact.displayName || path.basename(resolved.absolutePath);
  if (
    actionType === "preview" &&
    await sendOfficePdfPreview(input.res, {
      requested: input.preview === "pdf",
      fileName,
      content: inspection.fileBuffer,
      fingerprint: currentChecksum
    })
  ) {
    await recordAccess(artifact.id, "success", {
      disposition: actionType,
      latest_version_revalidated: registrationNeedsRefresh,
      checksum: currentChecksum
    });
    return;
  }
  if (
    actionType === "preview" &&
    await sendStructuredPreview(input.res, {
      requested: input.preview === "pdf" ? undefined : input.preview,
      fileName,
      content: inspection.fileBuffer,
      mimeType: artifact.mimeType || "",
      query: input.previewQuery
    })
  ) {
    await recordAccess(artifact.id, "success", {
      disposition: actionType,
      latest_version_revalidated: registrationNeedsRefresh,
      checksum: currentChecksum
    });
    return;
  }
  if (inspection.modifiedAt) input.res.setHeader("X-Artifact-Updated-At", inspection.modifiedAt.toISOString());
  input.res.type(
    artifact.mimeType && artifact.mimeType !== "application/octet-stream"
      ? artifact.mimeType
      : path.extname(fileName) || await detectedContentType({ fileName, content: inspection.fileBuffer })
  );
  const delivery = await sendFileContent({
    req: input.req,
    res: input.res,
    absolutePath: resolved.absolutePath,
    contentType: String(input.res.getHeader("Content-Type") || "application/octet-stream"),
    contentDisposition:
      `${actionType === "download" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`
  });
  await recordAccess(artifact.id, delivery.completed ? "success" : "incomplete", {
    disposition: actionType,
    latest_version_revalidated: registrationNeedsRefresh,
    checksum: currentChecksum,
    partial: delivery.partial,
    bytes_sent: delivery.bytesSent
  });
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

const PORTAL_THREAD_ATTACHMENT_MAX_BYTES = 512 * 1024 * 1024;

const uploadRawParser = express.raw({
  type: () => true,
  limit: PORTAL_THREAD_ATTACHMENT_MAX_BYTES
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

function isExactOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (!allowedOrigins.length) return false;
  try {
    const normalized = new URL(origin).origin;
    return allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin === normalized;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin: string, requestPath = ""): boolean {
  if (
    requestPath.startsWith("/api/action-connectors/") &&
    isExactOriginAllowed(origin, appConfig.actionConnectorAllowedOrigins)
  ) {
    return true;
  }

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

function corsOptionsForRequest(req: Request): CorsOptions {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || isAllowedCorsOrigin(origin, req.path)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  };
}

app.use(cors((req: Request, callback) => callback(null, corsOptionsForRequest(req))));
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
app.post(
  "/api/integrations/stripe/webhook",
  express.raw({
    type: () => true,
    limit: "1mb"
  }),
  async (req: Request, res: Response) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
      const result = await billingService.handleStripeWebhook(rawBody, req.header("stripe-signature") ?? undefined);
      res.json(result);
    } catch (error) {
      res.status(400).json({ detail: error instanceof Error ? error.message : "Stripe webhook failed" });
    }
  }
);
app.use(express.json({ limit: "1mb" }));

const requireServiceToken = createServiceTokenMiddleware(appConfig.token);

function isLocalNetworkAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function isLocalHostHeader(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:")
  );
}

function isLocalDeployStatusRequest(req: Request): boolean {
  if (!isLocalHostHeader(req.header("host"))) {
    return false;
  }
  const forwardedHeader = req.header("x-forwarded-for") ?? "";
  const forwardedAddresses = forwardedHeader
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (forwardedAddresses.some((address) => !isLocalNetworkAddress(address))) {
    return false;
  }
  return isLocalNetworkAddress(req.ip) || isLocalNetworkAddress(req.socket.remoteAddress);
}

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/internal/deploy/drain-status", async (req: Request, res: Response) => {
  if (!isLocalDeployStatusRequest(req)) {
    res.status(404).json({ detail: "Not found" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const drainReason = await getDeploymentDrainReason();
  res.json({
    ok: true,
    now: new Date().toISOString(),
    draining: Boolean(drainReason),
    ...activeRuntimeTurnStatus(),
    active_threads: activeThreadStatus()
  });
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

app.get("/public-api/external-web-access", async (_req: Request, res: Response) => {
  try {
    const state = await externalWebAccess.getState();
    res.setHeader("Cache-Control", "no-store");
    res.json({ maintenance_enabled: state.maintenanceEnabled });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read external Web access state";
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

app.use(
  "/public-api/access-requests",
  createPublicExternalWebGate(externalWebAccess),
  createPublicAccessRequestRouter(accessRequestService)
);

app.locals.resolveCodexSkillThreadPath = async (input: {
  req: Request;
  threadId: string;
  requestedPath: string;
}): Promise<string> => {
  const currentUser = currentActorFromRequest(input.req);
  const thread = await getPortalOwnedThread(input.threadId, currentUser);
  if (!thread) {
    throw new Error("Thread does not exist");
  }
  const workspacePath = trimOrUndefined(thread.workspace);
  if (!workspacePath) {
    throw new Error("Thread workspace does not exist");
  }
  return resolveThreadFileAbsolutePath({
    workspacePath,
    uploadDir: getThreadWorkspaceUploadDir(workspacePath, input.threadId),
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
crestIntegrationRouter.post("/chat/cancel", async (req: Request, res: Response) => {
  await handleCrestChatCancel(req, res);
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
    systemSettings,
    externalWebAccess
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
    isThreadActive: isThreadActiveForAdmin,
    sessions: {
      countActive: async () => liveRuntimeThreads.size
    },
    syncService: orgSyncService,
    orgSyncConfig: appConfig.orgSync,
    broadcastRouter: createBroadcastAdminRouter({
      broadcasts,
      service: broadcastService,
      requirePermission
    }),
    trainingCatalogRouter: createTrainingCatalogAdminRouter({
      service: trainingCatalog,
      requirePermission
    }),
    recoveryRouter: createConversationRecoveryRouter(conversationRecovery),
    productFeedbackReply,
    securityDomains,
    securityDomainAccess,
    conversationSecurityReviewTest: (input) => conversationSecurityReview.testReview(input)
  }),
  integrationCenterRouter: createIntegrationCenterRouter({
    service: integrationCenter,
    requirePermission,
    dingtalkBot: {
      getStatus: (instanceId) => dingtalkBotStream.getStatuses(instanceId),
      restart: (instanceId) => dingtalkBotStream.restart(instanceId),
      listRecentConversations: (instanceId, take) => conversationRecords.listRecentExternalConversations(instanceId, take)
    }
  }),
  monitoringAdminRouter: createMonitoringRouter({
    requirePermission,
    resourceAccessLogs: resourceAccessLogRepository,
    usageLedger,
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
    nativeCodexSkills,
    modelCatalog: codexModelCatalog
  }),
  codexMemoryAdminRouter: createCodexMemoryAdminRouter({
    sessionHomeRoot: appConfig.codex.sessionHomeRoot,
    requirePermission,
    llmSecretStore: {
      getState: getCodexMemoryLlmSecretStatus,
      update: updateCodexMemoryLlmSecret
    },
    enterpriseContext,
    getPythonRuntimeStatus: async () =>
      inspectSharedPythonRuntime({
        settings:
          (await codexProviders.getPublishedSystemSettings())?.payload.pythonRuntime ??
          createDefaultSystemSettingsPayload().pythonRuntime,
        sessionWorkspaceRoot: appConfig.sessionWorkspaceRoot
      }),
    backfill: codexMemoryBackfill,
    users,
    agentModes,
    listIntegrationInstancesByIds: async (ids) => {
      if (!ids.length) return [];
      return db.integrationInstance.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          type: true,
          slug: true,
          name: true,
          status: true
        }
      });
    }
  }),
  adminSkillRouter: createAdminCodexSkillRouter(codexSkillService),
  skillCatalogAdminRouter: createSkillCatalogAdminRouter(skillCatalog),
  portalRouter: createPortalRouter({
    runtimeOptions: portalRuntimeOptions,
    modelCatalog: codexModelCatalog,
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId),
    productFeedback,
    customerExperienceIssues,
    subscriptionEntitlements
  }),
  resourcesPortalRouter: createResourcesPortalRouter({
    knowledgeSets,
    storage: knowledgeSetStorage,
    policies: policyService,
    listDepartmentIdsForUser: (userId) => listDepartmentSubjectIdsForUser(userId)
  }),
  portalSkillRouter: createPortalCodexSkillRouter(codexSkillService),
  externalWebAccessMiddleware: createAuthenticatedExternalWebGate(externalWebAccess),
  serviceTokenMiddleware: requireServiceToken,
  zendeskRouter: createZendeskAdminRouter(zendesk),
  crestRouter: crestIntegrationRouter,
  actionConnectorProvisionRouter: createActionConnectorProvisionRouter({
    db: db as unknown as IntegrationInstanceRepositoryDb,
    attachments: actionConnectorAttachments,
    getConversationMessages: getActionConnectorConversationMessages,
    cancelRun: cancelActionConnectorRun,
    sendArtifact: sendActionConnectorArtifact
  }),
  actionConnectorRuntimeRouter: createActionConnectorRuntimeRouter({
    db: db as unknown as IntegrationInstanceRepositoryDb,
    codexRunner: runActionConnectorCodexChat
  })
});

app.use(
  "/api/portal/workspace",
  createPortalWorkspaceRouter({
    service: portalWorkspaces,
    async resolveActor(req) {
      const currentUser = currentActorFromRequest(req);
      return {
        userId: currentUser.id,
        organizationId: currentUser.organizationId,
        securityDomainId: await portalSecurityDomainIdForActor(currentUser)
      };
    }
  })
);

app.use(
  "/api/portal/training",
  createTrainingCatalogRouter({
    service: trainingCatalog,
    async resolveViewer(req) {
      const currentUser = currentActorFromRequest(req);
      return {
        userId: currentUser.id,
        organizationId: currentUser.organizationId,
        organizationType: currentUser.organizationType || ""
      };
    }
  })
);

app.use("/api/admin", createAdminBillingRouter(billingService));
app.use(
  "/api/portal",
  createPortalBillingRouter(billingService, {
    subscriptionEntitlements
  })
);

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
    createRuntimeForRequest: async (input) => {
      const [providerSnapshot, runtimeLaunch] = await Promise.all([
        resolveProviderSnapshot(),
        resolveRuntimeLaunchConfig({
          workspace: input.workspace,
          codexRunConfig: input.codexRunConfig
        })
      ]);
      return createRuntimeForProviderSnapshot(providerSnapshot, {
        configOverrides: runtimeLaunch.configOverrides,
        envOverrides: {
          ...(runtimeLaunch.envOverrides ?? {}),
          CODEX_HOME: input.codexHome
        }
      });
    },
    materializeCodexHome: materializeSharedIntegrationCodexHomeForRunConfig,
    integrationsDb: db as never,
    agentModes,
    runProfiles,
    knowledgeSets,
    knowledgeSetStorage,
    usageRecorder,
    codexExecution,
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

    const thread = await getPortalOwnedThread(threadId, currentUser);
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
      const allocated = await allocateUserAgentWorkspacePath({
        currentUser,
        modeHint: modeIdFromRunConfig(thread.codexRunConfig),
        securityDomainId: thread.securityDomainId,
        threadId
      });
      workspacePath = allocated.workspacePath;
      await applyWorkspaceAgentsMdForMode(allocated.modeId, workspacePath);
      await threads.update(threadId, { workspace: workspacePath });
    }

    const uploadDir = getThreadWorkspaceUploadDir(workspacePath, threadId);
    await fs.mkdir(uploadDir, { recursive: true });

    const id = createUploadAttachmentId();
    const storedName = `${Date.now()}-${id}-${safeName}`;
    const absolutePath = path.join(uploadDir, storedName);
    await fs.writeFile(absolutePath, payload);
    const workspaceActor = {
      userId: currentUser.id,
      organizationId: currentUser.organizationId,
      securityDomainId: thread.securityDomainId
    };
    const scope = await portalWorkspaces.resolveTaskScope({
      actor: workspaceActor,
      folderId: thread.workspaceFolderId
    });
    if (
      thread.userWorkspaceId !== scope.workspaceId ||
      thread.workspaceFolderId !== scope.folderId
    ) {
      await threads.update(threadId, {
        userWorkspaceId: scope.workspaceId,
        workspaceFolderId: scope.folderId
      });
    }
    const savedWorkspaceFile = await portalWorkspaces.saveFile({
      actor: workspaceActor,
      parentId: scope.folderId,
      name: safeName,
      content: payload,
      mimeType,
      conflict: "keep_both",
      createdByType: "user",
      threadId,
      role: "input"
    });

    const relativePath = normalizeRelativePath(path.relative(uploadDir, absolutePath));
    res.json({
      attachment: {
        id,
        name: safeName,
        mime_type: mimeType,
        bytes: payload.length,
        path: normalizeRelativePath(path.relative(workspacePath, absolutePath)),
        relative_path: relativePath,
        workspace_file_id: savedWorkspaceFile.file.id,
        workspace_file_version_id: savedWorkspaceFile.version.id
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to upload attachment";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/attachments/:attachmentId/content", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const attachmentId = String(req.params.attachmentId || "").trim().toLowerCase();
    if (!threadId) {
      res.status(400).json({ detail: "threadId is required" });
      return;
    }
    if (!/^[a-f0-9]{12}$/i.test(attachmentId)) {
      res.status(400).json({ detail: "attachmentId is invalid" });
      return;
    }

    const query = attachmentContentQuerySchema.parse({
      relative_path: typeof req.query.relative_path === "string" ? req.query.relative_path : undefined
    });

    const thread = await getPortalReadableThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    if (isExternalActor(currentUser)) {
      res.status(403).json({ detail: "External users cannot download source attachments" });
      return;
    }

    if (attachmentIdFromRelativePath(query.relative_path) !== attachmentId) {
      res.status(403).json({ detail: "Attachment id does not match the requested file" });
      return;
    }

    const workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      res.status(404).json({ detail: "Thread workspace does not exist" });
      return;
    }

    const absolutePath = await resolveExistingThreadFileAbsolutePath({
      workspacePath,
      threadId,
      relativePath: query.relative_path
    });

    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ detail: "Attachment file does not exist" });
      return;
    }

    const fileName = uploadDisplayNameFromStoredPath(absolutePath);
    const ext = path.extname(fileName);
    const fileBuffer = await fs.readFile(absolutePath);

    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type(ext || "application/octet-stream");
    res.status(200).send(fileBuffer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to download attachment";
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
      path: typeof req.query.path === "string" ? req.query.path : undefined,
      preview: typeof req.query.preview === "string" ? req.query.preview : undefined,
      offset: typeof req.query.offset === "string" ? req.query.offset : undefined,
      limit: typeof req.query.limit === "string" ? req.query.limit : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      sheet: typeof req.query.sheet === "string" ? req.query.sheet : undefined,
      row_offset: typeof req.query.row_offset === "string" ? req.query.row_offset : undefined,
      row_limit: typeof req.query.row_limit === "string" ? req.query.row_limit : undefined,
      column_offset: typeof req.query.column_offset === "string" ? req.query.column_offset : undefined,
      column_limit: typeof req.query.column_limit === "string" ? req.query.column_limit : undefined
    });

    const thread = await getPortalReadableThread(threadId, currentUser);
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

    const absolutePath = await resolveExistingThreadFileAbsolutePath({
      workspacePath,
      threadId,
      relativePath: query.relative_path,
      filePath: query.path
    });

    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.status(404).json({ detail: "File does not exist" });
      return;
    }

    const fileName = path.basename(absolutePath);
    if (
      await sendOfficePdfPreview(res, {
        requested: query.preview === "pdf",
        fileName,
        sourcePath: absolutePath
      })
    ) {
      return;
    }
    if (
      await sendStructuredPreview(res, {
        requested: query.preview === "pdf" ? undefined : query.preview,
        fileName,
        sourcePath: absolutePath,
        query
      })
    ) {
      return;
    }
    const ext = path.extname(fileName);
    const fileBuffer = await fs.readFile(absolutePath);

    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type(ext || await detectedContentType({ fileName, sourcePath: absolutePath }));
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

    const thread = await getPortalReadableThread(threadId, currentUser);
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
    const thread = await getPortalReadableThread(threadId, currentUser);
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
      disposition: typeof req.query.disposition === "string" ? req.query.disposition : undefined,
      preview: typeof req.query.preview === "string" ? req.query.preview : undefined,
      offset: typeof req.query.offset === "string" ? req.query.offset : undefined,
      limit: typeof req.query.limit === "string" ? req.query.limit : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      sheet: typeof req.query.sheet === "string" ? req.query.sheet : undefined,
      row_offset: typeof req.query.row_offset === "string" ? req.query.row_offset : undefined,
      row_limit: typeof req.query.row_limit === "string" ? req.query.row_limit : undefined,
      column_offset: typeof req.query.column_offset === "string" ? req.query.column_offset : undefined,
      column_limit: typeof req.query.column_limit === "string" ? req.query.column_limit : undefined
    });
    await sendThreadArtifactContent({
      currentUser,
      threadId,
      filePath: query.path,
      disposition: query.disposition,
      preview: query.preview,
      previewQuery: query,
      enforcePortalSecurityDomain: true,
      req,
      res
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read artifact";
    if (!res.headersSent) res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/visualizations/content", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const query = inlineVisualizationContentQuerySchema.parse({
      file: typeof req.query.file === "string" ? req.query.file : ""
    });
    const [thread, policy] = await Promise.all([
      getPortalReadableThread(threadId, currentUser),
      resolveArtifactPolicyForActor(currentUser)
    ]);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    if (!policy.enabled || !policy.previewEnabled) {
      res.status(403).json({ detail: "Artifact preview is disabled" });
      return;
    }
    const workspacePath = trimOrUndefined(thread.workspace);
    if (!workspacePath) {
      res.status(404).json({ detail: "Thread workspace does not exist" });
      return;
    }
    const artifacts = await threadArtifacts.listForThread(threadId);
    const artifact = selectInlineVisualizationArtifact(artifacts, query.file);
    if (!artifact) {
      res.status(404).json({ detail: "Visualization artifact does not exist" });
      return;
    }
    const { buffer, fileName } = await readInlineVisualizationArtifact({
      workspacePath,
      artifact,
      maxFileBytes: policy.maxFileBytes
    });
    const blockedReason =
      buffer.length <= 2 * 1024 * 1024 ? detectSecretLikeContent(buffer) : undefined;
    if (blockedReason) {
      await resourceAccessLogs.record({
        organizationId: currentUser.organizationId,
        userId: currentUser.id,
        threadId,
        resourceType: "thread_artifact",
        resourceId: artifact.id,
        actionType: "artifact.visualization_preview",
        resultStatus: "denied",
        metadata: { reason: blockedReason }
      });
      res.status(403).json({ detail: `Visualization preview is blocked: ${blockedReason}` });
      return;
    }
    await resourceAccessLogs.record({
      organizationId: currentUser.organizationId,
      userId: currentUser.id,
      threadId,
      resourceType: "thread_artifact",
      resourceId: artifact.id,
      actionType: "artifact.visualization_preview",
      resultStatus: "success",
      metadata: { protected_visualization_path: true }
    });
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.type("text/html; charset=utf-8");
    res.status(200).send(buffer);
  } catch (error) {
    const status = error instanceof InlineVisualizationArtifactError ? error.status : 400;
    const detail = error instanceof Error ? error.message : "Failed to read visualization";
    res.status(status).json({ detail });
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
      enforcePortalSecurityDomain: true,
      req,
      res
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read artifact";
    if (!res.headersSent) res.status(400).json({ detail });
  }
});

app.post("/api/session", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const securityDomainId = await portalSecurityDomainIdForActor(currentUser);
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
          const nextSourceCodexRunConfig = withoutInternalRuntimeMetadata(
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
            const ownedThread = await getPortalOwnedThread(existingForComparison.threadId, currentUser);
            if (!ownedThread) throw new Error("Thread does not exist");
            const existingWorkspace = trimOrUndefined(ownedThread.workspace) || trimOrUndefined(workspace);
            const scopedWorkspace = userAgentWorkspacePathForSelection({
              currentUser,
              selection,
              securityDomainId,
              threadId: ownedThread.id
            });
            const legacyScopedWorkspace = userAgentWorkspacePathForSelection({
              currentUser,
              selection,
              securityDomainId
            });
            workspace =
              ownedThread.securityDomainId &&
              existingWorkspace &&
              path.resolve(existingWorkspace) !== path.resolve(legacyScopedWorkspace) &&
              path.basename(path.resolve(existingWorkspace)) !==
                `thread-${sanitizePathSegment(ownedThread.id, "thread")}`
                ? legacyScopedWorkspace
                : existingWorkspace || scopedWorkspace;
            if (
              ownedThread.securityDomainId &&
              existingWorkspace &&
              path.resolve(existingWorkspace) !== path.resolve(workspace)
            ) {
              const existingStat = await fs.stat(existingWorkspace).catch(() => undefined);
              if (existingStat?.isDirectory()) {
                await fs.mkdir(workspace, { recursive: true });
                await fs.cp(existingWorkspace, workspace, { recursive: true, force: false, errorOnExist: false });
              }
            }
            await fs.mkdir(workspace, { recursive: true });
            if (ownedThread && trimOrUndefined(ownedThread.workspace) !== workspace) {
              await threads.update(existingForComparison.threadId, { workspace });
            }
          } else if (input.codex_run_config || !workspace || !modeId) {
            const allocated = await allocateUserAgentWorkspacePath({
              currentUser,
              modeHint,
              securityDomainId
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
          const materializedCodexHome = await materializeUserAgentCodexHomeForRunConfig({
            currentUser,
            modeId,
            codexRunConfig: runtimeCodexRunConfig
          });
          if (existingForComparison.threadId && trimOrUndefined(workspace)) {
            await fs.mkdir(getThreadWorkspaceUploadDir(workspace, existingForComparison.threadId), { recursive: true });
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
          const providerSnapshot = await resolveProviderSnapshot({
            existingSnapshot: existingForComparison.providerSnapshot,
            fallbackToLocalAuth: !existingForComparison.providerSnapshot
          });
          const sessionRuntime = createRuntimeForProviderSnapshot(providerSnapshot, {
            configOverrides: runtimeLaunch.configOverrides,
            envOverrides: {
              ...(runtimeLaunch.envOverrides ?? {}),
              CODEX_HOME: materializedCodexHome.codexHome
            }
          });
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
                providerSnapshot
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
    const allocated = await allocateUserAgentWorkspacePath({
      currentUser,
      modeHint,
      securityDomainId
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

app.get(
  "/public-api/thread-shares/:token",
  createExternalWebSurfaceGate(externalWebAccess),
  requireCurrentUser,
  requireCurrentOrganization,
  requireInternalOrganizationMember,
  async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || "").trim();
      const share = await threadPublicShares.getActiveByToken(token);
      if (!share) {
        res.status(404).json({ detail: "Public link does not exist or has expired" });
        return;
      }
      const resolvedShare = await resolveThreadPublicShareSnapshotForRead(share);
      const userDisplayName = await resolveThreadPublicShareUserDisplayName(share.createdByUserId);
      res.setHeader("Cache-Control", "private, no-store");
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
  }
);

app.get(
  "/public-api/thread-shares/:token/files/content",
  createExternalWebSurfaceGate(externalWebAccess),
  requireCurrentUser,
  requireCurrentOrganization,
  requireInternalOrganizationMember,
  async (req: Request, res: Response) => {
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
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.type(path.extname(fileName) || "application/octet-stream");
      res.status(200).send(fileBuffer);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to read public share image";
      res.status(400).json({ detail });
    }
  }
);

app.get("/api/threads", async (req: Request, res: Response) => {
  const currentUser = currentActorFromRequest(req);
  const securityDomainId = await portalSecurityDomainIdForActor(currentUser);
  await portalWorkspaces.ensureWorkspace({
    userId: currentUser.id,
    organizationId: currentUser.organizationId,
    securityDomainId
  });
  const list = await threads.listForUserInSecurityDomain(
    currentUser.id,
    currentUser.organizationId,
    securityDomainId ?? null,
    true
  );
  const requestedFolderId = typeof req.query.folder_id === "string" ? req.query.folder_id.trim() : "";
  const filtered = requestedFolderId ? list.filter((thread) => thread.workspaceFolderId === requestedFolderId) : list;
  const readStates = await threadReadStates.listForUserThreadIds(
    currentUser.id,
    filtered.map((thread) => thread.id)
  );
  res.json({
    threads: filtered.map((thread) =>
      threadOut(thread, {
        hasUnreadCompletion: hasUnreadAssistantCompletion(thread, readStates.get(thread.id)?.lastReadAt)
      })
    )
  });
});

app.get("/api/threads/running", async (req: Request, res: Response) => {
  const currentUser = currentActorFromRequest(req);
  const result = await activePortalThreadIdsForActor(currentUser);
  if (!result.available) {
    res.status(503).json({ detail: "Running thread status is temporarily unavailable" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ thread_ids: Array.from(result.threadIds) });
});

app.post("/api/threads", async (req: Request, res: Response) => {
  const timing = createRuntimeStartupTimer({
    traceId: randomUUID(),
    source: "portal",
    operation: "create_thread",
    route: "POST /api/threads"
  });
  try {
    timing.mark("request_received");
    const currentUser = currentActorFromRequest(req);
    timing.updateContext({ organizationType: currentUser.organizationType });
    const input = createThreadSchema.parse(req.body || {});
    const threadId = randomUUID().replace(/-/g, "");
    timing.updateContext({ threadId });
    const securityDomainId = await timing.time("create_thread.resolve_security_domain", () =>
      portalSecurityDomainIdForActor(currentUser)
    );
    const workspaceScope = await timing.time("create_thread.resolve_user_workspace", () =>
      portalWorkspaces.resolveTaskScope({
        actor: {
          userId: currentUser.id,
          organizationId: currentUser.organizationId,
          securityDomainId
        },
        folderId: input.folder_id ?? undefined
      })
    );
    const modeHint = modeIdFromRunConfig(input.codex_run_config);
    const allocated = await timing.time("create_thread.allocate_workspace", () =>
      allocateUserAgentWorkspacePath({
        currentUser,
        modeHint,
        securityDomainId,
        threadId
      }),
      { modeHint }
    );
    const options = await timing.time("create_thread.resolve_session_options", () =>
      resolveSessionOptions(
        {
          model: input.model,
          reasoning_effort: input.reasoning_effort,
          knowledge_set_ids: input.knowledge_set_ids,
          codex_run_config: input.codex_run_config
        },
        currentUser,
        allocated.workspacePath,
        allocated.modeId,
        allocated.runtimeProfile,
        timing
      )
    );
    timing.updateContext({ model: options.model });
    await timing.time("create_thread.assert_chat_access", () =>
      assertChatAllowsNewSession({
        currentUser,
        model: options.model,
        featureType: "chat"
      })
    );
    const shouldStartSession = input.start_session !== false;
    if (shouldStartSession) {
      await timing.time("create_thread.check_deploy_drain", () =>
        assertDeploymentAllowsRuntimeStart(getDeploymentDrainReason)
      );
    }
    const createdThread = await timing.time("create_thread.persist_thread", () =>
      threads.create({
        id: threadId,
        organizationId: currentUser.organizationId,
        userId: currentUser.id,
        securityDomainId,
        userWorkspaceId: workspaceScope.workspaceId,
        workspaceFolderId: workspaceScope.folderId,
        channel: "portal",
        title: input.title?.trim() || undefined,
        externalId: input.external_id?.trim() || undefined,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        workspace: options.workspace,
        codexRunConfig: options.codexRunConfig
      })
    );
    const session = shouldStartSession
      ? await timing.time("create_thread.create_session", () =>
          createSession(options, createdThread.id, timing)
        )
      : undefined;
    if (session) {
      timing.updateContext({ sessionId: session.sessionId });
    } else {
      timing.mark("create_thread.defer_session_start");
    }
    const updated = session
      ? (await timing.time("create_thread.reload_thread", () =>
          threads.get(createdThread.id, currentUser.organizationId)
        )) ?? createdThread
      : createdThread;

    res.json({
      thread: threadOut(updated),
      session: session ? sessionOut(session) : null
    });
    timing.finish("success", { modeId: allocated.modeId, sessionStarted: shouldStartSession });
  } catch (error) {
    timing.finish("error", { error: error instanceof Error ? error.message : String(error) });
    res.status(statusCodeForSessionAccessError(error)).json(payloadForSessionAccessError(error, "Failed to create thread"));
  }
});

app.get("/api/threads/:threadId", async (req: Request, res: Response) => {
  const currentUser = currentActorFromRequest(req);
  const thread = await getPortalReadableThread(String(req.params.threadId || "").trim(), currentUser);
  if (!thread) {
    res.status(404).json({ detail: "Thread does not exist" });
    return;
  }
  res.json({ thread: threadOut(thread) });
});

app.post("/api/threads/:threadId/read", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await getPortalOwnedThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const state = await threadReadStates.markRead(thread.id, currentUser.id);
    res.json({ ok: true, thread_id: thread.id, last_read_at: state.lastReadAt });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to mark thread as read";
    res.status(400).json({ detail });
  }
});

app.patch("/api/threads/:threadId", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const input = patchThreadSchema.parse(req.body || {});
    const existing = await getPortalOwnedThread(threadId, currentUser);
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
    let updated = await threads.update(threadId, patch);
    if (input.folder_id !== undefined) {
      const securityDomainId = await portalSecurityDomainIdForActor(currentUser);
      if (input.folder_id === null) {
        const scope = await portalWorkspaces.resolveTaskScope({
          actor: {
            userId: currentUser.id,
            organizationId: currentUser.organizationId,
            securityDomainId
          }
        });
        updated = await threads.update(threadId, {
          userWorkspaceId: scope.workspaceId,
          workspaceFolderId: scope.folderId
        });
      } else {
        await portalWorkspaces.moveThread({
          actor: {
            userId: currentUser.id,
            organizationId: currentUser.organizationId,
            securityDomainId
          },
          threadId,
          folderId: input.folder_id
        });
        updated = (await threads.get(threadId, currentUser.organizationId)) ?? updated;
      }
    }
    res.json({ thread: threadOut(updated) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to update thread";
    res.status(400).json({ detail });
  }
});

app.put("/api/threads/:threadId/skills", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const input = updateThreadSkillsSchema.parse(req.body || {});
    const existing = await getPortalOwnedThread(threadId, currentUser);
    if (!existing) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }

    const runtimeOptions = await portalRuntimeOptions.resolve({
      organizationId: currentUser.organizationId,
      userId: currentUser.id,
      roleIds: roleIdsForActor(currentUser),
      departmentIds: await listDepartmentIdsForActor(currentUser)
    });
    const selectedMode = runtimeOptions.modes.find((mode) => mode.id === input.mode_id);
    if (!selectedMode) {
      res.status(400).json({ detail: "The selected agent mode is not available" });
      return;
    }

    const availableById = new Map(selectedMode.availableSkills.map((skill) => [skill.id, skill] as const));
    const selectedIds = Array.from(new Set(input.skill_ids));
    const unavailableIds = selectedIds.filter((skillId) => !availableById.has(skillId));
    if (unavailableIds.length > 0) {
      res.status(400).json({ detail: `Selected skills are not available: ${unavailableIds.join(", ")}` });
      return;
    }

    const enabledSkills: EnabledSkillSelection[] = selectedIds.map((skillId) => {
      const skill = availableById.get(skillId)!;
      return {
        id: skill.id,
        name: skill.name,
        managedSkillId: trimOrUndefined(skill.managedSkillId),
        sourcePath: trimOrUndefined(skill.sourcePath),
        activationPrompt: trimOrUndefined(skill.activationPrompt)
      };
    });
    const nextRunConfig = withRunConfigEnabledSkillSelection(
      withRunConfigMode(withoutInternalRuntimeMetadata(existing.codexRunConfig), selectedMode.id),
      enabledSkills
    );
    const updated = await threads.update(threadId, { codexRunConfig: nextRunConfig });
    res.json({ thread: threadOut(updated) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to update thread skills";
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
        : await getPortalOwnedThread(threadId, currentUser);
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
    if (workspacePath && shouldRemoveWorkspaceOnThreadHardDelete(threadId, workspacePath)) {
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
  const threadId = String(req.params.threadId || "").trim();
  const timing = createRuntimeStartupTimer({
    traceId: randomUUID(),
    source: "portal",
    operation: "ensure_thread_session",
    route: "POST /api/threads/:threadId/session",
    threadId
  });
  try {
    timing.mark("request_received");
    const currentUser = currentActorFromRequest(req);
    timing.updateContext({ organizationType: currentUser.organizationType });
    const input = ensureThreadSessionSchema.parse(req.body || {});
    await timing.time("ensure_thread_session.check_deploy_drain", () =>
      assertDeploymentAllowsRuntimeStart(getDeploymentDrainReason)
    );
    const session = await ensureThreadSession(currentUser, threadId, input, timing, true);
    timing.updateContext({ sessionId: session.sessionId, model: session.model });
    res.json({ session: sessionOut(session) });
    timing.finish("success");
  } catch (error) {
    timing.finish("error", { error: error instanceof Error ? error.message : String(error) });
    res.status(statusCodeForSessionAccessError(error)).json(payloadForSessionAccessError(error, "Failed to ensure thread session"));
  }
});

app.get("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await getPortalReadableThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const repository = await conversationRecords.getMessageRepository(threadId);
    res.json({
      head_id: repository.headId ?? null,
      messages: repository.messages.map((item) => ({
        parent_id: item.parentId,
        message: repairPortalAssistantCompletionStatus(item.message),
        run_config: item.runConfig,
        created_at: item.createdAt,
        updated_at: item.updatedAt
      })),
      feedback: thread.feedback.map(feedbackOut)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read message history";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/steer-events", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await getPortalOwnedThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const events = await portalSteerEvents.listForThread(threadId);
    res.json({ steer_events: events.map(portalSteerEventOut) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read steering history";
    res.status(400).json({ detail });
  }
});

app.get("/api/threads/:threadId/public-share", requireInternalOrganizationMember, async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await getPortalOwnedThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const share = await threadPublicShares.getActiveForThread(threadId);
    res.json({
      share: share
        ? {
            id: share.id,
            title: share.title,
            selected_turn_count: share.selectedTurnCount,
            public_path: `/share/${encodeURIComponent(share.token)}`,
            expires_at: share.expiresAt,
            created_at: share.createdAt,
            updated_at: share.updatedAt
          }
        : null
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to read public link status";
    res.status(400).json({ detail });
  }
});

app.post(
  "/api/threads/:threadId/public-share",
  requireInternalOrganizationMember,
  async (req: Request, res: Response) => {
    try {
      const currentUser = currentActorFromRequest(req);
      const profileUser = req.currentUser!;
      const threadId = String(req.params.threadId || "").trim();
      const thread = await getPortalOwnedThread(threadId, currentUser);
      if (!thread) {
        res.status(404).json({ detail: "Thread does not exist" });
        return;
      }
      if (thread.securityDomainId) {
        res.status(403).json({ detail: "保密域会话不能创建公开链接" });
        return;
      }

      const input = createThreadPublicShareSchema.parse(req.body || {});
      const repository = await conversationRecords.getMessageRepository(threadId);
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
        createdByUserId: currentUser.id,
        expiresAt: new Date(Date.now() + THREAD_PUBLIC_SHARE_TTL_MS)
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
  }
);

app.delete(
  "/api/threads/:threadId/public-share",
  requireInternalOrganizationMember,
  async (req: Request, res: Response) => {
    try {
      const currentUser = currentActorFromRequest(req);
      const threadId = String(req.params.threadId || "").trim();
      const thread = await getPortalOwnedThread(threadId, currentUser);
      if (!thread) {
        res.status(404).json({ detail: "Thread does not exist" });
        return;
      }
      const revokedCount = await threadPublicShares.revokeActiveForThread({
        threadId,
        revokedByUserId: currentUser.id
      });
      res.json({ revoked: revokedCount > 0 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to revoke public link";
      res.status(400).json({ detail });
    }
  }
);

app.post("/api/threads/:threadId/messages", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await getPortalOwnedThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const input = appendMessageSchema.parse(req.body || {});
    if (shouldIgnorePortalClientMessageAppend(input.message)) {
      const repository = await conversationRecords.getMessageRepository(threadId);
      logPortalStreamLifecycle("client_assistant_append_ignored", {
        thread_id: threadId,
        user_id: currentUser.id,
        organization_id: currentUser.organizationId,
        message_id: storedMessageId(input.message)
      });
      res.json({ ok: true, ignored: true, head_id: repository.headId ?? null });
      return;
    }
    const updated = await conversationRecords.appendMessage({
      threadId,
      parentId: input.parent_id ?? null,
      message: input.message,
      runConfig: input.run_config,
      createdAt: input.created_at,
      updatedAt: input.updated_at
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
    const thread = await getPortalOwnedThread(threadId, currentUser);
    if (!thread) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const input = replaceMessagesSchema.parse(req.body || {});
    const current = await conversationRecords.getMessageRepository(threadId);
    const merged = mergePortalClientRepositoryReplacement({
      current,
      incoming: {
        headId: input.head_id ?? null,
        messages: input.messages.map((item) => ({
          parentId: item.parent_id ?? null,
          message: item.message,
          runConfig: item.run_config,
          createdAt: item.created_at,
          updatedAt: item.updated_at
        }))
      }
    });
    assertPortalMessageRepositoryIntegrity(merged.messages.map((item) => ({
      id: storedMessageId(item.message),
      role: storedMessageRole(item.message),
      parentId: item.parentId
    })));
    await conversationRecords.replaceMessages({
      threadId,
      headId: merged.headId ?? null,
      messages: merged.messages.map((item) => ({
        parentId: item.parentId ?? null,
        message: item.message,
        runConfig: item.runConfig,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
    });
    res.json({ ok: true, assistant_messages_server_managed: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to replace message history";
    res.status(400).json({ detail });
  }
});

app.post("/api/threads/:threadId/feedback", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const threadId = String(req.params.threadId || "").trim();
    const thread = await getPortalOwnedThread(threadId, currentUser);
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
    if (input.type === "negative") {
      void customerExperienceIssues.reportNegativeConversationFeedback({
        organizationId: currentUser.organizationId,
        userId: currentUser.id,
        threadId,
        messageId: input.message_id,
        audience: recoveryAudienceForActor(currentUser),
        contentPreview: summarizeText(input.content_preview || ""),
        comment: input.type === "negative" && hasCommentInput ? summarizeText(input.comment || "", 1000) : undefined
      }).catch((error) => {
        console.warn("negative feedback experience issue report failed", {
          threadId,
          messageId: input.message_id,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
    }
    res.json({ feedback: feedbackOut(feedback) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to submit feedback";
    res.status(400).json({ detail });
  }
});

app.post("/api/chat/cancel", async (req: Request, res: Response) => {
  try {
    const currentUser = currentActorFromRequest(req);
    const input = portalChatCancelSchema.parse(req.body || {});
    const cancelTraceId = randomUUID();
    if (input.client_cancel_source) {
      logPortalStreamLifecycle("user_clicked_stop", {
        cancel_trace_id: cancelTraceId,
        session_id: input.session_id,
        thread_id: input.thread_id,
        user_message_id: input.user_message_id,
        user_id: currentUser.id,
        organization_id: currentUser.organizationId,
        client_cancel_clicked_at: input.client_cancel_clicked_at,
        client_cancel_source: input.client_cancel_source
      });
    }
    logPortalStreamLifecycle("cancel_request_received", {
      cancel_trace_id: cancelTraceId,
      session_id: input.session_id,
      run_id: input.client_run_id,
      thread_id: input.thread_id,
      user_message_id: input.user_message_id,
      user_id: currentUser.id,
      organization_id: currentUser.organizationId,
      client_cancel_clicked_at: input.client_cancel_clicked_at,
      client_cancel_source: input.client_cancel_source
    });
    const result = await cancelPortalActiveChatRun({
      sessionId: input.session_id,
      currentUser,
      threadId: input.thread_id,
      runId: input.client_run_id,
      userMessageId: input.user_message_id,
      cancelTraceId
    });
    logPortalStreamLifecycle("cancel_matched_active_run", {
      cancel_trace_id: cancelTraceId,
      trace_id: result.streamTraceId,
      run_id: result.runId ?? input.client_run_id,
      session_id: result.sessionId ?? input.session_id,
      thread_id: result.threadId ?? input.thread_id,
      user_message_id: result.userMessageId ?? input.user_message_id,
      user_id: currentUser.id,
      organization_id: currentUser.organizationId,
      cancelled: result.cancelled,
      active_run_found: result.activeRunFound,
      runtime_abort_requested: result.runtimeAbortRequested,
      match_reason: result.matchReason
    });
    res.json({ cancelled: result.cancelled });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to cancel chat run";
    res.status(400).json({ detail });
  }
});

app.post("/api/chat/steer", async (req: Request, res: Response) => {
  let pendingEventId = "";
  try {
    const currentUser = currentActorFromRequest(req);
    const input = portalChatSteerSchema.parse(req.body || {});
    assertDirectChatMessageWithinLimit(input.message);

    const existingEvent = await portalSteerEvents.get(input.client_steer_id);
    if (existingEvent) {
      if (
        existingEvent.threadId !== input.thread_id ||
        existingEvent.organizationId !== currentUser.organizationId ||
        existingEvent.userId !== currentUser.id ||
        existingEvent.message !== input.message
      ) {
        res.status(409).json({ detail: "The steering event does not match this request." });
        return;
      }
      if (existingEvent.status === "accepted") {
        res.json({
          accepted: true,
          turn_id: existingEvent.turnId,
          steer_event: portalSteerEventOut(existingEvent)
        });
        return;
      }
    }

    if (!(await getPortalOwnedThread(input.thread_id, currentUser))) {
      res.status(404).json({ detail: "Thread does not exist" });
      return;
    }
    const initialPending = await portalSteerEvents.begin({
      id: input.client_steer_id,
      threadId: input.thread_id,
      organizationId: currentUser.organizationId,
      userId: currentUser.id,
      sessionId: input.session_id,
      message: input.message
    });
    pendingEventId = initialPending.event.id;
    if (initialPending.alreadyAccepted) {
      pendingEventId = "";
      res.json({
        accepted: true,
        turn_id: initialPending.event.turnId,
        steer_event: portalSteerEventOut(initialPending.event)
      });
      return;
    }
    const rejectSteer = async (status: number, detail: string, errorCode: string) => {
      let failedEvent: PortalSteerEventRecord | undefined;
      try {
        failedEvent = await portalSteerEvents.markFailed(initialPending.event.id, errorCode);
      } catch (persistError) {
        console.warn("failed to persist rejected portal steer event", {
          steerEventId: initialPending.event.id,
          detail: persistError instanceof Error ? persistError.message : String(persistError)
        });
      }
      pendingEventId = "";
      res.status(status).json({
        detail,
        ...(failedEvent ? { steer_event: portalSteerEventOut(failedEvent) } : {})
      });
    };

    gcPortalActiveChatRuns();

    const activeRun = portalActiveChatRuns.get(input.session_id);
    if (!activeRun || activeRun.controller.signal.aborted) {
      await rejectSteer(409, "The current response is no longer running. Add this instruction to the queue instead.", "response_not_running");
      return;
    }
    if (input.client_run_id && activeRun.runId !== input.client_run_id) {
      await rejectSteer(409, "The current response has changed. Add this instruction to the queue instead.", "run_mismatch");
      return;
    }
    if (activeRun.userId !== currentUser.id || activeRun.organizationId !== currentUser.organizationId) {
      await rejectSteer(403, "The active response does not belong to the current user.", "response_owner_mismatch");
      return;
    }

    const session =
      activeRun.session ??
      (await sessions.getOwned(input.session_id, currentUser.id, currentUser.organizationId));
    if (!session) {
      await rejectSteer(404, "Session does not exist or has expired", "session_missing");
      return;
    }
    const boundThreadId = trimOrUndefined(session.threadId) ?? trimOrUndefined(activeRun.threadId);
    if (!boundThreadId || boundThreadId !== input.thread_id) {
      await rejectSteer(409, "Session does not match the requested thread. Refresh and try again.", "thread_mismatch");
      return;
    }
    const liveThread = liveRuntimeThreads.get(session.sessionId);
    if (!liveThread) {
      await rejectSteer(
        409,
        "The current response is no longer available for steering. Add this instruction to the queue instead.",
        "runtime_thread_missing"
      );
      return;
    }

    const pending = await portalSteerEvents.begin({
      id: input.client_steer_id,
      threadId: boundThreadId,
      organizationId: currentUser.organizationId,
      userId: currentUser.id,
      sessionId: session.sessionId,
      sourceUserMessageId: activeRun.userMessageId,
      message: input.message
    });
    pendingEventId = pending.event.id;
    if (pending.alreadyAccepted) {
      res.json({
        accepted: true,
        turn_id: pending.event.turnId,
        steer_event: portalSteerEventOut(pending.event)
      });
      return;
    }

    const turnId = await runtime.steerActiveTurn(liveThread, input.message);
    let acceptedEvent: PortalSteerEventRecord;
    try {
      acceptedEvent = await portalSteerEvents.markAccepted(pending.event.id, turnId);
    } catch (error) {
      console.error("failed to persist accepted portal steer event", {
        steerEventId: pending.event.id,
        threadId: boundThreadId,
        turnId,
        detail: error instanceof Error ? error.message : String(error)
      });
      const now = new Date().toISOString();
      acceptedEvent = {
        ...pending.event,
        turnId,
        status: "accepted",
        errorCode: undefined,
        resolvedAt: now,
        updatedAt: now
      };
    }
    pendingEventId = "";
    logPortalStreamLifecycle("active_turn_steered", {
      trace_id: activeRun.traceId,
      session_id: session.sessionId,
      thread_id: boundThreadId,
      turn_id: turnId,
      user_id: currentUser.id,
      organization_id: currentUser.organizationId,
      input_length: input.message.length
    });
    res.json({
      accepted: true,
      turn_id: turnId,
      steer_event: portalSteerEventOut(acceptedEvent)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to steer the active response";
    if (pendingEventId) {
      try {
        await portalSteerEvents.markFailed(pendingEventId);
      } catch (persistError) {
        console.warn("failed to persist rejected portal steer event", {
          steerEventId: pendingEventId,
          detail: persistError instanceof Error ? persistError.message : String(persistError)
        });
      }
    }
    res.status(400).json({ detail });
  }
});

app.post("/api/chat/stream", async (req: Request, res: Response) => {
  const portalStreamTraceId = randomUUID();
  const timing = createRuntimeStartupTimer({
    traceId: portalStreamTraceId,
    source: "portal",
    operation: "chat_stream",
    route: "POST /api/chat/stream"
  });
  let timingFinished = false;
  const finishTiming = (status: "success" | "error", metadata?: Record<string, unknown>) => {
    if (timingFinished) return;
    timing.finish(status, metadata);
    timingFinished = true;
  };
  timing.mark("request_received");
  initSSE(res);
  const streamAbort = createSseAbortLifecycle(req, res);
  const sendTrackedSSE = (eventName: string, payload: unknown): boolean => {
    const sent = sendSSE(res, eventName, payload);
    if (sent) streamAbort.recordSentEvent(eventName);
    return sent;
  };
  const heartbeat = setInterval(() => sendTrackedSSE("ping", { now: new Date().toISOString() }), 15000);
  const explicitCancel = new AbortController();
  // A transport disconnect is recoverable: keep the runtime turn alive so the
  // result can be persisted and the explicit cancel endpoint can still find it.
  const runAbort = mergeAbortSignals([explicitCancel.signal]);
  let directInputLength: number | undefined;
  let unregisterPortalRun: (() => void) | undefined;
  let portalRuntimeSession: SessionRecord | undefined;
  let portalRequestedSessionId: string | undefined;
  let portalRunId: string = portalStreamTraceId;
  let portalAssistantMessageId: string | undefined;
  let portalThreadId: string | undefined;
  let portalUserMessageId: string | undefined;
  let portalCurrentUserId: string | undefined;
  let portalCurrentOrganizationId: string | undefined;
  let portalCurrentActor: CurrentActor | undefined;
  let portalQuestionPreview: string | undefined;
  let portalAssistantMessageWritten = false;
  let portalRuntimeStarted = false;
  let portalRuntimeFailure: string | undefined;
  let portalTurnFailure: string | undefined;
  let portalAutoRecoveryAttempted = false;
  let portalFinalAnswerStarted = false;
  let portalNonResumableSideEffectStarted = false;
  let portalFirstAttemptTurnStarted = false;
  let portalRecoveryCompletedEventSent = false;
  let portalLastRunAttempt: 1 | 2 = 1;
  const logPortalStream = (stage: string, details: Record<string, unknown> = {}) => {
    logPortalStreamLifecycle(stage, {
      trace_id: portalStreamTraceId,
      run_id: portalRunId,
      session_id: portalRuntimeSession?.sessionId ?? portalRequestedSessionId,
      thread_id: portalThreadId,
      user_message_id: portalUserMessageId,
      user_id: portalCurrentUserId,
      organization_id: portalCurrentOrganizationId,
      ...details
    });
  };

  try {
    const currentUser = currentActorFromRequest(req);
    portalCurrentActor = currentUser;
    portalCurrentUserId = currentUser.id;
    portalCurrentOrganizationId = currentUser.organizationId;
    timing.updateContext({ organizationType: currentUser.organizationType });
    const input = streamSchema.parse(req.body || {});
    portalRequestedSessionId = input.session_id;
    portalRunId = input.client_run_id ?? portalStreamTraceId;
    portalAssistantMessageId = input.client_assistant_message_id;
    portalThreadId = input.thread_id;
    portalQuestionPreview = input.display_message ?? input.message;
    logPortalStream("stream_opened", {
      requested_thread_id: input.thread_id,
      lifecycle: streamAbort.snapshot()
    });
    directInputLength = input.message.length;
    assertDirectChatMessageWithinLimit(input.message);
    timing.updateContext({ sessionId: input.session_id, threadId: input.thread_id });
    const drainReason = await timing.time("chat_stream.check_deploy_drain", () => getDeploymentDrainReason());
    if (drainReason) {
      sendTrackedSSE("error", { detail: drainReason });
      finishTiming("error", { reason: "deployment_drain" });
      res.end();
      return;
    }
    let session = await timing.time("chat_stream.load_session", () =>
      sessions.getOwned(input.session_id, currentUser.id, currentUser.organizationId)
    );
    if (session?.threadId && !(await getPortalOwnedThread(session.threadId, currentUser))) {
      session = undefined;
    }
    timing.updateContext({
      sessionId: session?.sessionId,
      threadId: session?.threadId ?? input.thread_id,
      model: session?.model
    });
    let liveThread = session ? liveRuntimeThreads.get(session.sessionId) : undefined;
    timing.mark(liveThread ? "chat_stream.live_runtime_cache_hit" : "chat_stream.live_runtime_cache_miss", {
      hasSession: Boolean(session)
    });
    if (!liveThread && session) {
      liveThread = await timing.time("chat_stream.restore_live_runtime", () =>
        restoreLiveRuntimeThread(session, timing)
      );
    }
    if (!session || !liveThread) {
      if (session?.sessionId) {
        await timing.time("chat_stream.remove_invalid_session", () => sessions.remove(session.sessionId));
        liveRuntimeThreads.delete(session.sessionId);
      }
      sendTrackedSSE("error", { detail: "Session does not exist or has expired" });
      finishTiming("error", { reason: "session_missing_or_expired" });
      res.end();
      return;
    }
    const ensuredLiveThread = liveThread;
    let currentSession: SessionRecord = session;
    portalRuntimeSession = currentSession;
    const requestedThreadId = String(input.thread_id || "").trim();
    if (requestedThreadId) {
      const boundThreadId = String(currentSession.threadId || "").trim();
      if (!boundThreadId) {
        sendTrackedSSE("error", { detail: "Session is not bound to a thread. Refresh and try again." });
        finishTiming("error", { reason: "session_not_bound_to_thread" });
        res.end();
        return;
      }
      if (boundThreadId !== requestedThreadId) {
        sendTrackedSSE("error", { detail: "Session does not match the requested thread. Please try again." });
        finishTiming("error", { reason: "session_thread_mismatch" });
        res.end();
        return;
      }
    }
    portalThreadId = currentSession.threadId ?? requestedThreadId;
    unregisterPortalRun = registerPortalActiveChatRun({
      sessionId: currentSession.sessionId,
      runId: portalRunId,
      userId: currentUser.id,
      organizationId: currentUser.organizationId,
      controller: explicitCancel,
      threadId: portalThreadId,
      traceId: portalStreamTraceId,
      assistantMessageId: portalAssistantMessageId
    });
    attachPortalActiveChatRun({
      sessionId: currentSession.sessionId,
      userId: currentUser.id,
      session: currentSession,
      threadId: portalThreadId,
      assistantMessageId: portalAssistantMessageId
    });

    // Each streamed turn is a new costly action. Gate it before execution without
    // terminating any turn that is already in flight.
    await timing.time("chat_stream.assert_chat_access", () =>
      assertChatAllowsNewSession({
        currentUser,
        model: currentSession.model,
        threadId: currentSession.threadId ?? undefined,
        sessionId: currentSession.sessionId,
        featureType: "chat"
      })
    );
    if (!currentSession.threadId) {
      sendTrackedSSE("error", { detail: "Session is not bound to a thread. Refresh and try again." });
      finishTiming("error", { reason: "session_not_bound_to_thread" });
      res.end();
      return;
    }
    const persistedPortalUserMessageId = await timing.time("chat_stream.persist_user_message", () =>
      ensurePortalStreamUserMessage({
        threadId: currentSession.threadId!,
        userMessageId: input.client_user_message_id ?? input.user_message_id,
        parentId: input.parent_id ?? null,
        userMessage: input.user_message,
        displayText: input.display_message ?? input.message,
        sessionId: currentSession.sessionId
      })
    );
    portalUserMessageId = persistedPortalUserMessageId;
    await timing.time("chat_stream.enqueue_security_review", async () => {
      try {
        await conversationSecurityReview.enqueuePortalTurn({
          organizationId: currentUser.organizationId,
          userId: currentUser.id,
          threadId: currentSession.threadId!,
          userMessageId: persistedPortalUserMessageId,
          audience: isExternalActor(currentUser) ? "external" : "internal"
        });
      } catch (error) {
        console.warn("conversation security review enqueue failed", {
          threadId: currentSession.threadId,
          userMessageId: persistedPortalUserMessageId,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    });
    attachPortalActiveChatRun({
      sessionId: currentSession.sessionId,
      userId: currentUser.id,
      session: currentSession,
      threadId: currentSession.threadId,
      userMessageId: persistedPortalUserMessageId
    });

    sendTrackedSSE("meta", {
      session_id: currentSession.sessionId,
      run_id: portalRunId,
      thread_id: currentSession.threadId,
      user_message_id: persistedPortalUserMessageId,
      model: currentSession.model,
      reasoning_effort: currentSession.reasoningEffort,
      workspace: currentSession.workspace,
      started_at: new Date().toISOString()
    });
    timing.mark("chat_stream.meta_sent");

    const artifactScanStartedAt = new Date(Date.now() - 2000);
    const runtimeFileChanges: RuntimeFileChange[] = [];
    const portalRunProjection = new CodexRunProjection();
    let firstCodexEventSeen = false;
    const portalThread = await timing.time("chat_stream.load_bound_thread", () =>
      getPortalOwnedThread(currentSession.threadId!, currentUser)
    );
    if (!portalThread) {
      throw new Error("Thread does not exist");
    }
    const agentModeId = modeIdFromRunConfig(currentSession.codexRunConfig) ?? modeIdFromRunConfig(portalThread.codexRunConfig);
    const selectedSkillIds =
      input.selected_skill_ids ??
      enabledSkillSelectionsFromRunConfig(portalThread.codexRunConfig).map((skill) => skill.id);
    const turnSkills = agentModeId
      ? await timing.time("chat_stream.resolve_turn_skills", () =>
          resolveSelectedSkillIdsForMode({
            currentUser,
            modeId: agentModeId,
            skillIds: selectedSkillIds
          })
        )
      : [];
    const turnRunConfig = withRunConfigEnabledSkillSelection(currentSession.codexRunConfig, turnSkills);
    const turnSkillInputs = await timing.time("chat_stream.resolve_turn_skill_inputs", () =>
      resolvePortalTurnSkillInputs(turnSkills)
    );
    const instructionReadObserver = new CodexInstructionReadObserver({ selectedSkills: turnSkillInputs });
    const runtimeMessage = withExplicitSkillMentions(
      withSkillActivationPrompts(input.message, turnRunConfig),
      turnSkills
    );
    timing.mark("chat_stream.runtime_prompt_prepared", {
      inputLength: input.message.length,
      runtimePromptLength: runtimeMessage.length,
      skillActivationPromptApplied: runtimeMessage !== input.message,
      selectedSkillCount: turnSkills.length,
      explicitSkillInputCount: turnSkillInputs.length
    });
    const enterpriseRunContext = await timing.time("chat_stream.resolve_enterprise_context", () =>
      enterpriseContext.resolveForRun({
        channel: "portal",
        userId: currentUser.id,
        agentModeId
      }),
      { agentModeId }
    );
    timing.mark("chat_stream.runtime_stream_starting", {
      hasEnterpriseContext: Boolean(enterpriseRunContext),
      hasCodexThreadId: Boolean(currentSession.codexThreadId)
    });
    portalRuntimeStarted = true;
    const runPortalRuntimeAttempt = async (attempt: 1 | 2): Promise<void> => {
      portalLastRunAttempt = attempt;
      const attemptThread = liveRuntimeThreads.get(currentSession.sessionId) ?? ensuredLiveThread;
      const attemptPrompt = attempt === 2
        ? portalAutoRecoveryPrompt({
            originalPrompt: runtimeMessage,
            firstAttemptRuntimeEventSeen: portalFirstAttemptTurnStarted
          })
        : runtimeMessage;
      await codexExecution.streamFromRuntime({
        runtime,
        thread: attemptThread,
        prompt: attemptPrompt,
        workspace: currentSession.workspace,
        enterpriseContext: enterpriseRunContext,
        signal: runAbort.signal,
        turnOptions: {
          model: currentSession.model,
          reasoningEffort: currentSession.reasoningEffort,
          workspace: currentSession.workspace,
          codexRunConfig: stripInternalRunConfigMetadata(currentSession.codexRunConfig),
          skills: turnSkillInputs
        },
        memory: {
          channel: "portal",
          prompt: input.message,
          codexHome: codexHomeFromRunConfig(currentSession.codexRunConfig),
          codexThreadId: currentSession.codexThreadId,
          sessionId: currentSession.sessionId,
          threadId: currentSession.threadId ?? undefined,
          organizationId: currentUser.organizationId,
          userId: currentUser.id,
          model: currentSession.model,
          hasExternalContext: codexRunConfigHasExternalContext(currentSession.codexRunConfig),
          metadata: {
            route: "chat_stream",
            autoRecoveryAttempt: attempt
          }
        },
        onEvent(event) {
          portalRunProjection.push(event);
          if (attempt === 1 && portalRuntimeEventIndicatesTurnStarted(event)) {
            portalFirstAttemptTurnStarted = true;
          }
          if (attempt === 2 && !portalRecoveryCompletedEventSent) {
            portalRecoveryCompletedEventSent = true;
            sendTrackedSSE("recovery", {
              status: "recovered",
              attempt: 2,
              max_attempts: 2
            });
          }
          if (portalRuntimeEventStartsFinalAnswer(event)) {
            portalFinalAnswerStarted = true;
          }
          if (portalRuntimeEventHasNonResumableSideEffect(event)) {
            portalNonResumableSideEffectStarted = true;
          }
          if (!firstCodexEventSeen) {
            firstCodexEventSeen = true;
            timing.mark("chat_stream.first_codex_event", { eventType: event.type });
            logPortalStream("first_codex_event", {
              runtime_event_type: event.type,
              lifecycle: streamAbort.snapshot()
            });
          }
          runtimeFileChanges.push(...extractRuntimeFileChanges(event));
          const instructionReads = instructionReadObserver.push(event);
          if (instructionReads.length > 0) {
            sendTrackedSSE("instruction_reads", {
              content_part: instructionReadObserver.contentPart()
            });
          }
          const codexThreadId = extractCodexThreadIdFromRuntimeEvent(event);
          if (codexThreadId) {
            void persistSessionCodexThreadId(currentSession, codexThreadId).then((updated) => {
              currentSession = updated;
              portalRuntimeSession = updated;
              attachPortalActiveChatRun({
                sessionId: updated.sessionId,
                userId: currentUser.id,
                session: updated,
                threadId: updated.threadId ?? currentSession.threadId,
                userMessageId: persistedPortalUserMessageId
              });
            });
          }
          sendTrackedSSE("codex", event);
        },
        async onDone(payload) {
          timing.mark("chat_stream.on_done_started");
          if (streamAbort.disconnected) {
            logPortalStream("task_completed_after_disconnect", {
              answer_length: payload.answer.length,
              runtime_file_change_count: runtimeFileChanges.length,
              lifecycle: streamAbort.snapshot()
            });
          }
          let serverPersistedAssistant = false;
          try {
            const artifacts = await timing.time("chat_stream.register_artifacts", () =>
              registerGeneratedArtifactsForSession({
                currentUser,
                session: currentSession,
                changes: runtimeFileChanges,
                answerText: payload.answer,
                changedAfter: artifactScanStartedAt
              })
            );
            let artifactContentPart: Record<string, unknown> | undefined;
            if (artifacts.length > 0) {
              const policy = await resolveArtifactPolicyForActor(currentUser);
              artifactContentPart = artifactContentPartForArtifacts(artifacts, policy);
              sendTrackedSSE("artifacts", {
                policy: artifactPolicyOut(policy),
                artifacts: artifacts.map(artifactOut),
                content_part: artifactContentPart
              });
            }
            if (currentSession.threadId) {
              const instructionReadContentPart = instructionReadObserver.contentPart();
              const finalizedProcess = portalRunProjection.finalize({ finalAnswer: payload.answer });
              const persistedContentParts = [
                instructionReadContentPart,
                ...finalizedProcess.contentParts,
                artifactContentPart
              ]
                .filter((part): part is Record<string, unknown> => Boolean(part));
              serverPersistedAssistant = await timing.time("chat_stream.persist_assistant_message", () =>
                persistPortalAssistantMessageWithRetry({
                  threadId: currentSession.threadId!,
                  userMessageId: persistedPortalUserMessageId,
                  sessionId: currentSession.sessionId,
                  runId: portalRunId,
                  assistantMessageId: portalAssistantMessageId,
                  answerText: payload.answer,
                  contentParts: persistedContentParts.length > 0 ? persistedContentParts : undefined
                })
              );
              if (serverPersistedAssistant) {
                portalAssistantMessageWritten = true;
                markPortalActiveChatRunAssistantWritten({
                  sessionId: currentSession.sessionId,
                  userId: currentUser.id
                });
              }
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            console.warn("artifact registration failed", {
              sessionId: currentSession.sessionId,
              threadId: currentSession.threadId,
              detail
            });
            sendTrackedSSE("artifact_warning", { detail: "Generated files could not be registered for external preview" });
          }
          streamAbort.markSettled();
          sendTrackedSSE("done", {
            session_id: currentSession.sessionId,
            run_id: portalRunId,
            answer: payload.answer,
            server_persisted: serverPersistedAssistant,
            completed_at: new Date().toISOString()
          });
          timing.mark("chat_stream.done_sent");
          finishTiming("success", { firstCodexEventSeen });
        },
        async recordUsage(usage, resultStatus = "success") {
          const departmentIdSnapshot =
            trimOrUndefined(currentUser.organizationType) === "internal"
              ? await departmentMemberships.getPreferredDepartmentIdForUser(currentUser.id)
              : undefined;
          const codexThreadId = usage.codexThreadId ?? currentSession.codexThreadId;
          await usageRecorder.recordCodexUsage({
            organizationId: currentUser.organizationId,
            userId: currentUser.id,
            departmentIdSnapshot,
            threadId: currentSession.threadId ?? undefined,
            sessionId: currentSession.sessionId,
            model: currentSession.model,
            featureType: "chat",
            usage,
            codexThreadId,
            resultStatus,
            metadata: {
              source: "chat_stream",
              autoRecoveryAttempt: attempt
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
    };

    try {
      await runPortalRuntimeAttempt(1);
    } catch (error) {
      const shouldRecover = shouldAutoRecoverPortalChat({
        error,
        attempted: portalAutoRecoveryAttempted,
        finalAnswerStarted: portalFinalAnswerStarted,
        nonResumableSideEffectStarted: portalNonResumableSideEffectStarted,
        aborted: explicitCancel.signal.aborted
      });
      if (!shouldRecover) throw error;

      portalAutoRecoveryAttempted = true;
      portalRunProjection.reset();
      runtimeFileChanges.length = 0;
      logPortalStream("auto_recovery_started", {
        attempt: 2,
        detail: runtimeErrorDetail(error).slice(0, 500),
        lifecycle: streamAbort.snapshot()
      });
      sendTrackedSSE("recovery", {
        status: "retrying",
        attempt: 2,
        max_attempts: 2
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await runPortalRuntimeAttempt(2);
      portalRuntimeFailure = undefined;
      portalTurnFailure = undefined;
      logPortalStream("auto_recovery_completed", {
        attempt: 2,
        lifecycle: streamAbort.snapshot()
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (portalUserMessageId && !explicitCancel.signal.aborted) {
      portalTurnFailure = detail;
    }
    if (portalRuntimeSession && portalRuntimeStarted && !explicitCancel.signal.aborted) {
      portalRuntimeFailure = detail;
    }
    const errorSent =
      !streamAbort.disconnected &&
      !explicitCancel.signal.aborted &&
      !res.writableEnded &&
      sendTrackedSSE(
        "error",
        {
          ...payloadForSessionAccessError(error, "Chat stream failed", req.header("accept-language")),
          ...(portalAutoRecoveryAttempted ? { auto_recovery_attempted: true } : {})
        }
      );
    if (errorSent && portalRuntimeFailure) {
      reportVisibleConversationFailure({
        source: "portal_chat_stream",
        channel: "portal",
        organizationId: portalCurrentOrganizationId,
        userId: portalCurrentUserId,
        threadId: portalThreadId ?? portalRuntimeSession?.threadId,
        sessionId: portalRuntimeSession?.sessionId,
        userMessageId: portalUserMessageId,
        audience: recoveryAudienceForActor(portalCurrentActor),
        severity: "high",
        reasonCode: "runtime_error",
        title: "站内聊天回答失败",
        questionPreview: portalQuestionPreview,
        failureDetail: detail,
        metadata: {
          traceId: portalStreamTraceId,
          requestedSessionId: portalRequestedSessionId,
          runtimeStarted: portalRuntimeStarted,
          autoRecoveryAttempted: portalAutoRecoveryAttempted,
          runAttempt: portalLastRunAttempt,
          assistantMessageWritten: portalAssistantMessageWritten,
          deliveryStatus: streamAbort.disconnected ? "client_disconnected" : "open"
        }
      });
    }
    if (explicitCancel.signal.aborted) {
      logPortalStream("runtime_abort_effective", {
        scope: "agent_studio_stream",
        runtime_started: portalRuntimeStarted,
        assistant_message_written: portalAssistantMessageWritten,
        stream_disconnected: streamAbort.disconnected,
        disconnect_reason: streamAbort.reason,
        error: detail.slice(0, 500),
        lifecycle: streamAbort.snapshot()
      });
    }
    finishTiming("error", {
      error: detail,
      inputLength: directInputLength,
      autoRecoveryAttempted: portalAutoRecoveryAttempted,
      runAttempt: portalLastRunAttempt,
      deliveryStatus: streamAbort.disconnected ? "client_disconnected" : "open",
      disconnectReason: streamAbort.reason
    });
  } finally {
    const cancelled = explicitCancel.signal.aborted;
    const portalRuntimeSessionId = trimOrUndefined(portalRuntimeSession?.sessionId);
    if (cancelled && portalThreadId && portalUserMessageId && portalRuntimeSessionId && !portalAssistantMessageWritten) {
      await appendPortalStoppedAssistant({
        threadId: portalThreadId,
        userMessageId: portalUserMessageId,
        sessionId: portalRuntimeSessionId,
        runId: portalRunId,
        assistantMessageId: portalAssistantMessageId,
        reason: "explicit_cancel"
      }).catch((error) => {
        console.warn("portal chat failed to append stopped assistant", {
          threadId: portalThreadId,
          userMessageId: portalUserMessageId,
          sessionId: portalRuntimeSession?.sessionId,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
    }
    if (!cancelled && portalTurnFailure && portalThreadId && portalUserMessageId && portalRuntimeSessionId && !portalAssistantMessageWritten) {
      await appendPortalFailedAssistant({
        threadId: portalThreadId,
        userMessageId: portalUserMessageId,
        sessionId: portalRuntimeSessionId,
        runId: portalRunId,
        assistantMessageId: portalAssistantMessageId,
        autoRecoveryAttempted: portalAutoRecoveryAttempted
      }).catch((error) => {
        console.warn("portal chat failed to append failed assistant", {
          threadId: portalThreadId,
          userMessageId: portalUserMessageId,
          sessionId: portalRuntimeSession?.sessionId,
          detail: error instanceof Error ? error.message : String(error)
        });
      });
    }
    if (cancelled) {
      await retireLiveRuntimeSession(portalRuntimeSession, {
        status: "ended",
        reason: "portal explicit cancel",
        logLabel: "portal chat"
      });
    } else if (portalRuntimeFailure) {
      await retireLiveRuntimeSession(portalRuntimeSession, {
        status: "failed",
        reason: `portal runtime failure: ${portalRuntimeFailure}`,
        logLabel: "portal chat"
      });
    }
    if (streamAbort.lastEventName) {
      logPortalStream("last_sse_event_sent", {
        last_sse_event_sent: streamAbort.lastEventName,
        last_sse_event_sent_at: streamAbort.lastEventAt?.toISOString(),
        lifecycle: streamAbort.snapshot()
      });
    }
    logPortalStream("stream_closed", {
      cancelled,
      explicit_cancel_aborted: explicitCancel.signal.aborted,
      client_disconnected: streamAbort.disconnected,
      disconnect_reason: streamAbort.reason,
      runtime_started: portalRuntimeStarted,
      runtime_failure: portalRuntimeFailure ? portalRuntimeFailure.slice(0, 500) : undefined,
      auto_recovery_attempted: portalAutoRecoveryAttempted,
      run_attempt: portalLastRunAttempt,
      assistant_message_written: portalAssistantMessageWritten,
      last_sse_event_sent: streamAbort.lastEventName,
      last_sse_event_sent_at: streamAbort.lastEventAt?.toISOString(),
      lifecycle: streamAbort.snapshot()
    });
    unregisterPortalRun?.();
    runAbort.dispose();
    streamAbort.markSettled();
    streamAbort.dispose();
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

async function cleanupExpiredSessions() {
  const expiredSessionIds = await sessions.cleanupExpired();
  for (const sessionId of expiredSessionIds) {
    liveRuntimeThreads.delete(sessionId);
  }
}

if (runsChatService) {
  setInterval(() => {
    void cleanupExpiredSessions();
  }, 60_000).unref();
}

if (runsAdminService) {
  setInterval(() => {
    void billingService.runReminderSweep().catch((error) => {
      console.warn("billing reminder sweep failed", error instanceof Error ? error.message : String(error));
    });
  }, 60 * 60_000).unref();
  setInterval(() => {
    void portalWorkspaces.purgeExpiredTrash().catch((error) => {
      console.warn("workspace trash cleanup failed", error instanceof Error ? error.message : String(error));
    });
  }, 60 * 60_000).unref();
}

if (runsChatService && isAppServerRuntimeEnabled()) {
  process.once("exit", () => {
    shutdownCodexAppServerRuntime("node process exiting");
  });
  process.once("SIGTERM", () => {
    shutdownCodexAppServerRuntime("received SIGTERM");
    process.exit(0);
  });
  process.once("SIGINT", () => {
    shutdownCodexAppServerRuntime("received SIGINT");
    process.exit(130);
  });
}

async function bootstrap() {
  await db.$connect();
  if (runsAdminService) {
    await portalWorkspaces.purgeExpiredTrash().catch((error) => {
      console.warn("workspace trash cleanup failed", error instanceof Error ? error.message : String(error));
    });
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
    zendeskAiReviewEmailReminderScheduler.start();
    conversationSecurityReviewScheduler.start();
  }
  if (runsChatService) {
    dingtalkBotStream.start();
  }
  app.listen(appConfig.port, appConfig.host, () => {
    // eslint-disable-next-line no-console
    console.log(`agent-studio-api(${appConfig.serviceRole}) listening on http://${appConfig.host}:${appConfig.port}`);
  });
  if (runsChatService) {
    void prewarmAppServerRuntimeSessions().catch((error) => {
      console.warn("failed to prewarm app-server runtime sessions", error instanceof Error ? error.message : String(error));
    });
    void zendesk.recoverInterruptedProcessingRuns({ reprocess: true }).then((result) => {
      if (result.markedFailed > 0 || result.requeued > 0) {
        console.log("recovered interrupted Zendesk runs", result);
      }
    }).catch((error) => {
      console.warn("failed to recover interrupted Zendesk runs", error instanceof Error ? error.message : String(error));
    });
  }
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("failed to bootstrap api", error);
  process.exit(1);
});
