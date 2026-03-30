import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";

import type {
  CreateKnowledgeSetInput,
  CreateWorkspaceInput,
  KnowledgeSetItemsResponse,
  KnowledgeSetListResponse,
  KnowledgeSetResponse,
  ResourcePoliciesResponse,
  ResourcePolicyInput,
  ResourcePolicyResourceType,
  UpdateKnowledgeSetInput,
  UpdateWorkspaceInput,
  WorkspaceKnowledgeSetBinding,
  WorkspaceKnowledgeSetBindingsResponse,
  WorkspaceListResponse,
  WorkspaceResponse
} from "./types";

function resourcePolicyPath(resourceType: ResourcePolicyResourceType, resourceId: string) {
  const segment = resourceType === "workspace" ? "workspaces" : "knowledge-sets";
  return `/api/admin/resources/${segment}/${encodeURIComponent(resourceId)}/policies`;
}

async function requestWithFetch<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  for (const [key, value] of Object.entries(authHeaders())) {
    headers.set(key, value);
  }

  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    credentials: "include",
    headers
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const message = data && typeof data.detail === "string" && data.detail ? data.detail : `请求失败(${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchWorkspaces(): Promise<WorkspaceListResponse> {
  return api<WorkspaceListResponse>("/api/admin/workspaces");
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceResponse> {
  return api<WorkspaceResponse>("/api/admin/workspaces", { method: "POST", json: input });
}

export async function updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<WorkspaceResponse> {
  return api<WorkspaceResponse>(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "PATCH",
    json: input
  });
}

export async function fetchKnowledgeSets(): Promise<KnowledgeSetListResponse> {
  return api<KnowledgeSetListResponse>("/api/admin/knowledge-sets");
}

export async function createKnowledgeSet(input: CreateKnowledgeSetInput): Promise<KnowledgeSetResponse> {
  return api<KnowledgeSetResponse>("/api/admin/knowledge-sets", { method: "POST", json: input });
}

export async function updateKnowledgeSet(
  knowledgeSetId: string,
  input: UpdateKnowledgeSetInput
): Promise<KnowledgeSetResponse> {
  return api<KnowledgeSetResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}`, {
    method: "PATCH",
    json: input
  });
}

export async function fetchWorkspaceKnowledgeSetBindings(
  workspaceId: string
): Promise<WorkspaceKnowledgeSetBindingsResponse> {
  return api<WorkspaceKnowledgeSetBindingsResponse>(
    `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/knowledge-sets`
  );
}

export async function putWorkspaceKnowledgeSetBindings(
  workspaceId: string,
  bindings: WorkspaceKnowledgeSetBinding[]
): Promise<WorkspaceKnowledgeSetBindingsResponse> {
  return api<WorkspaceKnowledgeSetBindingsResponse>(
    `/api/admin/workspaces/${encodeURIComponent(workspaceId)}/knowledge-sets`,
    {
      method: "PUT",
      json: { bindings }
    }
  );
}

export async function fetchResourcePolicies(
  resourceType: ResourcePolicyResourceType,
  resourceId: string
): Promise<ResourcePoliciesResponse> {
  return api<ResourcePoliciesResponse>(resourcePolicyPath(resourceType, resourceId));
}

export async function putResourcePolicies(
  resourceType: ResourcePolicyResourceType,
  resourceId: string,
  policies: ResourcePolicyInput[]
): Promise<ResourcePoliciesResponse> {
  return api<ResourcePoliciesResponse>(resourcePolicyPath(resourceType, resourceId), {
    method: "PUT",
    json: { policies }
  });
}

export async function fetchKnowledgeSetItems(knowledgeSetId: string): Promise<KnowledgeSetItemsResponse> {
  return api<KnowledgeSetItemsResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/items`);
}

export async function uploadKnowledgeSetFiles(
  knowledgeSetId: string,
  files: File[]
): Promise<KnowledgeSetItemsResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  return requestWithFetch<KnowledgeSetItemsResponse>(
    `/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/files`,
    {
      method: "POST",
      body: formData
    }
  );
}

export async function uploadKnowledgeSetArchive(
  knowledgeSetId: string,
  archiveName: string,
  file: File
): Promise<KnowledgeSetItemsResponse> {
  return requestWithFetch<KnowledgeSetItemsResponse>(
    `/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/archive`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Archive-Name": archiveName
      },
      body: file
    }
  );
}

export async function rebuildKnowledgeSet(knowledgeSetId: string): Promise<KnowledgeSetItemsResponse> {
  return api<KnowledgeSetItemsResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/rebuild`, {
    method: "POST"
  });
}

export async function deleteKnowledgeSetItem(
  knowledgeSetId: string,
  relativePath: string
): Promise<KnowledgeSetItemsResponse> {
  return api<KnowledgeSetItemsResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/items`, {
    method: "DELETE",
    json: { relativePath }
  });
}

export async function renameKnowledgeSetItem(
  knowledgeSetId: string,
  relativePath: string,
  nextRelativePath: string
): Promise<KnowledgeSetItemsResponse> {
  return api<KnowledgeSetItemsResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/items`, {
    method: "PATCH",
    json: { action: "rename", relativePath, nextRelativePath }
  });
}
