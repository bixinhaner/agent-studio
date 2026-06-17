import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectRuntimeGeneratedImageChanges,
  extractRuntimeFileChanges,
  materializeRuntimeGeneratedImageChanges,
  type RuntimeFileChange
} from "./runtime-generated-artifacts.js";

let tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const tempParent = path.resolve(process.cwd(), "temp");
  await fs.mkdir(tempParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(tempParent, "runtime-generated-artifacts-"));
  tempRoots.push(root);
  return root;
}

beforeEach(() => {
  tempRoots = [];
});

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("runtime generated artifacts", () => {
  it("extracts standard file changes from completed runtime items", () => {
    const changes = extractRuntimeFileChanges({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: {
          type: "file_change",
          changes: [
            { path: "outputs/report.xlsx", kind: "create" },
            { path: "outputs/report.xlsx", kind: "create" }
          ]
        }
      }
    });

    expect(changes).toEqual([{ path: "outputs/report.xlsx", kind: "create" }]);
  });

  it("extracts generated image saved paths from Codex response items", () => {
    const changes = extractRuntimeFileChanges({
      type: "response_item",
      raw: {
        type: "response_item",
        payload: {
          type: "image_generation_call",
          id: "ig_test",
          revised_prompt: "technical diagram",
          saved_path: "/tmp/codex-home/generated_images/thread/ig_test.png",
          result: "iVBORw0KGgo="
        }
      }
    });

    expect(changes).toMatchObject([
      {
        path: "/tmp/codex-home/generated_images/thread/ig_test.png",
        kind: "generated_image",
        sourcePath: "/tmp/codex-home/generated_images/thread/ig_test.png",
        metadata: {
          runtimeItemType: "image_generation_call",
          imageGenerationId: "ig_test",
          revisedPrompt: "technical diagram"
        }
      }
    ]);
    expect(changes[0]?.dataBase64).toBe("iVBORw0KGgo=");
  });

  it("copies generated images from codex home into the workspace artifact directory", async () => {
    const root = await makeTempRoot();
    const workspacePath = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    const sourcePath = path.join(codexHome, "generated_images", "thread-1", "ig_test.png");
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(sourcePath, Buffer.from("generated-image"));

    const changes: RuntimeFileChange[] = [{
      path: sourcePath,
      kind: "generated_image",
      sourcePath,
      metadata: { imageGenerationId: "ig_test" }
    }];
    const materialized = await materializeRuntimeGeneratedImageChanges({
      changes,
      workspacePath,
      codexHome
    });

    expect(materialized).toMatchObject([
      {
        path: path.join("artifacts", "generated-images", "ig_test.png"),
        kind: "generated_image",
        sourcePath
      }
    ]);
    await expect(fs.readFile(path.join(workspacePath, materialized[0]!.path), "utf8")).resolves.toBe("generated-image");
  });

  it("collects generated images written by Codex into the thread image cache", async () => {
    const root = await makeTempRoot();
    const codexHome = path.join(root, "codex-home");
    const sourcePath = path.join(codexHome, "generated_images", "thread-1", "ig_scanned.png");
    const generatedAt = new Date();
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.from("generated-image"));
    await fs.utimes(sourcePath, generatedAt, generatedAt);

    const changes = await collectRuntimeGeneratedImageChanges({
      codexHome,
      codexThreadId: "thread-1",
      changedAfter: new Date(generatedAt.getTime() - 1000)
    });

    expect(changes).toMatchObject([
      {
        path: sourcePath,
        kind: "generated_image",
        sourcePath,
        metadata: {
          runtimeItemType: "generated_image_scan",
          imageGenerationId: "ig_scanned"
        }
      }
    ]);
  });

  it("does not collect stale generated images from older turns", async () => {
    const root = await makeTempRoot();
    const codexHome = path.join(root, "codex-home");
    const sourcePath = path.join(codexHome, "generated_images", "thread-1", "ig_old.png");
    const generatedAt = new Date(Date.now() - 10_000);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.from("old-image"));
    await fs.utimes(sourcePath, generatedAt, generatedAt);

    const changes = await collectRuntimeGeneratedImageChanges({
      codexHome,
      codexThreadId: "thread-1",
      changedAfter: new Date()
    });

    expect(changes).toEqual([]);
  });

  it("does not publish generated image paths outside the workspace or codex home", async () => {
    const root = await makeTempRoot();
    const workspacePath = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    const outsidePath = path.join(root, "outside", "secret.png");
    await fs.mkdir(path.dirname(outsidePath), { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(outsidePath, Buffer.from("secret"));

    const materialized = await materializeRuntimeGeneratedImageChanges({
      changes: [{ path: outsidePath, kind: "generated_image", sourcePath: outsidePath }],
      workspacePath,
      codexHome
    });

    expect(materialized).toEqual([]);
  });

  it("falls back to image data when the generated image path is missing", async () => {
    const root = await makeTempRoot();
    const workspacePath = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    const sourcePath = path.join(codexHome, "generated_images", "thread-1", "ig_missing.png");
    await fs.mkdir(workspacePath, { recursive: true });

    const materialized = await materializeRuntimeGeneratedImageChanges({
      changes: [{
        path: sourcePath,
        kind: "generated_image",
        sourcePath,
        dataBase64: Buffer.from("from-base64").toString("base64"),
        metadata: { imageGenerationId: "ig_missing" }
      }],
      workspacePath,
      codexHome
    });

    expect(materialized[0]?.path).toBe(path.join("artifacts", "generated-images", "ig_missing.png"));
    await expect(fs.readFile(path.join(workspacePath, materialized[0]!.path), "utf8")).resolves.toBe("from-base64");
  });
});
