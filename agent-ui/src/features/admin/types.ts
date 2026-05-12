export type AdminSection =
  | "overview"
  | "analytics"
  | "conversations"
  | "subscriptions"
  | "access-requests"
  | "users"
  | "resources"
  | "capabilities"
  | "skill-drafts"
  | "integrations"
  | "system-settings"
  | "organization"
  | "rbac"
  | "monitoring";

export type AdminOverview = {
  counts: {
    users: number;
    threads: number;
    activeSessions: number;
  };
  integrations?: {
    zendesk?: {
      enabled: boolean;
      ready: boolean;
      missing: string[];
      hasZendeskApiToken: boolean;
      hasWebhookSigningSecret: boolean;
      lastValidatedAt: string | null;
    };
  };
};

export type AdminConversationStatusFilter = "all" | "regular" | "archived";
export type AdminConversationFeedbackFilter = "all" | "with_feedback" | "positive" | "negative" | "none";
export type AdminConversationAudienceFilter = "all" | "internal" | "external";
export type AdminConversationSort = "updated_desc" | "created_desc";
export type AdminApiAuditResultFilter = "all" | "success" | "failed";
export type AdminApiAuditDeliveryFilter = "all" | "delivered" | "client_aborted" | "connection_closed" | "unknown";
export type AdminApiAuditSort = "created_desc" | "tokens_desc" | "latency_desc";
export type AdminProductFeedbackType = "bug" | "feature_request" | "usability_issue" | "other";
export type AdminProductFeedbackTypeFilter = "all" | AdminProductFeedbackType;
export type AdminProductFeedbackSeverity = "blocking" | "high" | "medium" | "low";
export type AdminProductFeedbackStatus = "open" | "triaged" | "in_progress" | "resolved" | "closed";
export type AdminProductFeedbackStatusFilter = "all" | AdminProductFeedbackStatus;
export type AdminProductFeedbackSort = "created_desc" | "updated_desc";

export type AdminConversationUser = {
  id: string;
  userType: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
};

export type AdminConversationFeedback = {
  id: string;
  type: "positive" | "negative";
  messageId: string | null;
  contentPreview: string | null;
  comment: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type AdminConversationSummary = {
  id: string;
  externalId: string | null;
  audience: "internal" | "external" | "unknown";
  title: string;
  status: string;
  model: string;
  reasoningEffort: string;
  workspace: string;
  enabledSkillNames: string[];
  activeSession: boolean;
  createdAt: string;
  updatedAt: string;
  user: AdminConversationUser | null;
  metrics: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    feedbackCount: number;
    userAttachmentCount: number;
  };
  preview: {
    firstUserText: string | null;
    latestText: string | null;
  };
  feedbackSummary: {
    total: number;
    positive: number;
    negative: number;
    latestAt: string | null;
  };
  feedback: AdminConversationFeedback[];
};

export type AdminConversationListInput = {
  query?: string;
  status?: AdminConversationStatusFilter;
  feedback?: AdminConversationFeedbackFilter;
  audience?: AdminConversationAudienceFilter;
  sort?: AdminConversationSort;
  page?: number;
  pageSize?: number;
};

export type AdminConversationListResponse = {
  filters: {
    query: string;
    status: AdminConversationStatusFilter;
    feedback: AdminConversationFeedbackFilter;
    audience: AdminConversationAudienceFilter;
    sort: AdminConversationSort;
  };
  summary: {
    totalThreads: number;
    threadsWithFeedback: number;
    totalFeedback: number;
    positiveFeedback: number;
    negativeFeedback: number;
    uniqueUsers: number;
  };
  page: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  conversations: AdminConversationSummary[];
};

export type AdminConversationTranscriptAttachment = {
  id: string;
  kind: "image" | "document" | "file";
  name: string;
  mimeType: string | null;
  bytes: number | null;
  path: string | null;
  relativePath: string | null;
  contentUrl: string | null;
};

export type AdminConversationTranscriptProcessRow = {
  id: string;
  kind: "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
  title: string;
  detail?: string;
  at?: string;
};

export type AdminConversationTranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  attachments: AdminConversationTranscriptAttachment[];
  processRows?: AdminConversationTranscriptProcessRow[];
  parentId: string | null;
  createdAt: string | null;
  hasRunConfig: boolean;
};

export type AdminConversationDetailResponse = {
  conversation: AdminConversationSummary;
  transcript: {
    messageCount: number;
    messages: AdminConversationTranscriptMessage[];
  };
};

export type AdminApiAuditRecord = {
  id: string;
  sessionId: string | null;
  clientIp: string | null;
  integration: {
    id: string | null;
    slug: string | null;
    name: string | null;
  };
  model: string;
  requestedModel: string | null;
  requestedReasoningEffort: string | null;
  stream: boolean;
  messageCount: number;
  preview: {
    prompt: string | null;
    latest: string | null;
  };
  metrics: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: string;
    internalCost: string;
    outputChars: number;
    responseStartedMs: number | null;
    responseReadyMs: number | null;
    responseCompletedMs: number | null;
  };
  transport: {
    responseMode: string;
    requestAborted: boolean;
    responseFinished: boolean;
    responseClosedBeforeFinish: boolean;
    responseStatusCode: number | null;
  };
  status: {
    result: string;
    delivery: string;
  };
  errorMessage: string | null;
  agentModeId: string | null;
  knowledgeSetIds: string[];
  createdAt: string;
  responseStartedAt: string | null;
  responseReadyAt: string | null;
  responseCompletedAt: string | null;
};

export type AdminApiAuditListInput = {
  query?: string;
  result?: AdminApiAuditResultFilter;
  delivery?: AdminApiAuditDeliveryFilter;
  sort?: AdminApiAuditSort;
  page?: number;
  pageSize?: number;
};

export type AdminApiAuditListResponse = {
  filters: {
    query: string;
    result: AdminApiAuditResultFilter;
    delivery: AdminApiAuditDeliveryFilter;
    sort: AdminApiAuditSort;
  };
  summary: {
    totalRequests: number;
    successCount: number;
    failureCount: number;
    deliveredCount: number;
    deliveryFailureCount: number;
    streamCount: number;
    uniqueIps: number;
    missingIpCount: number;
  };
  page: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  records: AdminApiAuditRecord[];
};

export type AdminApiAuditDetailResponse = {
  record: AdminApiAuditRecord;
  relatedSummary: {
    sameIpRequests: number;
    sameSessionRequests: number;
    sameIntegrationRequests: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
};

export type AdminProductFeedbackRecord = {
  id: string;
  organizationId?: string;
  userId?: string;
  threadId?: string;
  type: AdminProductFeedbackType;
  severity?: AdminProductFeedbackSeverity;
  description: string;
  context?: unknown;
  status: AdminProductFeedbackStatus;
  assigneeUserId?: string;
  createdAt: string;
  updatedAt: string;
  user: AdminConversationUser | null;
};

export type AdminProductFeedbackListInput = {
  query?: string;
  type?: AdminProductFeedbackTypeFilter;
  status?: AdminProductFeedbackStatusFilter;
  sort?: AdminProductFeedbackSort;
  page?: number;
  pageSize?: number;
};

export type AdminProductFeedbackListResponse = {
  filters: {
    query: string;
    type: AdminProductFeedbackTypeFilter;
    status: AdminProductFeedbackStatusFilter;
    sort: AdminProductFeedbackSort;
  };
  summary: {
    totalFeedback: number;
    openCount: number;
    triagedCount: number;
    inProgressCount: number;
    resolvedCount: number;
    closedCount: number;
    bugCount: number;
    featureRequestCount: number;
    usabilityIssueCount: number;
    uniqueUsers: number;
  };
  page: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  feedback: AdminProductFeedbackRecord[];
};

export type AdminProductFeedbackDetailResponse = {
  feedback: AdminProductFeedbackRecord;
};

export type AdminSubscriptionSourceMode =
  | "user"
  | "organization"
  | "default_internal"
  | "default_external";

export type AdminSubscriptionAccessStatus =
  | "available"
  | "paused"
  | "scheduled"
  | "expired"
  | "exhausted"
  | "restricted";

export type AdminSubscriptionGrantSummary = {
  id: string;
  planId: string | null;
  planName: string | null;
  planSlug: string | null;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  cycleAnchorAt: string;
  note: string | null;
  completedTurnLimitOverride: number | null;
  tokenLimitOverride: number | null;
  monthlyCompletedTurnLimit: number | null;
  monthlyTokenLimit: number | null;
  usage: {
    cycleStartsAt: string;
    cycleEndsAt: string;
    usedCompletedTurns: number;
    usedTokens: number;
    remainingCompletedTurns: number | null;
    remainingTokens: number | null;
  } | null;
  access: {
    status: AdminSubscriptionAccessStatus;
    title: string;
    description: string;
    reasonCode: string | null;
  };
};

export type AdminSubscriptionPlan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  featureType: string;
  monthlyCompletedTurnLimit: number | null;
  monthlyTokenLimit: number | null;
  createdAt: string;
  updatedAt: string;
  assignmentCount: {
    users: number;
    organizations: number;
  };
};

export type AdminSubscriptionPlansResponse = {
  plans: AdminSubscriptionPlan[];
};

export type AdminSubscriptionPlanInput = {
  name: string;
  slug?: string;
  description?: string | null;
  status?: string;
  monthlyCompletedTurnLimit?: number | null;
  monthlyTokenLimit?: number | null;
};

export type AdminSubscriptionPlanDetailResponse = {
  plan: AdminSubscriptionPlan;
};

export type AdminSubscriptionOrganizationSummary = {
  id: string;
  name: string;
  slug: string | null;
  type: string | null;
  status?: string;
};

export type AdminSubscriptionUserRecord = {
  id: string;
  displayName: string | null;
  email: string | null;
  userType: string;
  organization: AdminSubscriptionOrganizationSummary | null;
  source: {
    mode: AdminSubscriptionSourceMode;
    label: string;
    planName: string | null;
  };
  access: {
    status: AdminSubscriptionAccessStatus;
    title: string;
    description: string;
  };
  userGrant: AdminSubscriptionGrantSummary | null;
  organizationGrant: AdminSubscriptionGrantSummary | null;
};

export type AdminSubscriptionUsersResponse = {
  summary: {
    totalUsers: number;
    explicitUserSubscriptions: number;
    coveredByOrganization: number;
    internalDefaultUnlimited: number;
    externalRestrictedByDefault: number;
    blockedUsers: number;
    expiringSoon: number;
  };
  users: AdminSubscriptionUserRecord[];
};

export type AdminSubscriptionOrganizationRecord = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  memberCount: number;
  source: {
    mode: AdminSubscriptionSourceMode;
    label: string;
    planName: string | null;
  };
  access: {
    status: AdminSubscriptionAccessStatus;
    title: string;
    description: string;
  };
  grant: AdminSubscriptionGrantSummary | null;
};

export type AdminSubscriptionOrganizationsResponse = {
  summary: {
    totalOrganizations: number;
    explicitOrganizationSubscriptions: number;
    internalDefaultUnlimited: number;
    externalNeedSubscription: number;
    blockedOrganizations: number;
    expiringSoon: number;
  };
  organizations: AdminSubscriptionOrganizationRecord[];
};

export type AdminSubscriptionGrantInput = {
  planId?: string | null;
  status?: string;
  startsAt: string;
  expiresAt?: string | null;
  cycleAnchorAt?: string | null;
  completedTurnLimitOverride?: number | null;
  tokenLimitOverride?: number | null;
  note?: string | null;
};

export type AdminSubscriptionGrantDetailResponse = {
  grant: AdminSubscriptionGrantSummary;
};

export type AdminSubscriptionDenialRecord = {
  id: string;
  reasonCode: string;
  title: string;
  detail: string | null;
  model: string | null;
  threadId: string | null;
  sessionId: string | null;
  createdAt: string;
  user: {
    id: string;
    displayName: string | null;
    email: string | null;
  } | null;
  organization: AdminSubscriptionOrganizationSummary | null;
};

export type AdminSubscriptionDenialsResponse = {
  events: AdminSubscriptionDenialRecord[];
};

export type AdminUser = {
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
    dingtalkOpenId?: string | null;
    dingtalkCorpId?: string | null;
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

export type AdminUserListResponse = {
  users: AdminUser[];
};

export type AdminUserDetailResponse = {
  user: AdminUser;
};

export type AdminUserLocalSettingsInput = {
  role: string;
  manualDisabled: boolean;
  adminNote?: string | null;
};

export type AdminCustomerOrganization = {
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

export type AdminCustomerOrganizationListResponse = {
  organizations: AdminCustomerOrganization[];
};

export type AdminCustomerOrganizationDetailResponse = {
  organization: AdminCustomerOrganization;
};

export type AdminCustomerOrganizationCreateInput = {
  name: string;
  status?: string;
};

export type AdminCustomerOrganizationUpdateInput = {
  name?: string;
  status?: string;
};

export type AdminExternalInviteInput = {
  organizationId: string;
  email: string;
  membershipType: string;
};

export type AdminCreatedInvite = {
  id: string;
  organizationId: string;
  email: string;
  status: string;
  expiresAt?: string | null;
};

export type AdminDepartmentNode = {
  id: string;
  organizationId?: string;
  externalId: string;
  name: string;
  parentDepartmentId?: string;
  sortOrder: number;
  status: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  children: AdminDepartmentNode[];
};

export type DepartmentTreeResponse = {
  departments: AdminDepartmentNode[];
};

export type OrgSyncConfig = {
  enabled: boolean;
  intervalMinutes: number;
};

export type OrgSyncConfigResponse = {
  orgSync: OrgSyncConfig;
};

export type OrgSyncJob = {
  id: string;
  status: string;
  summary: Record<string, unknown> | null;
  provider?: string;
  scopeType?: string;
  scopeExternalId?: string | null;
  triggerType?: string;
  triggeredByUserId?: string | null;
  updatedAt?: string;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type OrgSyncJobListResponse = {
  jobs: OrgSyncJob[];
};

export type OrgSyncTriggerResponse = {
  job: OrgSyncJob;
};
