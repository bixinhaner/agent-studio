import type {
  SystemSettingsCodexMemory,
  SystemSettingsEnterpriseContext,
  SystemSettingsEnterpriseContextFields
} from "../system-settings/types";

export type CodexMemoryScopeKind = "user_agent" | "integration_agent" | "legacy_thread" | "unknown";

export type CodexMemoryScope = {
  id: string;
  kind: CodexMemoryScopeKind;
  label: string;
  relativeHome: string;
  codexHome: string;
  memoriesPath: string;
  fileCount: number;
  totalBytes: number;
  latestModifiedAt: string | null;
  provider?: string;
  integrationInstanceId?: string;
  organizationKey?: string;
  userId?: string;
  agentSegment?: string;
  displayLabel?: string;
  displaySubtitle?: string;
  ownerName?: string;
  ownerEmail?: string;
  agentModeId?: string;
  agentName?: string;
  agentSlug?: string;
  integrationName?: string;
  integrationType?: string;
  integrationSlug?: string;
};

export type CodexMemoryScopeListResponse = {
  root: string;
  total: number;
  scopes: CodexMemoryScope[];
};

export type CodexMemoryFile = {
  path: string;
  name: string;
  bytes: number;
  modifiedAt: string;
};

export type CodexMemoryFileContent = CodexMemoryFile & {
  content: string;
  truncated: boolean;
};

export type CodexMemoryFilesResponse = {
  scope: CodexMemoryScope;
  files: CodexMemoryFile[];
};

export type CodexMemoryFileContentResponse = {
  file: CodexMemoryFileContent;
};

export type CodexMemorySettings = SystemSettingsCodexMemory;
export type EnterpriseContextSettings = SystemSettingsEnterpriseContext;
export type EnterpriseContextChannel = "portal" | "dingtalk" | "crest" | "zendesk" | "openai_compatible_api";

export type EnterpriseContextPreviewUser = {
  name?: string;
  email?: string;
  organization?: string;
  title?: string;
  employeeNo?: string;
  workPlace?: string;
  manager?: string;
  departments?: Array<{
    name: string;
    position?: string;
    isPrimary?: boolean;
    isLeader?: boolean;
  }>;
  mobile?: string;
  telephone?: string;
  lastSyncedAt?: string;
};

export type EnterpriseContextPreviewResponse = {
  enabled: boolean;
  reason?: string;
  markdown?: string;
  hash?: string;
  snapshot?: {
    source: "agent_studio_enterprise_directory";
    channel: EnterpriseContextChannel;
    generatedAt: string;
    user?: EnterpriseContextPreviewUser;
  };
};

export type EnterpriseContextFieldKey = keyof SystemSettingsEnterpriseContextFields;

export type CodexMemoryLlmSecretState = {
  hasApiKey: boolean;
  rotatedAt?: string;
  updatedAt?: string;
};

export type CodexMemoryRunStatus = "written" | "skipped_no_durable_memory" | "skipped_missing_input" | "failed";

export type CodexMemoryRunLog = {
  id: string;
  status: CodexMemoryRunStatus;
  reason: string;
  channel: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  promptChars: number;
  answerChars: number;
  relativeHome?: string;
  codexThreadId?: string;
  sessionId?: string;
  threadId?: string;
  organizationId?: string;
  userId?: string;
  model?: string;
  hasExternalContext?: boolean;
  llmProvider?: string;
  llmApiMode?: string;
  llmModel?: string;
  category?: string;
  confidence?: number;
  memoryChars?: number;
  error?: string;
  scope?: Pick<
    CodexMemoryScope,
    | "id"
    | "kind"
    | "displayLabel"
    | "displaySubtitle"
    | "ownerName"
    | "ownerEmail"
    | "agentName"
    | "agentSlug"
    | "integrationName"
    | "integrationType"
    | "integrationSlug"
  >;
};

export type CodexMemoryRunLogResponse = {
  total: number;
  summary: Record<CodexMemoryRunStatus, number>;
  runs: CodexMemoryRunLog[];
};
