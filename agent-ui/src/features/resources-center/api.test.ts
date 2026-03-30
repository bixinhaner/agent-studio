import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: vi.fn(),
  apiBase: () => "http://127.0.0.1:8787",
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
  notifyAuthInvalidStatus: vi.fn()
}));

import { api } from "../../lib/api";
import {
  createKnowledgeSet,
  createWorkspace,
  deleteKnowledgeSetItem,
  fetchKnowledgeSetItems,
  fetchKnowledgeSets,
  fetchResourcePolicies,
  fetchWorkspaceKnowledgeSetBindings,
  fetchWorkspaces,
  putResourcePolicies,
  putWorkspaceKnowledgeSetBindings,
  rebuildKnowledgeSet,
  renameKnowledgeSetItem,
  updateKnowledgeSet,
  updateWorkspace,
  uploadKnowledgeSetArchive,
  uploadKnowledgeSetFiles
} from "./api";

const mockedApi = vi.mocked(api);

describe("resource center api helpers", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "{}"
      })
    );
  });

  it("calls the expected admin endpoints for resource center helpers", async () => {
    mockedApi
      .mockResolvedValueOnce({ workspaces: [] })
      .mockResolvedValueOnce({ workspace: { id: "workspace-1" } })
      .mockResolvedValueOnce({ workspace: { id: "workspace-1" } })
      .mockResolvedValueOnce({ knowledgeSets: [] })
      .mockResolvedValueOnce({ knowledgeSet: { id: "knowledge-set-1" } })
      .mockResolvedValueOnce({ knowledgeSet: { id: "knowledge-set-1" } })
      .mockResolvedValueOnce({ bindings: [] })
      .mockResolvedValueOnce({ bindings: [] })
      .mockResolvedValueOnce({ policies: [] })
      .mockResolvedValueOnce({ policies: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ knowledgeSet: { id: "knowledge-set-1" } })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });

    await fetchWorkspaces();
    await createWorkspace({ name: "Docs", slug: "docs", sourceType: "filesystem" });
    await updateWorkspace("workspace-1", { description: "Updated" });
    await fetchKnowledgeSets();
    await createKnowledgeSet({ name: "FAQ", slug: "faq", sourceType: "managed_upload" });
    await updateKnowledgeSet("knowledge-set-1", { description: "Updated" });
    await fetchWorkspaceKnowledgeSetBindings("workspace-1");
    await putWorkspaceKnowledgeSetBindings("workspace-1", [
      { knowledgeSetId: "knowledge-set-1", mountType: "default" }
    ]);
    await fetchResourcePolicies("workspace", "workspace-1");
    await putResourcePolicies("knowledge_set", "knowledge-set-1", [
      { subjectType: "role", subjectId: "employee", effect: "allow" }
    ]);
    await fetchKnowledgeSetItems("knowledge-set-1");
    await rebuildKnowledgeSet("knowledge-set-1");
    await deleteKnowledgeSetItem("knowledge-set-1", "guides/readme.md");
    await renameKnowledgeSetItem("knowledge-set-1", "guides/readme.md", "guides/intro.md");

    const uploadFile = new File(["hello"], "hello.txt", { type: "text/plain" });
    await uploadKnowledgeSetFiles("knowledge-set-1", [uploadFile]);

    const archiveFile = new File(["zip"], "docs.zip", { type: "application/zip" });
    await uploadKnowledgeSetArchive("knowledge-set-1", "docs.zip", archiveFile);

    expect(mockedApi).toHaveBeenNthCalledWith(1, "/api/admin/workspaces");
    expect(mockedApi).toHaveBeenNthCalledWith(2, "/api/admin/workspaces", expect.objectContaining({ method: "POST" }));
    expect(mockedApi).toHaveBeenNthCalledWith(3, "/api/admin/workspaces/workspace-1", expect.objectContaining({ method: "PATCH" }));
    expect(mockedApi).toHaveBeenNthCalledWith(4, "/api/admin/knowledge-sets");
    expect(mockedApi).toHaveBeenNthCalledWith(5, "/api/admin/knowledge-sets", expect.objectContaining({ method: "POST" }));
    expect(mockedApi).toHaveBeenNthCalledWith(
      6,
      "/api/admin/knowledge-sets/knowledge-set-1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(7, "/api/admin/workspaces/workspace-1/knowledge-sets");
    expect(mockedApi).toHaveBeenNthCalledWith(
      8,
      "/api/admin/workspaces/workspace-1/knowledge-sets",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(9, "/api/admin/resources/workspaces/workspace-1/policies");
    expect(mockedApi).toHaveBeenNthCalledWith(
      10,
      "/api/admin/resources/knowledge-sets/knowledge-set-1/policies",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(11, "/api/admin/knowledge-sets/knowledge-set-1/items");
    expect(mockedApi).toHaveBeenNthCalledWith(
      12,
      "/api/admin/knowledge-sets/knowledge-set-1/rebuild",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      13,
      "/api/admin/knowledge-sets/knowledge-set-1/items",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      14,
      "/api/admin/knowledge-sets/knowledge-set-1/items",
      expect.objectContaining({ method: "PATCH" })
    );

    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8787/api/admin/knowledge-sets/knowledge-set-1/files",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.any(FormData)
      })
    );
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8787/api/admin/knowledge-sets/knowledge-set-1/archive",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: archiveFile
      })
    );
  });
});
