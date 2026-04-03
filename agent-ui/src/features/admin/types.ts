export type AdminSection =
  | "overview"
  | "conversations"
  | "users"
  | "resources"
  | "capabilities"
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
export type AdminConversationSort = "updated_desc" | "created_desc";

export type AdminConversationUser = {
  id: string;
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
  createdAt: string;
};

export type AdminConversationSummary = {
  id: string;
  externalId: string | null;
  title: string;
  status: string;
  model: string;
  reasoningEffort: string;
  workspace: string;
  activeSession: boolean;
  createdAt: string;
  updatedAt: string;
  user: AdminConversationUser | null;
  metrics: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    feedbackCount: number;
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
  sort?: AdminConversationSort;
  page?: number;
  pageSize?: number;
};

export type AdminConversationListResponse = {
  filters: {
    query: string;
    status: AdminConversationStatusFilter;
    feedback: AdminConversationFeedbackFilter;
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

export type AdminConversationTranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
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

export type AdminUser = {
  id: string;
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
