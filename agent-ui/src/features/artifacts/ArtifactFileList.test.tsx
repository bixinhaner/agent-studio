import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactFileList } from "./ArtifactFileList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ArtifactFileList", () => {
  const change = {
    path: "outputs/thread-123/report.pptx",
    displayPath: "outputs/thread-123/report.pptx",
    kind: "ready",
    canPreview: true,
    canDownload: true
  };

  it("renders the same preview and download actions from injected endpoints", () => {
    const onPreview = vi.fn();
    render(
      <ArtifactFileList
        changes={[change]}
        resolveActions={() => ({ previewUrl: "/preview", downloadUrl: "/download" })}
        onPreview={onPreview}
      />
    );

    expect(screen.getByText("report.pptx")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledWith(change, { previewUrl: "/preview", downloadUrl: "/download" });
    expect(screen.getByRole("link", { name: "Download report.pptx" })).toBeTruthy();
  });

  it("uses a native download link so large files do not occupy browser memory", () => {
    render(
      <ArtifactFileList
        changes={[change]}
        resolveActions={() => ({ previewUrl: "/preview", downloadUrl: "/download" })}
      />
    );
    const link = screen.getByRole("link", { name: "Download report.pptx" });
    expect(link.getAttribute("href")).toBe("/download");
    expect(link.getAttribute("download")).toBe("report.pptx");
  });
});
