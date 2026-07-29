import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_PUBLICATION_HINT,
  artifactPublicationPaths,
  collectPublishedArtifactChanges,
  ensureArtifactPublicationTool
} from "./artifact-publication.js";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-artifact-publication-"));
  tempDirectories.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("artifact publication", () => {
  it("materializes a workspace-local publisher and records a final deliverable", async () => {
    const workspace = await createWorkspace();
    const outputPath = path.join(workspace, "outputs", "internal-name.pdf");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, "pdf");
    const publicationPaths = await ensureArtifactPublicationTool(workspace);

    const result = await execFileAsync(process.execPath, [
      publicationPaths.cli,
      "publish",
      "--path",
      outputPath,
      "--name",
      "Health Report.pdf"
    ], {
      cwd: workspace,
      env: {
        ...process.env,
        AGENT_STUDIO_WORKSPACE: workspace,
        AGENT_STUDIO_ARTIFACT_MANIFEST: publicationPaths.manifest
      }
    });

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      artifact: {
        schemaVersion: 1,
        path: "outputs/internal-name.pdf",
        displayName: "Health Report.pdf",
        role: "final"
      }
    });
    await expect(collectPublishedArtifactChanges({ workspacePath: workspace })).resolves.toEqual([
      expect.objectContaining({
        path: outputPath,
        kind: "published_artifact",
        metadata: expect.objectContaining({
          publicationRole: "final",
          displayName: "Health Report.pdf"
        })
      })
    ]);
  });

  it("does not deliver non-final, stale, missing, malformed, or outside-workspace entries", async () => {
    const workspace = await createWorkspace();
    const paths = artifactPublicationPaths(workspace);
    const finalPath = path.join(workspace, "outputs", "current.pdf");
    const previewPath = path.join(workspace, "outputs", "preview.png");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await Promise.all([
      fs.writeFile(finalPath, "pdf"),
      fs.writeFile(previewPath, "png"),
      fs.mkdir(path.dirname(paths.manifest), { recursive: true })
    ]);
    const changedAfter = new Date();
    await fs.writeFile(paths.manifest, [
      "{not-json}",
      JSON.stringify({
        schemaVersion: 1,
        publishedAt: new Date(changedAfter.getTime() - 10_000).toISOString(),
        path: "outputs/current.pdf",
        displayName: "stale.pdf",
        role: "final"
      }),
      JSON.stringify({
        schemaVersion: 1,
        publishedAt: new Date().toISOString(),
        path: "outputs/preview.png",
        role: "preview"
      }),
      JSON.stringify({
        schemaVersion: 1,
        publishedAt: new Date().toISOString(),
        path: "outputs/missing.pdf",
        role: "final"
      }),
      JSON.stringify({
        schemaVersion: 1,
        publishedAt: new Date().toISOString(),
        path: "../outside.pdf",
        role: "final"
      }),
      JSON.stringify({
        schemaVersion: 1,
        publishedAt: new Date().toISOString(),
        path: "outputs/current.pdf",
        displayName: "Current.pdf",
        role: "final"
      })
    ].join("\n"));

    const changes = await collectPublishedArtifactChanges({ workspacePath: workspace, changedAfter });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      path: finalPath,
      metadata: { displayName: "Current.pdf", publicationRole: "final" }
    });
  });

  it("rejects attempts to publish files outside the workspace", async () => {
    const workspace = await createWorkspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-artifact-outside-"));
    tempDirectories.push(outside);
    const outsideFile = path.join(outside, "secret.txt");
    await fs.writeFile(outsideFile, "secret");
    const publicationPaths = await ensureArtifactPublicationTool(workspace);

    await expect(execFileAsync(process.execPath, [
      publicationPaths.cli,
      "publish",
      "--path",
      outsideFile
    ], {
      cwd: workspace,
      env: { ...process.env, AGENT_STUDIO_WORKSPACE: workspace }
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("File must be inside the current workspace")
    });
  });

  it("gives the model a concise final-only publishing contract", () => {
    expect(ARTIFACT_PUBLICATION_HINT).toContain(".agent-studio/artifact-cli.mjs");
    expect(ARTIFACT_PUBLICATION_HINT).toContain("只发布用户应下载的最终文件");
    expect(ARTIFACT_PUBLICATION_HINT).toContain("不要向用户解释");
  });
});
