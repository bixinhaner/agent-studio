import { api } from "../../lib/api";

import type {
  CodexMemoryFileContentResponse,
  CodexMemoryFilesResponse,
  CodexMemoryLlmSecretState,
  CodexMemoryScopeKind,
  CodexMemoryScopeListResponse
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
