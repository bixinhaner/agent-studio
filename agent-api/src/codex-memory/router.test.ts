import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodexMemoryAdminRouter } from "./router.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function memoryHome(root: string, relativeHome: string): Promise<void> {
  const memories = path.join(root, relativeHome, "memories");
  await mkdir(memories, { recursive: true });
  await writeFile(path.join(memories, "MEMORY.md"), "# memory\n");
}

describe("codex memory scopes", () => {
  it("finds every memory home without walking session rollouts and caches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-memory-scopes-"));
    roots.push(root);
    await memoryHome(root, "acme/user-1/agent-a");
    await memoryHome(root, "acme/user-1/agent-a/profiles/assistant-planner");
    await memoryHome(root, "integrations/zendesk/instance-1/agent-b");
    // An organization key that happens to match a skipped directory name is still scanned.
    await memoryHome(root, "cache/user-2/agent-c");
    // Rollouts and caches inside a Codex home never hold scopes and are not walked.
    await memoryHome(root, "acme/user-1/agent-a/sessions/2026/10");
    await memoryHome(root, "acme/user-1/agent-a/plugins/some-plugin");

    const listByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, displayName: `User ${id}` })));
    const getById = vi.fn();
    const app = express();
    app.use(
      "/api/admin",
      createCodexMemoryAdminRouter({
        sessionHomeRoot: root,
        requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
        users: { getById, listByIds }
      })
    );

    const response = await request(app).get("/api/admin/codex-memory/scopes");

    expect(response.status).toBe(200);
    expect(response.body.scopes.map((scope: { relativeHome: string }) => scope.relativeHome).sort()).toEqual([
      "acme/user-1/agent-a",
      "acme/user-1/agent-a/profiles/assistant-planner",
      "cache/user-2/agent-c",
      "integrations/zendesk/instance-1/agent-b"
    ]);
    expect(listByIds).toHaveBeenCalledTimes(1);
    expect(getById).not.toHaveBeenCalled();
    const scope = response.body.scopes.find((item: { relativeHome: string }) => item.relativeHome === "acme/user-1/agent-a");
    expect(scope).toMatchObject({ kind: "user_agent", ownerName: "User user-1", fileCount: 1 });
  });
});
