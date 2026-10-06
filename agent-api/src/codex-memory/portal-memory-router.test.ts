import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultSystemSettingsPayload } from "../system-settings/types.js";
import { createPortalMemoryRouter } from "./portal-memory-router.js";
import { PortalMemoryService } from "./portal-memory-service.js";

describe("portal memory router", () => {
  let root: string;
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("labels each assistant with its mode name and falls back to null", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "portal-memory-router-"));
    for (const segment of ["agent-mode-hr-aaaaaa", "agent-mode-gone-bbbbbb"]) {
      await mkdir(path.join(root, "internal", "user1", segment, "memories"), { recursive: true });
      await writeFile(path.join(root, "internal", "user1", segment, "memories", "memory_summary.md"), "## User Profile\n\nThe user works in HR.\n", "utf8");
    }
    const requested: string[][] = [];
    const app = express().use(
      createPortalMemoryRouter({
        service: new PortalMemoryService({ sessionHomeRoot: root }),
        resolveActor: () => ({ userId: "user1" }),
        getSettings: async () => createDefaultSystemSettingsPayload().codexMemory,
        resolveModeNames: async (ids) => {
          requested.push([...ids].sort());
          return { "mode-hr": "钉钉 HR 助手" };
        }
      })
    );

    const response = await request(app).get("/").expect(200);
    const names = Object.fromEntries((response.body.scopes as Array<{ mode_id: string; mode_name: string | null }>).map((scope) => [scope.mode_id, scope.mode_name]));
    expect(names).toEqual({ "mode-hr": "钉钉 HR 助手", "mode-gone": null });
    expect(requested).toEqual([["mode-gone", "mode-hr"]]);
  });
});
