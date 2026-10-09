import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchAdminConversationLocalOperation: vi.fn(async () => ({
    id: "op-1", op: "exec", source: "agent", status: "completed", ok: true, target: "npm test", destination: null,
    error: null, exitCode: 1, running: false, deviceName: "Like MacBook", platform: "darwin", rootPath: "/Users/like/proj",
    createdAt: "2026-10-09T10:00:00.000Z", completedAt: "2026-10-09T10:00:05.000Z", hasDetail: true, argsChars: 30, resultChars: 40,
    args: { command: "npm test", cwd: "/Users/like/proj" },
    result: { ok: true, exit_code: 1, output: "FAIL src/a.test.ts\nExpected 1" }
  }))
}));

import {
  currentWorkspaceSummary,
  TranscriptExecutionLocationChip,
  TranscriptLocalEventRow,
  TranscriptLocalOperations
} from "./ConversationLocalActivity";

describe("ConversationLocalActivity", () => {
  it("shows where a turn ran", () => {
    render(<TranscriptExecutionLocationChip location={{ mode: "local", deviceName: "Like MacBook", platform: "darwin", path: "/Users/like/proj", label: "proj", source: "recorded" }} />);
    expect(screen.getByText(/本地 · Like MacBook · proj/)).toBeTruthy();
    render(<TranscriptExecutionLocationChip location={{ mode: "cloud", deviceName: null, platform: null, path: null, label: null, source: "derived" }} />);
    expect(screen.getByText("云端")).toBeTruthy();
    expect(screen.getByText("推断")).toBeTruthy();
  });

  it("lists local operations and loads the full args and output on demand", async () => {
    render(
      <TranscriptLocalOperations
        threadId="thread-1"
        operations={[{
          id: "op-1", op: "exec", source: "agent", status: "completed", ok: true, target: "npm test", destination: null,
          error: null, exitCode: 1, running: false, deviceName: "Like MacBook", platform: "darwin", rootPath: "/Users/like/proj",
          createdAt: "2026-10-09T10:00:00.000Z", completedAt: null, hasDetail: true, argsChars: 30, resultChars: 40
        }]}
      />
    );
    expect(screen.getByText(/Like MacBook · 执行命令/)).toBeTruthy();
    expect(screen.getByText(/成功 · exit 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /查看完整参数与结果/ }));
    await waitFor(() => expect(screen.getByText(/FAIL src\/a.test.ts/)).toBeTruthy());
    expect(screen.getByText("cwd")).toBeTruthy();
  });

  it("explains folder switches and portal downloads", () => {
    render(
      <TranscriptLocalEventRow
        threadId="thread-1"
        event={{
          id: "e1", kind: "switched", at: "2026-10-09T10:00:00.000Z",
          from: { mode: "local", deviceName: "PC", platform: null, path: "/a", label: "a", source: "derived" },
          to: { mode: "cloud", deviceName: null, platform: null, path: null, label: null, source: "derived" }
        }}
      />
    );
    expect(screen.getByText("切换工作区：PC · /a → 云端工作区")).toBeTruthy();
    render(
      <TranscriptLocalEventRow
        threadId="thread-1"
        event={{
          id: "e2", kind: "operation", at: "2026-10-09T10:00:00.000Z", from: null, to: null,
          operation: {
            id: "op-9", op: "read", source: "portal", status: "completed", ok: true, target: "/a/report.pdf", destination: null,
            error: null, exitCode: null, running: null, deviceName: "PC", platform: null, rootPath: "/a",
            createdAt: "2026-10-09T10:00:00.000Z", completedAt: null, hasDetail: true, argsChars: 1, resultChars: 1
          }
        }}
      />
    );
    expect(screen.getByText("用户在 Portal 中下载文件：/a/report.pdf · 成功")).toBeTruthy();
  });

  it("puts the bound local folder in the header", () => {
    expect(currentWorkspaceSummary("/srv/ws/1", undefined)).toMatchObject({ label: "/srv/ws/1", local: false });
    expect(currentWorkspaceSummary("/srv/ws/1", {
      current: { mode: "local", deviceId: "d", deviceName: "PC", platform: "win32", path: "C:\\work", label: "work", online: true },
      events: []
    })).toMatchObject({ label: "本地 · PC · C:\\work", local: true, online: true });
  });
});
