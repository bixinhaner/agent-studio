import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  deleteKnowledgeSetItem: vi.fn(),
  fetchKnowledgeSetItems: vi.fn(),
  rebuildKnowledgeSet: vi.fn(),
  renameKnowledgeSetItem: vi.fn(),
  updateKnowledgeSet: vi.fn(),
  uploadKnowledgeSetArchive: vi.fn(),
  uploadKnowledgeSetFiles: vi.fn()
}));

vi.mock("./ResourcePolicyEditor", () => ({
  ResourcePolicyEditor: () => <section>资料集资源策略编辑器</section>
}));

import {
  deleteKnowledgeSetItem,
  fetchKnowledgeSetItems,
  rebuildKnowledgeSet,
  renameKnowledgeSetItem,
  updateKnowledgeSet,
  uploadKnowledgeSetArchive,
  uploadKnowledgeSetFiles
} from "./api";
import { KnowledgeSetDetailView } from "./KnowledgeSetDetailView";
import type { KnowledgeSetItemRecord, KnowledgeSetRecord } from "./types";

const mockedDeleteKnowledgeSetItem = vi.mocked(deleteKnowledgeSetItem);
const mockedFetchKnowledgeSetItems = vi.mocked(fetchKnowledgeSetItems);
const mockedRebuildKnowledgeSet = vi.mocked(rebuildKnowledgeSet);
const mockedRenameKnowledgeSetItem = vi.mocked(renameKnowledgeSetItem);
const mockedUpdateKnowledgeSet = vi.mocked(updateKnowledgeSet);
const mockedUploadKnowledgeSetArchive = vi.mocked(uploadKnowledgeSetArchive);
const mockedUploadKnowledgeSetFiles = vi.mocked(uploadKnowledgeSetFiles);

const managedKnowledgeSet: KnowledgeSetRecord = {
  id: "knowledge-set-1",
  organizationId: "org-1",
  name: "FAQ",
  slug: "faq",
  description: "Initial FAQ",
  status: "active",
  sourceType: "managed_upload",
  storageKey: "faq",
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z"
};

const filesystemKnowledgeSet: KnowledgeSetRecord = {
  id: "knowledge-set-2",
  organizationId: "org-1",
  name: "Runbooks",
  slug: "runbooks",
  description: "Runbooks",
  status: "active",
  sourceType: "filesystem",
  rootPath: "/srv/runbooks",
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z"
};

const initialItems: KnowledgeSetItemRecord[] = [
  {
    id: "item-1",
    kind: "file",
    relativePath: "guides/intro.md",
    displayName: "intro.md",
    sizeBytes: "128",
    updatedAt: "2026-03-30T08:00:00.000Z"
  }
];

describe("KnowledgeSetDetailView", () => {
  beforeEach(() => {
    mockedDeleteKnowledgeSetItem.mockReset();
    mockedFetchKnowledgeSetItems.mockReset();
    mockedRebuildKnowledgeSet.mockReset();
    mockedRenameKnowledgeSetItem.mockReset();
    mockedUpdateKnowledgeSet.mockReset();
    mockedUploadKnowledgeSetArchive.mockReset();
    mockedUploadKnowledgeSetFiles.mockReset();
    vi.restoreAllMocks();
  });

  it("saves metadata and runs rebuild, upload, delete, and rename flows", async () => {
    mockedFetchKnowledgeSetItems.mockResolvedValue({ items: initialItems });
    mockedUpdateKnowledgeSet.mockResolvedValue({
      knowledgeSet: {
        ...managedKnowledgeSet,
        name: "Updated FAQ",
        description: "Updated desc"
      }
    });
    mockedRebuildKnowledgeSet.mockResolvedValue({
      items: [
        ...initialItems,
        {
          id: "item-2",
          kind: "file",
          relativePath: "guides/rebuilt.md",
          displayName: "rebuilt.md",
          updatedAt: "2026-03-30T09:00:00.000Z"
        }
      ]
    });
    mockedUploadKnowledgeSetFiles.mockResolvedValue({
      items: [
        ...initialItems,
        {
          id: "item-3",
          kind: "file",
          relativePath: "guides/uploaded.md",
          displayName: "uploaded.md",
          updatedAt: "2026-03-30T10:00:00.000Z"
        }
      ]
    });
    mockedUploadKnowledgeSetArchive.mockResolvedValue({
      items: [
        ...initialItems,
        {
          id: "item-4",
          kind: "file",
          relativePath: "archive/from-zip.md",
          displayName: "from-zip.md",
          sourceArchiveName: "bundle.zip",
          updatedAt: "2026-03-30T11:00:00.000Z"
        }
      ]
    });
    mockedDeleteKnowledgeSetItem.mockResolvedValue({ items: [] });
    mockedRenameKnowledgeSetItem.mockResolvedValue({
      items: [
        {
          id: "item-5",
          kind: "file",
          relativePath: "guides/renamed.md",
          displayName: "renamed.md",
          updatedAt: "2026-03-30T12:00:00.000Z"
        }
      ]
    });

    const onKnowledgeSetUpdated = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("guides/renamed.md");

    const { unmount } = render(
      <KnowledgeSetDetailView
        knowledgeSet={managedKnowledgeSet}
        onKnowledgeSetUpdated={onKnowledgeSetUpdated}
      />
    );

    expect(await screen.findByText("资料集资源策略编辑器")).toBeTruthy();
    expect(await screen.findByText("intro.md")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("资料集名称"), { target: { value: "Updated FAQ" } });
    fireEvent.change(screen.getByLabelText("资料集描述"), { target: { value: "Updated desc" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料集配置" }));

    await waitFor(() => {
      expect(mockedUpdateKnowledgeSet).toHaveBeenCalledWith("knowledge-set-1", {
        name: "Updated FAQ",
        slug: "faq",
        description: "Updated desc",
        status: "active",
        storageKey: "faq"
      });
    });
    expect(onKnowledgeSetUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Updated FAQ" }));

    fireEvent.click(screen.getByRole("button", { name: "重建资料清单" }));
    await waitFor(() => {
      expect(mockedRebuildKnowledgeSet).toHaveBeenCalledWith("knowledge-set-1");
    });
    expect(await screen.findByText("rebuilt.md")).toBeTruthy();

    const uploadFile = new File(["hello"], "uploaded.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("上传资料文件"), { target: { files: [uploadFile] } });
    fireEvent.click(screen.getByRole("button", { name: "上传文件" }));
    await waitFor(() => {
      expect(mockedUploadKnowledgeSetFiles).toHaveBeenCalledWith("knowledge-set-1", [uploadFile]);
    });
    expect(await screen.findByText("uploaded.md")).toBeTruthy();

    const archiveFile = new File(["zip"], "bundle.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("上传压缩包"), { target: { files: [archiveFile] } });
    fireEvent.click(screen.getByRole("button", { name: "上传压缩包" }));
    await waitFor(() => {
      expect(mockedUploadKnowledgeSetArchive).toHaveBeenCalledWith("knowledge-set-1", "bundle.zip", archiveFile);
    });
    expect(await screen.findByText("from-zip.md")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "删除文件" })[0]);
    await waitFor(() => {
      expect(mockedDeleteKnowledgeSetItem).toHaveBeenCalledWith("knowledge-set-1", "archive/from-zip.md");
    });

    mockedFetchKnowledgeSetItems.mockResolvedValue({
      items: [
        {
          id: "item-6",
          kind: "file",
          relativePath: "guides/intro.md",
          displayName: "intro.md"
        }
      ]
    });

    unmount();
    render(
      <KnowledgeSetDetailView
        knowledgeSet={managedKnowledgeSet}
        onKnowledgeSetUpdated={onKnowledgeSetUpdated}
      />
    );

    expect(await screen.findByText("intro.md")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "重命名文件" })[0]);
    await waitFor(() => {
      expect(mockedRenameKnowledgeSetItem).toHaveBeenCalledWith("knowledge-set-1", "guides/intro.md", "guides/renamed.md");
    });
    expect(await screen.findByText("renamed.md")).toBeTruthy();
  });

  it("keeps upload controls hidden for filesystem knowledge sets", async () => {
    mockedFetchKnowledgeSetItems.mockResolvedValue({ items: initialItems });

    render(
      <KnowledgeSetDetailView
        knowledgeSet={filesystemKnowledgeSet}
        onKnowledgeSetUpdated={vi.fn()}
      />
    );

    expect(await screen.findByLabelText("根目录")).toBeTruthy();
    expect(screen.queryByLabelText("上传资料文件")).toBeNull();
    expect(screen.queryByLabelText("上传压缩包")).toBeNull();
  });
});
