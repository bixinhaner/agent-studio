import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentStudioMemorySourcePath, buildMemorySummary, syncAgentStudioMemoryProjection } from "./engine.js";
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
    expect(scopes[0].id).toBe("internal~agent-general");
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

  async function legacyHome(hash: string, options: { items?: string[]; nativeHandbook?: string; inHomeSource?: boolean; mtime: string }) {
    const codexHome = path.join(root, "internal", "user1", `agent-general-${hash}`);
    const dir = path.join(codexHome, options.inHomeSource ? ".agent-studio/memory-source" : "memories");
    await mkdir(dir, { recursive: true });
    const raw = ["# Raw Memories", "", ...(options.items ?? []).flatMap((item) => ["## 2026-06-01T00:00:00.000Z", "- category: preference", `- memory: ${item}`, ""])].join("\n");
    await writeFile(path.join(dir, "raw_memories.md"), raw, "utf8");
    await writeFile(path.join(dir, "MEMORY.md"), options.nativeHandbook ?? buildMemorySummary(options.items ?? []), "utf8");
    const time = new Date(options.mtime);
    for (const name of ["raw_memories.md", "MEMORY.md"]) await utimes(path.join(dir, name), time, time);
    return codexHome;
  }

  it("collapses an assistant's per-capability homes into one scope and merges their memories", async () => {
    await legacyHome("aaaaaa", { items: ["喜欢表格", "先给结论"], inHomeSource: true, mtime: "2026-06-01T00:00:00Z" });
    await legacyHome("bbbbbb", { items: ["先给结论", "负责印尼 OMC"], mtime: "2026-09-01T00:00:00Z" });
    // Codex-native handbooks are not discrete items and are left in their home.
    const native = await legacyHome("cccccc", { nativeHandbook: "# Task Group: product knowledge\n\nlong handbook", mtime: "2026-10-01T00:00:00Z" });

    const [scope, ...rest] = await service.list("user1");
    expect(rest).toEqual([]);
    expect(scope.id).toBe("internal~agent-general");
    expect(scope.items.map((item) => [item.text, item.category])).toEqual([
      ["喜欢表格", "preference"],
      ["先给结论", "preference"],
      ["负责印尼 OMC", "preference"]
    ]);

    // Editing writes the merged store once; older homes keep their files as they were.
    await service.add(native, { text: "回答用中文", category: "preference" });
    const store = agentStudioMemorySourcePath(native);
    expect(store).toBe(path.join(root, "internal", "user1", ".agent-studio-memory", "agent-general"));
    const summary = await readFile(path.join(store, "memory_summary.md"), "utf8");
    expect(summary).toContain("- 负责印尼 OMC");
    expect(summary).toContain("- 回答用中文");
    expect(summary).not.toContain("Task Group");
    expect((await service.list("user1"))[0].items).toHaveLength(4);
  });

  it("projects the merged memories into a brand-new capability home", async () => {
    await legacyHome("aaaaaa", { items: ["先给结论"], mtime: "2026-06-01T00:00:00Z" });
    const fresh = path.join(root, "internal", "user1", "agent-general-dddddd");
    await mkdir(fresh, { recursive: true });

    await syncAgentStudioMemoryProjection(fresh);

    expect(await readFile(path.join(fresh, "memories", "memory_summary.md"), "utf8")).toContain("- 先给结论");
    expect(await service.countForCodexHome(fresh)).toBe(1);
  });

  it("leaves homes with only a Codex-native handbook untouched", async () => {
    const native = await legacyHome("cccccc", { nativeHandbook: "# Memory Handbook\n\nnative", mtime: "2026-10-01T00:00:00Z" });
    await syncAgentStudioMemoryProjection(native);
    expect(await readFile(path.join(native, "memories", "MEMORY.md"), "utf8")).toContain("native");
    expect(await service.countForCodexHome(native)).toBe(0);
  });
});
