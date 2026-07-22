import { describe, expect, it } from "vitest";

import { consolidateCodexFileChangeParts } from "./file-change-display";

function fileChange(data: Record<string, unknown>) {
  return { type: "data", name: "codex_file_change", data };
}

describe("consolidateCodexFileChangeParts", () => {
  it("replaces a runtime update with the final ready artifact at the latest position", () => {
    const result = consolidateCodexFileChangeParts([
      fileChange({ changes: [{ path: "儿童古诗.md", kind: "update" }] }),
      { type: "text", text: "文件已经生成。" },
      fileChange({
        artifact_only: true,
        changes: [
          {
            path: "儿童古诗.md",
            kind: "ready",
            can_preview: true,
            can_download: true,
            artifact_id: "artifact-1"
          }
        ]
      })
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "text", text: "文件已经生成。" });
    expect(result[1]).toMatchObject({
      type: "data",
      name: "codex_file_change",
      data: {
        artifact_only: true,
        changes: [
          {
            path: "儿童古诗.md",
            kind: "ready",
            can_preview: true,
            can_download: true,
            artifact_id: "artifact-1"
          }
        ]
      }
    });
  });

  it("groups different generated paths into one block without disturbing other content", () => {
    const result = consolidateCodexFileChangeParts([
      { type: "data", name: "codex_commentary", data: { text: "处理中" } },
      fileChange({ changes: [{ path: "a.md", kind: "update" }] }),
      { type: "text", text: "完成" },
      fileChange({ changes: [{ path: "b.pdf", kind: "ready", can_download: true }] })
    ]);

    expect(result.map((part) => (part as { name?: string }).name)).toEqual(["codex_commentary", undefined, "codex_file_change"]);
    expect((result[2] as any).data.changes).toEqual([
      { path: "a.md", kind: "update" },
      { path: "b.pdf", kind: "ready", can_download: true }
    ]);
  });

  it("does not let a late progress event downgrade a ready artifact", () => {
    const result = consolidateCodexFileChangeParts([
      fileChange({ changes: [{ path: "report.md", kind: "ready", can_download: true }] }),
      fileChange({ changes: [{ path: "report.md", kind: "update" }] })
    ]);

    expect((result[0] as any).data.changes).toEqual([
      { path: "report.md", kind: "ready", can_download: true }
    ]);
  });

  it("merges an absolute runtime path with its ready relative artifact path", () => {
    const result = consolidateCodexFileChangeParts([
      fileChange({
        changes: [
          {
            path: "/var/lib/agent-studio/sessions/thread-1/儿童古诗.md",
            kind: "update"
          }
        ]
      }),
      fileChange({
        changes: [
          {
            path: "儿童古诗.md",
            kind: "ready",
            can_preview: true,
            can_download: true,
            artifact_id: "artifact-1"
          }
        ]
      })
    ]);

    expect((result[0] as any).data.changes).toEqual([
      {
        path: "儿童古诗.md",
        kind: "ready",
        can_preview: true,
        can_download: true,
        artifact_id: "artifact-1"
      }
    ]);
  });

  it("keeps the ready relative artifact when an absolute progress event arrives later", () => {
    const result = consolidateCodexFileChangeParts([
      fileChange({ changes: [{ path: "report.md", kind: "ready", can_download: true }] }),
      fileChange({ changes: [{ path: "/workspace/thread-1/report.md", kind: "update" }] })
    ]);

    expect((result[0] as any).data.changes).toEqual([
      { path: "report.md", kind: "ready", can_download: true }
    ]);
  });

  it("does not collapse genuinely different files that share a basename", () => {
    const result = consolidateCodexFileChangeParts([
      fileChange({
        changes: [
          { path: "/workspace/reports/report.md", kind: "update" },
          { path: "/workspace/archive/report.md", kind: "update" }
        ]
      }),
      fileChange({ changes: [{ path: "report.md", kind: "ready", can_download: true }] })
    ]);

    expect((result[0] as any).data.changes).toHaveLength(3);
  });

  it("places a single file block after the completed answer", () => {
    const result = consolidateCodexFileChangeParts([
      fileChange({ changes: [{ path: "only.md", kind: "update" }] }),
      { type: "text", text: "文件已经生成。" }
    ]);

    expect(result).toEqual([
      { type: "text", text: "文件已经生成。" },
      fileChange({ changes: [{ path: "only.md", kind: "update" }] })
    ]);
  });
});
