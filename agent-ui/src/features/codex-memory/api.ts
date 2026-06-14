import { api } from "../../lib/api";

import type {
  CodexMemoryBackfillFilters,
  CodexMemoryBackfillPreview,
  CodexMemoryBackfillRun,
  CodexMemoryBackfillRunListResponse,
  CodexMemoryFileContentResponse,
  CodexMemoryFilesResponse,
  CodexMemoryLlmSecretState,
  CodexMemoryRunLogResponse,
  CodexMemoryRunStatus,
  CodexMemoryScopeKind,
  CodexMemoryScopeListResponse,
  EnterpriseContextChannel,
  EnterpriseContextPreviewResponse,
  EnterpriseContextSettings
} from "./types";

export async function fetchCodexMemoryScopes(input: {
  query?: string;
  kind?: CodexMemoryScopeKind | "all";
  limit?: number;
} = {}): Promise<CodexMemoryScopeListResponse> {
  const query = new URLSearchParams();
  if (input.query) query.set("query", input.query);
  if (input.kind && input.kind !== "all") query.set("kind", input.kind);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.toString();
  return api<CodexMemoryScopeListResponse>(`/api/admin/codex-memory/scopes${suffix ? `?${suffix}` : ""}`);
}

export async function fetchCodexMemoryFiles(scopeId: string): Promise<CodexMemoryFilesResponse> {
  return api<CodexMemoryFilesResponse>(`/api/admin/codex-memory/scopes/${encodeURIComponent(scopeId)}/files`);
}

export async function fetchCodexMemoryFileContent(
  scopeId: string,
  filePath: string
): Promise<CodexMemoryFileContentResponse> {
  const query = new URLSearchParams({ path: filePath });
  return api<CodexMemoryFileContentResponse>(
    `/api/admin/codex-memory/scopes/${encodeURIComponent(scopeId)}/files/content?${query.toString()}`
  );
}

export async function saveCodexMemoryFileContent(
  scopeId: string,
  filePath: string,
  content: string
): Promise<CodexMemoryFileContentResponse> {
  return api<CodexMemoryFileContentResponse>(
    `/api/admin/codex-memory/scopes/${encodeURIComponent(scopeId)}/files/content`,
    {
      method: "PUT",
      json: {
        path: filePath,
        content
      }
    }
  );
}

export async function deleteCodexMemoryFile(scopeId: string, filePath: string): Promise<void> {
  const query = new URLSearchParams({ path: filePath });
  await api<Record<string, never>>(
    `/api/admin/codex-memory/scopes/${encodeURIComponent(scopeId)}/files/content?${query.toString()}`,
    {
      method: "DELETE"
    }
  );
}

export async function clearCodexMemoryScope(scopeId: string): Promise<void> {
  await api<Record<string, never>>(`/api/admin/codex-memory/scopes/${encodeURIComponent(scopeId)}`, {
    method: "DELETE"
  });
}

export async function fetchCodexMemoryLlmSecretState(): Promise<CodexMemoryLlmSecretState> {
  return api<CodexMemoryLlmSecretState>("/api/admin/codex-memory/llm-secret");
}

export async function saveCodexMemoryLlmSecret(input: {
  apiKey?: string;
  clearApiKey?: boolean;
}): Promise<CodexMemoryLlmSecretState> {
  return api<CodexMemoryLlmSecretState>("/api/admin/codex-memory/llm-secret", {
    method: "PUT",
    json: input
  });
}

export async function fetchCodexMemoryRuns(input: {
  query?: string;
  status?: CodexMemoryRunStatus | "all";
  channel?: string;
  limit?: number;
} = {}): Promise<CodexMemoryRunLogResponse> {
  const query = new URLSearchParams();
  if (input.query) query.set("query", input.query);
  if (input.status && input.status !== "all") query.set("status", input.status);
  if (input.channel) query.set("channel", input.channel);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.toString();
  return api<CodexMemoryRunLogResponse>(`/api/admin/codex-memory/runs${suffix ? `?${suffix}` : ""}`);
}

export async function previewCodexMemoryBackfill(filters: CodexMemoryBackfillFilters): Promise<CodexMemoryBackfillPreview> {
  return api<CodexMemoryBackfillPreview>("/api/admin/codex-memory/backfills/preview", {
    method: "POST",
    json: filters
  });
}

export async function fetchCodexMemoryBackfillRuns(input: { limit?: number } = {}): Promise<CodexMemoryBackfillRunListResponse> {
  const query = new URLSearchParams();
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.toString();
  return api<CodexMemoryBackfillRunListResponse>(`/api/admin/codex-memory/backfills${suffix ? `?${suffix}` : ""}`);
}

export async function createCodexMemoryBackfillRun(input: {
  filters: CodexMemoryBackfillFilters;
  dryRun?: boolean;
  name?: string;
}): Promise<CodexMemoryBackfillRun> {
  return api<CodexMemoryBackfillRun>("/api/admin/codex-memory/backfills", {
    method: "POST",
    json: input
  });
}

export async function pauseCodexMemoryBackfillRun(runId: string): Promise<CodexMemoryBackfillRun> {
  return api<CodexMemoryBackfillRun>(`/api/admin/codex-memory/backfills/${encodeURIComponent(runId)}/pause`, {
    method: "POST"
  });
}

export async function resumeCodexMemoryBackfillRun(runId: string): Promise<CodexMemoryBackfillRun> {
  return api<CodexMemoryBackfillRun>(`/api/admin/codex-memory/backfills/${encodeURIComponent(runId)}/resume`, {
    method: "POST"
  });
}

export async function cancelCodexMemoryBackfillRun(runId: string): Promise<CodexMemoryBackfillRun> {
  return api<CodexMemoryBackfillRun>(`/api/admin/codex-memory/backfills/${encodeURIComponent(runId)}/cancel`, {
    method: "POST"
  });
}

export async function previewEnterpriseContext(input: {
  channel: EnterpriseContextChannel;
  userId?: string;
  agentModeId?: string;
  settings: EnterpriseContextSettings;
}): Promise<EnterpriseContextPreviewResponse> {
  return api<EnterpriseContextPreviewResponse>("/api/admin/codex-memory/enterprise-context/preview", {
    method: "POST",
    json: input
  });
}
