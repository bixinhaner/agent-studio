import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";

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

export async function fetchPortalWorkspace(): Promise<{
  workspace: PortalWorkspaceSummary;
  nodes: PortalWorkspaceNode[];
}> {
  return api("/api/portal/workspace");
}

export async function fetchPortalWorkspaceNodes(
  parentId?: string,
  options?: { includeMigrated?: boolean }
): Promise<PortalWorkspaceNode[]> {
  const query = new URLSearchParams();
  if (parentId) query.set("parent_id", parentId);
  if (options?.includeMigrated) query.set("include_migrated", "1");
  const out = await api<{ nodes: PortalWorkspaceNode[] }>(
    `/api/portal/workspace/nodes${query.toString() ? `?${query.toString()}` : ""}`
  );
  return Array.isArray(out.nodes) ? out.nodes : [];
}

export async function fetchPortalWorkspaceNode(nodeId: string): Promise<PortalWorkspaceNode> {
  const out = await api<{ node: PortalWorkspaceNode }>(
    `/api/portal/workspace/nodes/${encodeURIComponent(nodeId)}`
  );
  return out.node;
}

export async function fetchPortalWorkspaceFolderAncestorPaths(
  folderIds: readonly string[]
): Promise<Record<string, string[]>> {
  const normalizedFolderIds = Array.from(
    new Set(folderIds.map((folderId) => String(folderId || "").trim()).filter(Boolean))
  );
  if (normalizedFolderIds.length === 0) return {};
  const query = new URLSearchParams({ folder_ids: normalizedFolderIds.join(",") });
  const out = await api<{ paths?: Record<string, unknown> }>(
    `/api/portal/workspace/folder-ancestor-paths?${query.toString()}`
  );
  const paths: Record<string, string[]> = {};
  for (const [folderId, value] of Object.entries(out.paths || {})) {
    if (!Array.isArray(value)) continue;
    paths[folderId] = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return paths;
}

export async function fetchPortalFolderTasks(folderId: string): Promise<PortalWorkspaceFolderTasksResult> {
  const out = await api<{
    tasks: PortalWorkspaceTask[];
    summary?: PortalWorkspaceFolderTaskSummary;
  }>(
    `/api/portal/workspace/folders/${encodeURIComponent(folderId)}/tasks?take=500`
  );
  const tasks = Array.isArray(out.tasks) ? out.tasks : [];
  return {
    tasks,
    summary: out.summary || {
      task_count: tasks.length,
      tasks_with_files: tasks.filter((task) => task.file_count > 0).length,
      file_count: tasks.reduce((count, task) => count + Math.max(task.file_count || 0, 0), 0)
    }
  };
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
  return api(`/api/portal/workspace/search?q=${encodeURIComponent(query.trim())}`);
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
  const payload = text ? JSON.parse(text) as { file?: PortalWorkspaceNode; detail?: string } : {};
  if (!response.ok || !payload.file) {
    throw new Error(payload.detail || `Failed to upload file (${response.status})`);
  }
  return payload.file;
}
