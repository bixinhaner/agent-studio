import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";

export const PORTAL_WORKSPACE_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;

export type PortalWorkspaceUploadFailureCode = "too-large" | "quota" | "request";

export class PortalWorkspaceUploadError extends Error {
  constructor(
    public readonly code: PortalWorkspaceUploadFailureCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "PortalWorkspaceUploadError";
  }
}

export type PortalWorkspaceSummary = {
  id: string;
  name: string;
  status: string;
  quota_bytes: number;
  used_bytes: number;
  history_folder_id: string;
};

export type PortalWorkspaceNode = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  system_key: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  state: "active" | "trashed";
  created_by_type: string;
  source_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PortalWorkspaceTask = {
  id: string;
  title: string;
  status: "regular" | "archived";
  folder_id: string | null;
  file_count: number;
  created_at: string;
  updated_at: string;
};

export type PortalWorkspaceFolderTaskSummary = {
  task_count: number;
  tasks_with_files: number;
  file_count: number;
};

export type PortalWorkspaceFolderTasksResult = {
  tasks: PortalWorkspaceTask[];
  summary: PortalWorkspaceFolderTaskSummary;
};

export type PortalWorkspaceDataSource = {
  apiBasePath: string;
  fetchWorkspace(): Promise<{ workspace: PortalWorkspaceSummary; nodes: PortalWorkspaceNode[] }>;
  fetchNodes(parentId?: string, options?: { includeMigrated?: boolean }): Promise<PortalWorkspaceNode[]>;
  fetchNode(nodeId: string): Promise<PortalWorkspaceNode>;
  fetchFolderAncestorPaths(folderIds: readonly string[]): Promise<Record<string, string[]>>;
  fetchFolderTasks(folderId: string): Promise<PortalWorkspaceFolderTasksResult>;
  fetchTaskFiles(threadId: string): Promise<PortalWorkspaceNode[]>;
  search(query: string): Promise<{ nodes: PortalWorkspaceNode[]; tasks: PortalWorkspaceTask[] }>;
};

function createWorkspaceReadDataSource(apiBasePath: string): PortalWorkspaceDataSource {
  const normalizedBasePath = apiBasePath.replace(/\/$/, "");
  return {
    apiBasePath: normalizedBasePath,
    fetchWorkspace: () => api(normalizedBasePath),
    async fetchNodes(parentId, options) {
      const query = new URLSearchParams();
      if (parentId) query.set("parent_id", parentId);
      if (options?.includeMigrated) query.set("include_migrated", "1");
      const out = await api<{ nodes: PortalWorkspaceNode[] }>(
        `${normalizedBasePath}/nodes${query.toString() ? `?${query.toString()}` : ""}`
      );
      return Array.isArray(out.nodes) ? out.nodes : [];
    },
    async fetchNode(nodeId) {
      const out = await api<{ node: PortalWorkspaceNode }>(
        `${normalizedBasePath}/nodes/${encodeURIComponent(nodeId)}`
      );
      return out.node;
    },
    async fetchFolderAncestorPaths(folderIds) {
      const normalizedFolderIds = Array.from(
        new Set(folderIds.map((folderId) => String(folderId || "").trim()).filter(Boolean))
      );
      if (normalizedFolderIds.length === 0) return {};
      const query = new URLSearchParams({ folder_ids: normalizedFolderIds.join(",") });
      const out = await api<{ paths?: Record<string, unknown> }>(
        `${normalizedBasePath}/folder-ancestor-paths?${query.toString()}`
      );
      const paths: Record<string, string[]> = {};
      for (const [folderId, value] of Object.entries(out.paths || {})) {
        if (!Array.isArray(value)) continue;
        paths[folderId] = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      }
      return paths;
    },
    async fetchFolderTasks(folderId) {
      const out = await api<{
        tasks: PortalWorkspaceTask[];
        summary?: PortalWorkspaceFolderTaskSummary;
      }>(`${normalizedBasePath}/folders/${encodeURIComponent(folderId)}/tasks?take=500`);
      const tasks = Array.isArray(out.tasks) ? out.tasks : [];
      return {
        tasks,
        summary: out.summary || {
          task_count: tasks.length,
          tasks_with_files: tasks.filter((task) => task.file_count > 0).length,
          file_count: tasks.reduce((count, task) => count + Math.max(task.file_count || 0, 0), 0)
        }
      };
    },
    async fetchTaskFiles(threadId) {
      const out = await api<{ files: PortalWorkspaceNode[] }>(
        `${normalizedBasePath}/tasks/${encodeURIComponent(threadId)}/files`
      );
      return Array.isArray(out.files) ? out.files : [];
    },
    search: (query) => api(`${normalizedBasePath}/search?q=${encodeURIComponent(query.trim())}`)
  };
}

export const PORTAL_WORKSPACE_DATA_SOURCE = createWorkspaceReadDataSource("/api/portal/workspace");
export const TRAINING_WORKSPACE_DATA_SOURCE = createWorkspaceReadDataSource("/api/portal/training");

export async function fetchPortalWorkspace(): Promise<{
  workspace: PortalWorkspaceSummary;
  nodes: PortalWorkspaceNode[];
}> {
  return PORTAL_WORKSPACE_DATA_SOURCE.fetchWorkspace();
}

export async function fetchPortalWorkspaceNodes(
  parentId?: string,
  options?: { includeMigrated?: boolean }
): Promise<PortalWorkspaceNode[]> {
  return PORTAL_WORKSPACE_DATA_SOURCE.fetchNodes(parentId, options);
}

export async function fetchPortalWorkspaceNode(nodeId: string): Promise<PortalWorkspaceNode> {
  return PORTAL_WORKSPACE_DATA_SOURCE.fetchNode(nodeId);
}

export async function fetchPortalWorkspaceFolderAncestorPaths(
  folderIds: readonly string[]
): Promise<Record<string, string[]>> {
  return PORTAL_WORKSPACE_DATA_SOURCE.fetchFolderAncestorPaths(folderIds);
}

export async function fetchPortalFolderTasks(folderId: string): Promise<PortalWorkspaceFolderTasksResult> {
  return PORTAL_WORKSPACE_DATA_SOURCE.fetchFolderTasks(folderId);
}

export async function fetchPortalRecentWorkspace(): Promise<{
  nodes: PortalWorkspaceNode[];
  tasks: PortalWorkspaceTask[];
}> {
  return api("/api/portal/workspace/recent?take=50");
}

export async function fetchPortalWorkspaceTrash(): Promise<{
  nodes: PortalWorkspaceNode[];
  tasks: PortalWorkspaceTask[];
}> {
  return api("/api/portal/workspace/trash?take=200");
}

export async function fetchPortalAgentOutputs(): Promise<{
  nodes: PortalWorkspaceNode[];
  tasks: PortalWorkspaceTask[];
}> {
  return api("/api/portal/workspace/agent-outputs?take=100");
}

export async function searchPortalWorkspace(query: string): Promise<{
  nodes: PortalWorkspaceNode[];
  tasks: PortalWorkspaceTask[];
}> {
  return PORTAL_WORKSPACE_DATA_SOURCE.search(query);
}

export async function createPortalWorkspaceFolder(name: string, parentId?: string): Promise<PortalWorkspaceNode> {
  const out = await api<{ node: PortalWorkspaceNode }>("/api/portal/workspace/folders", {
    method: "POST",
    json: {
      name,
      parent_id: parentId || null
    }
  });
  return out.node;
}

export async function uploadPortalWorkspaceFile(input: {
  file: File;
  parentId?: string;
  threadId?: string;
}): Promise<PortalWorkspaceNode> {
  if (input.file.size > PORTAL_WORKSPACE_UPLOAD_MAX_BYTES) {
    throw new PortalWorkspaceUploadError("too-large", "File exceeds the workspace upload limit.");
  }
  const response = await fetch(`${apiBase()}/api/portal/workspace/files`, {
    method: "POST",
    credentials: "include",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(input.file.name),
      "X-File-Type": input.file.type || "application/octet-stream",
      "X-File-Conflict": "keep_both",
      ...(input.parentId ? { "X-Parent-Id": input.parentId } : {}),
      ...(input.threadId ? { "X-Thread-Id": input.threadId } : {})
    },
    body: input.file
  });
  const text = await response.text();
  if (!response.ok) notifyAuthInvalidStatus(response.status);
  let payload: { file?: PortalWorkspaceNode; detail?: string } = {};
  if (text) {
    try {
      payload = JSON.parse(text) as { file?: PortalWorkspaceNode; detail?: string };
    } catch {
      payload = {};
    }
  }
  if (!response.ok || !payload.file) {
    const detail = String(payload.detail || "");
    const code: PortalWorkspaceUploadFailureCode =
      response.status === 413 && /quota/i.test(detail) ? "quota" : response.status === 413 ? "too-large" : "request";
    throw new PortalWorkspaceUploadError(code, detail || `Failed to upload file (${response.status})`, response.status);
  }
  return payload.file;
}
