export type AdminSection = "overview" | "users" | "organization" | "rbac" | "monitoring";

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
