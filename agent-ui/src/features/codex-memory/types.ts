import type {
  SystemSettingsCodexMemory,
  SystemSettingsEnterpriseContext,
  SystemSettingsEnterpriseContextFields,
  SystemSettingsPythonRuntime
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
export type PythonRuntimeSettings = SystemSettingsPythonRuntime;
export type EnterpriseContextChannel = "portal" | "dingtalk" | "crest" | "zendesk" | "openai_compatible_api";

export type PythonRuntimeCapabilityStatus = {
  key: "spreadsheets" | "documents" | "images" | "translation";
  label: string;
  status: "ready" | "partial" | "missing";
  available: string[];
  missing: string[];
};

export type PythonRuntimeStatus = {
  enabled: boolean;
  runtimeExists: boolean;
  runtimeBytes: number;
  pythonVersion?: string;
  envKeys: string[];
  capabilities: PythonRuntimeCapabilityStatus[];
  duplicateArtifacts: {
    sessionVirtualenvCount: number;
    argosCacheCount: number;
    argosDataCount: number;
    scanned: boolean;
  };
  checkedAt: string;
};

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

export type CodexMemoryBackfillRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type CodexMemoryBackfillFilters = {
  channels?: string[];
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
};

export type CodexMemoryBackfillChannelSummary = {
  channel: string;
  totalPairs: number;
  readyItems: number;
  skippedMissingInput: number;
  alreadyProcessed: number;
};

export type CodexMemoryBackfillPreview = {
  totalPairs: number;
  readyItems: number;
  skippedMissingInput: number;
  alreadyProcessed: number;
  estimatedLlmCalls: number;
  byChannel: CodexMemoryBackfillChannelSummary[];
};

export type CodexMemoryBackfillRun = {
  id: string;
  status: CodexMemoryBackfillRunStatus;
  name?: string;
  filters: CodexMemoryBackfillFilters;
  dryRun: boolean;
  totalItems: number;
  processedItems: number;
  writtenItems: number;
  skippedNoDurableItems: number;
  skippedMissingInputItems: number;
  failedItems: number;
  alreadyProcessedItems: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodexMemoryBackfillRunListResponse = {
  total: number;
  runs: CodexMemoryBackfillRun[];
};
