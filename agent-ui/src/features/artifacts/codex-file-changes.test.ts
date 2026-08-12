import { describe, expect, it } from "vitest";

import { artifactFileName, collectCodexFileChanges } from "./codex-file-changes";

describe("collectCodexFileChanges", () => {
  it("uses the same normalized artifact view for portal and admin payload shapes", () => {
    const data = {
      changes: [
        {
          kind: "ready",
          path: "outputs\\thread-123\\report.pptx",
          preview_status: "ready",
          download_status: "ready",
          artifact_id: "artifact-1"
        }
      ]
    };

    expect(collectCodexFileChanges(data)).toEqual(collectCodexFileChanges([
      { type: "data", name: "codex_file_change", data }
    ]));
    expect(collectCodexFileChanges(data)).toEqual([
      {
        path: "outputs/thread-123/report.pptx",
        displayPath: "outputs/thread-123/report.pptx",
        kind: "ready",
        canPreview: true,
        canDownload: true,
        artifactId: "artifact-1",
        blockedReason: undefined
      }
    ]);
  });

  it("deduplicates repeated file events and keeps only file-change data", () => {
    const change = { kind: "ready", path: "outputs/report.xlsx", can_download: true };
    expect(collectCodexFileChanges([
      { changes: [change, change] },
      { type: "data", name: "codex_commentary", data: { changes: [change] } }
    ])).toHaveLength(1);
  });

  it("returns a safe display name without leaking the full workspace path", () => {
    expect(artifactFileName("/var/lib/agent-studio/thread/outputs/report.xlsx")).toBe("report.xlsx");
  });
});
