import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";

import type {
  CreateKnowledgeSetInput,
  DeleteKnowledgeSetResponse,
  KnowledgeSetLibraryResponse,
  KnowledgeSetItemsResponse,
  KnowledgeSetListResponse,
  KnowledgeSetResponse,
  KnowledgeSetTreeResponse,
  ResourcePoliciesResponse,
  ResourcePolicyInput,
  ResourcePolicyResourceType,
  UpdateKnowledgeSetInput
} from "./types";

function resourcePolicyPath(resourceType: ResourcePolicyResourceType, resourceId: string) {
  if (resourceType !== "knowledge_set") {
    throw new Error("unsupported resource policy resource type");
  }
  return `/api/admin/resources/knowledge-sets/${encodeURIComponent(resourceId)}/policies`;
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

export async function deleteKnowledgeSet(knowledgeSetId: string): Promise<DeleteKnowledgeSetResponse> {
  return api<DeleteKnowledgeSetResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}`, {
    method: "DELETE"
  });
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

export async function fetchKnowledgeSetLibrary(knowledgeSetId: string): Promise<KnowledgeSetLibraryResponse> {
  return api<KnowledgeSetLibraryResponse>(`/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/summary`);
}

export async function fetchKnowledgeSetTree(
  knowledgeSetId: string,
  input: { path?: string; includeJsonl?: boolean } = {}
): Promise<KnowledgeSetTreeResponse> {
  const params = new URLSearchParams();
  if (input.path?.trim()) {
    params.set("path", input.path.trim());
  }
  if (input.includeJsonl) {
    params.set("includeJsonl", "true");
  }
  const query = params.toString();
  return api<KnowledgeSetTreeResponse>(
    `/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/tree${query ? `?${query}` : ""}`
  );
}

export async function fetchKnowledgeSetFileText(knowledgeSetId: string, relativePath: string): Promise<string> {
  const query = new URLSearchParams({ path: relativePath });
  const response = await fetch(
    `${apiBase()}/api/admin/knowledge-sets/${encodeURIComponent(knowledgeSetId)}/files/content?${query.toString()}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        ...authHeaders()
      }
    }
  );

  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const text = await response.text();
    let detail = `请求失败(${response.status})`;
    if (text) {
      try {
        const payload = JSON.parse(text) as { detail?: string };
        if (typeof payload.detail === "string" && payload.detail.trim()) {
          detail = payload.detail.trim();
        }
      } catch {
        // ignore non-json error payload
      }
    }
    throw new Error(detail);
  }

  return response.text();
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
