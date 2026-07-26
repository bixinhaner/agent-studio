import { describe, expect, it, vi } from "vitest";

import { ThreadArtifactRepository } from "./thread-artifact-repository.js";

function artifactRow() {
  return {
    id: "artifact-1",
    organizationId: "org-1",
    threadId: "thread-1",
    userId: "user-1",
    source: "runtime_workspace",
    relativePath: "report.md",
    displayName: "report.md",
    mimeType: "text/markdown",
    sizeBytes: BigInt(5),
    checksum: "checksum",
    previewStatus: "ready",
    downloadStatus: "ready",
    blockedReason: null,
    metadata: null,
    workspaceFileId: "workspace-file-1",
    workspaceFileVersionId: "workspace-version-1",
    expiresAt: null,
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    updatedAt: new Date("2026-07-27T00:00:00.000Z")
  };
}

describe("ThreadArtifactRepository", () => {
  it("preserves an existing stable workspace link when refreshing runtime artifact metadata", async () => {
    const upsert = vi.fn().mockResolvedValue(artifactRow());
    const repository = new ThreadArtifactRepository({
      threadArtifact: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        upsert
      }
    });

    await repository.upsertForThreadPath({
      organizationId: "org-1",
      threadId: "thread-1",
      userId: "user-1",
      source: "runtime_workspace",
      relativePath: "report.md",
      displayName: "report.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
      checksum: "checksum",
      previewStatus: "ready",
      downloadStatus: "ready"
    });

    const call = upsert.mock.calls[0]?.[0];
    expect(call.update).not.toHaveProperty("workspaceFileId");
    expect(call.update).not.toHaveProperty("workspaceFileVersionId");
    expect(call.create).toMatchObject({
      workspaceFileId: null,
      workspaceFileVersionId: null
    });
  });
});
