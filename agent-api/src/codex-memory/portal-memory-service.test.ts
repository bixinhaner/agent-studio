import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentStudioMemorySourcePath } from "./engine.js";
import { memoryItemId, PortalMemoryService, portalMemoryCategory } from "./portal-memory-service.js";

describe("PortalMemoryService", () => {
  let root: string;
  let service: PortalMemoryService;
  let home: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "portal-memory-"));
    service = new PortalMemoryService({ sessionHomeRoot: root });
    home = path.join(root, "internal", "user1", "agent-general-abc123");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("maps engine categories to portal groups", () => {
    expect(portalMemoryCategory("user_preference")).toBe("preference");
    expect(portalMemoryCategory("workflow_convention")).toBe("habit");
    expect(portalMemoryCategory("technical")).toBe("background");
    expect(portalMemoryCategory(undefined)).toBe("background");
  });

  it("adds, lists, edits and deletes memories", async () => {
    await service.add(home, { text: "回答请使用中文，先给结论", category: "preference" });
    await service.add(home, { text: "负责印尼区域 OMC 运维", category: "background" });

    let scopes = await service.list("user1");
    expect(scopes).toHaveLength(1);
    expect(scopes[0].id).toBe("internal~agent-general-abc123");
    expect(scopes[0].modeId).toBe("general");
    expect(scopes[0].items.map((item) => [item.text, item.category, item.source])).toEqual([
      ["回答请使用中文，先给结论", "preference", "user"],
      ["负责印尼区域 OMC 运维", "background", "user"]
    ]);

    const edited = await service.update(home, memoryItemId("负责印尼区域 OMC 运维"), { text: "负责印尼与日本区域 OMC 运维" });
    expect(edited.category).toBe("background");

    await service.remove(home, memoryItemId("回答请使用中文，先给结论"));
    scopes = await service.list("user1");
    expect(scopes[0].items.map((item) => item.text)).toEqual(["负责印尼与日本区域 OMC 运维"]);

    const raw = await readFile(path.join(agentStudioMemorySourcePath(home), "raw_memories.md"), "utf8");
    expect(raw).not.toContain("先给结论");
    expect(raw).not.toContain("负责印尼区域 OMC 运维");
    const projected = await readFile(path.join(home, "memories", "MEMORY.md"), "utf8");
    expect(projected).toContain("负责印尼与日本区域 OMC 运维");
  });

  it("does not resurrect raw entries once every memory is deleted", async () => {
    await service.add(home, { text: "喜欢表格形式的总结", category: "preference" });
    await service.remove(home, memoryItemId("喜欢表格形式的总结"));
    const scopes = await service.list("user1");
    expect(scopes[0].items).toEqual([]);
    expect(await service.countForCodexHome(home)).toBe(0);
  });
});
