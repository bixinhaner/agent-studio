import type { SystemSettingsCodexMemory } from "../system-settings/types";

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
  scope: Pick<CodexMemoryScope, "id" | "kind" | "label" | "relativeHome" | "codexHome" | "memoriesPath">;
  files: CodexMemoryFile[];
};

export type CodexMemoryFileContentResponse = {
  file: CodexMemoryFileContent;
};

export type CodexMemorySettings = SystemSettingsCodexMemory;
