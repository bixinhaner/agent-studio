import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeSetItemRecord } from "./types";
import { KnowledgeSetFileTree } from "./KnowledgeSetFileTree";

const items: KnowledgeSetItemRecord[] = [
  {
    id: "item-1",
    kind: "file",
    relativePath: "guides/getting-started/intro.md",
    displayName: "intro.md",
    sizeBytes: "128",
    updatedAt: "2026-03-30T08:00:00.000Z"
  },
  {
    id: "item-2",
    kind: "file",
    relativePath: "guides/faq.md",
    displayName: "faq.md",
    sizeBytes: "512",
    sourceArchiveName: "docs.zip",
    updatedAt: "2026-03-30T09:00:00.000Z"
  }
];

describe("KnowledgeSetFileTree", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nested relative paths as a file tree", () => {
    render(<KnowledgeSetFileTree items={items} onDelete={vi.fn()} onRename={vi.fn()} />);

    expect(screen.getByText("guides")).toBeTruthy();
    expect(screen.getByText("getting-started")).toBeTruthy();
    expect(screen.getByText("intro.md")).toBeTruthy();
    expect(screen.getByText("faq.md")).toBeTruthy();
    expect(screen.getByText(/docs.zip/)).toBeTruthy();
  });

  it("invokes delete and rename row actions", () => {
    const onDelete = vi.fn();
    const onRename = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("guides/getting-started/overview.md");

    render(<KnowledgeSetFileTree items={items} onDelete={onDelete} onRename={onRename} />);

    fireEvent.click(screen.getAllByRole("button", { name: "删除文件" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "重命名文件" })[0]);

    expect(onDelete).toHaveBeenCalledWith("guides/getting-started/intro.md");
    expect(onRename).toHaveBeenCalledWith("guides/getting-started/intro.md", "guides/getting-started/overview.md");
  });

  it("requires explicit confirmation before filesystem rename", () => {
    const onRename = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.spyOn(window, "prompt").mockReturnValue("guides/getting-started/overview.md");

    render(
      <KnowledgeSetFileTree
        items={items}
        requireRenameConfirm
        onDelete={vi.fn()}
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "重命名文件" })[0]);

    expect(confirmSpy).toHaveBeenCalledWith("确认将 guides/getting-started/intro.md 重命名为 guides/getting-started/overview.md 吗？");
    expect(onRename).not.toHaveBeenCalled();
  });
});
