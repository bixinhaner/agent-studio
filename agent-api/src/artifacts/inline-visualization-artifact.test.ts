import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ThreadArtifactRecord } from "../persistence/thread-artifact-repository.js";
import {
  detectSecretLikeContent,
  INLINE_VISUALIZATION_DIR,
  INLINE_VISUALIZATION_ROOT,
  inlineVisualizationRuntimeHint,
  InlineVisualizationArtifactError,
  loadInlineVisualization,
  normalizeInlineVisualizationFileName,
  readInlineVisualizationArtifact,
  selectInlineVisualizationArtifact
} from "./inline-visualization-artifact.js";

const tempDirectories: string[] = [];

function artifact(relativePath: string, overrides: Partial<ThreadArtifactRecord> = {}): ThreadArtifactRecord {
  return {
    id: "artifact-1",
    threadId: "thread-1",
    source: "assistant_generated",
    relativePath,
    displayName: path.basename(relativePath),
    previewStatus: "blocked",
    downloadStatus: "blocked",
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    ...overrides
  };
}

async function createWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "inline-vis-"));
  tempDirectories.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("inline visualization artifacts", () => {
  it("accepts only a single HTML file name", () => {
    expect(normalizeInlineVisualizationFileName("chart.html")).toBe("chart.html");
    expect(() => normalizeInlineVisualizationFileName("../chart.html")).toThrow(InlineVisualizationArtifactError);
    expect(() => normalizeInlineVisualizationFileName("nested/chart.html")).toThrow(InlineVisualizationArtifactError);
    expect(() => normalizeInlineVisualizationFileName("secret.txt")).toThrow(InlineVisualizationArtifactError);
  });

  it("selects the newest registered assistant-generated visualization", () => {
    const older = artifact(`${INLINE_VISUALIZATION_ROOT}/2026/07/25/old/chart.html`);
    const newer = artifact(`${INLINE_VISUALIZATION_ROOT}/2026/07/25/new/chart.html`, {
      id: "artifact-2",
      updatedAt: "2026-07-25T01:00:00.000Z"
    });
    const unrelated = artifact(`exports/chart.html`, { id: "artifact-3" });
    expect(selectInlineVisualizationArtifact([older, unrelated, newer], "chart.html")?.id).toBe("artifact-2");
  });

  it("reads a registered HTML visualization within the protected root", async () => {
    const workspace = await createWorkspace();
    const relativePath = `${INLINE_VISUALIZATION_ROOT}/2026/07/25/session/chart.html`;
    const absolutePath = path.join(workspace, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "<html><body>chart</body></html>");

    const result = await readInlineVisualizationArtifact({
      workspacePath: workspace,
      artifact: artifact(relativePath),
      maxFileBytes: 1024
    });
    expect(result.fileName).toBe("chart.html");
    expect(result.buffer.toString("utf8")).toContain("chart");
  });

  it("rejects artifacts outside the visualization root and symlink escapes", async () => {
    const workspace = await createWorkspace();
    await expect(
      readInlineVisualizationArtifact({
        workspacePath: workspace,
        artifact: artifact("exports/chart.html"),
        maxFileBytes: 1024
      })
    ).rejects.toMatchObject({ status: 403 });

    const outsidePath = path.join(workspace, "outside.html");
    const linkedPath = path.join(workspace, INLINE_VISUALIZATION_ROOT, "2026/07/25/session/chart.html");
    await fs.mkdir(path.dirname(linkedPath), { recursive: true });
    await fs.writeFile(outsidePath, "outside");
    await fs.symlink(outsidePath, linkedPath);
    await expect(
      readInlineVisualizationArtifact({
        workspacePath: workspace,
        artifact: artifact(`${INLINE_VISUALIZATION_ROOT}/2026/07/25/session/chart.html`),
        maxFileBytes: 1024
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reads the durable workspace directory without artifact records", async () => {
    const workspace = await createWorkspace();
    const absolutePath = path.join(workspace, INLINE_VISUALIZATION_DIR, "clt-sampling.html");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "<div id=\"clt\"></div>");
    const listArtifacts = async () => {
      throw new Error("artifact lookup should not run");
    };

    const result = await loadInlineVisualization({
      workspacePath: workspace,
      fileName: "clt-sampling.html",
      maxFileBytes: 1024,
      listArtifacts
    });
    expect(result).toMatchObject({ fileName: "clt-sampling.html", source: "workspace" });
    expect(result.buffer.toString("utf8")).toContain("clt");
  });

  it("falls back to legacy artifact-registered visualizations", async () => {
    const workspace = await createWorkspace();
    const relativePath = `${INLINE_VISUALIZATION_ROOT}/2026/07/24/session/trend.html`;
    await fs.mkdir(path.dirname(path.join(workspace, relativePath)), { recursive: true });
    await fs.writeFile(path.join(workspace, relativePath), "<div>legacy</div>");

    const result = await loadInlineVisualization({
      workspacePath: workspace,
      fileName: "trend.html",
      maxFileBytes: 1024,
      listArtifacts: async () => [artifact(relativePath, { id: "legacy-1" })]
    });
    expect(result).toMatchObject({ source: "legacy_artifact", artifactId: "legacy-1" });
  });

  it("reports missing visualizations and refuses symlinks in the durable directory", async () => {
    const workspace = await createWorkspace();
    await expect(
      loadInlineVisualization({ workspacePath: workspace, fileName: "gone.html", maxFileBytes: 1024, listArtifacts: async () => [] })
    ).rejects.toMatchObject({ status: 404 });

    const outsidePath = path.join(workspace, "secret.html");
    await fs.writeFile(outsidePath, "outside");
    const linkPath = path.join(workspace, INLINE_VISUALIZATION_DIR, "linked.html");
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(outsidePath, linkPath);
    await expect(
      loadInlineVisualization({ workspacePath: workspace, fileName: "linked.html", maxFileBytes: 1024, listArtifacts: async () => [] })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      loadInlineVisualization({ workspacePath: workspace, fileName: "../secret.html", maxFileBytes: 1024, listArtifacts: async () => [] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("enforces the size limit for durable visualizations", async () => {
    const workspace = await createWorkspace();
    const absolutePath = path.join(workspace, INLINE_VISUALIZATION_DIR, "big.html");
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "x".repeat(2048));
    await expect(
      loadInlineVisualization({ workspacePath: workspace, fileName: "big.html", maxFileBytes: 1024, listArtifacts: async () => [] })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("points the model at the durable directory with the bare-file directive", () => {
    const hint = inlineVisualizationRuntimeHint("/srv/thread-1");
    expect(hint).toContain("/srv/thread-1/.agent-studio/visualizations");
    expect(hint).toContain('::codex-inline-vis{file="<title>.html"}');
    expect(hint).toContain(".codex");
  });

  it("flags credential-like content", () => {
    expect(detectSecretLikeContent(Buffer.from("api_key = abcdefghijklmnop1234"))).toBeTruthy();
    expect(detectSecretLikeContent(Buffer.from("<div>chart</div>"))).toBeUndefined();
  });
});
