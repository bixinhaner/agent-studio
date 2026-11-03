import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findCodexThreadArtifacts, planArchivedThreadPurge, removePaths, type PurgeThreadRow } from "./archived-thread-purge.js";

const now = new Date("2026-11-20T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const root = "/data/sessions/org/u1/agent-a";

function thread(overrides: Partial<PurgeThreadRow> & { id: string }): PurgeThreadRow {
  return {
    status: "archived",
    workspace: `${root}/thread-${overrides.id}`,
    codexThreadId: null,
    archivedAt: daysAgo(10),
    updatedAt: daysAgo(10),
    archivedDataPurgedAt: null,
    workspaceTrashBatchId: null,
    lastMessageAt: daysAgo(10),
    lastSessionAt: daysAgo(10),
    ...overrides
  };
}

function plan(threads: PurgeThreadRow[], sessions: Array<{ threadId: string; codexThreadId: string }> = []) {
  return planArchivedThreadPurge({ threads, sessionCodexThreadIds: sessions, now, retentionDays: 7 });
}

describe("planArchivedThreadPurge", () => {
  it("purges tasks archived longer than the retention window", () => {
    const result = plan([
      thread({ id: "old", codexThreadId: "codex-old" }),
      thread({ id: "recent", archivedAt: daysAgo(3), codexThreadId: "codex-recent" }),
      thread({ id: "live", status: "regular", archivedAt: null, codexThreadId: "codex-live" })
    ]);
    expect(result.threadIds).toEqual(["old"]);
    expect(result.workspaces).toEqual([`${root}/thread-old`]);
    expect(result.codexThreadIds).toEqual(["codex-old"]);
  });

  it("falls back to updated_at and waits for recent messages or sessions", () => {
    const result = plan([
      thread({ id: "no-archived-at", archivedAt: null, updatedAt: daysAgo(30) }),
      thread({ id: "recent-message", lastMessageAt: daysAgo(2) }),
      thread({ id: "recent-session", lastSessionAt: daysAgo(1) })
    ]);
    expect(result.threadIds).toEqual(["no-archived-at"]);
  });

  it("leaves folder-trash tasks and already purged tasks alone", () => {
    const result = plan([
      thread({ id: "folder-trash", workspaceTrashBatchId: "batch" }),
      thread({ id: "done", archivedDataPurgedAt: daysAgo(5) })
    ]);
    expect(result.threadIds).toEqual([]);
  });

  it("only removes the task's upload folder from a workspace other threads can reach", () => {
    const result = plan([
      // Legacy shared agent dir: an archived and a live thread use it.
      thread({ id: "a1", workspace: root }),
      thread({ id: "l1", status: "regular", archivedAt: null, workspace: root }),
      // Archived thread nested in a live legacy workspace.
      thread({ id: "nested" }),
      thread({ id: "l2", status: "regular", archivedAt: null, workspace: "/data/sessions/org/u1/agent-a" })
    ]);
    expect(result.threadIds).toEqual(["a1", "nested"]);
    expect(result.workspaces).toEqual([]);
    expect(result.uploadDirs).toEqual([
      `${root}/.agent-studio/uploads/a1`,
      `${root}/thread-nested/.agent-studio/uploads/nested`
    ]);
  });

  it("removes connector conversations and keeps Codex threads shared with a live task", () => {
    const conversation = "/data/sessions/integrations/action_connector/c1/agent-default/conversations/abc";
    const result = plan(
      [
        thread({ id: "conv", workspace: conversation, codexThreadId: "codex-conv" }),
        thread({ id: "live", status: "regular", archivedAt: null, workspace: `${root}/thread-live` })
      ],
      [
        { threadId: "conv", codexThreadId: "codex-earlier" },
        { threadId: "conv", codexThreadId: "codex-shared" },
        { threadId: "live", codexThreadId: "codex-shared" }
      ]
    );
    expect(result.workspaces).toEqual([conversation]);
    expect(result.codexThreadIds).toEqual(["codex-conv", "codex-earlier"]);
  });
});

describe("codex artifacts", () => {
  let base: string;
  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "archived-purge-"));
  });
  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("finds rollouts, images and shell snapshots of the given Codex threads only", async () => {
    const gone = "019a0000-0000-7000-8000-000000000001";
    const kept = "019a0000-0000-7000-8000-000000000002";
    const home = path.join(base, "org", "user", "agent-x");
    const files = [
      `sessions/2026/10/01/rollout-2026-10-01T00-00-00-${gone}.jsonl`,
      `sessions/2026/10/01/rollout-2026-10-01T00-00-00-${kept}.jsonl`,
      `archived_sessions/rollout-2026-09-01T00-00-00-${gone}.jsonl`,
      `generated_images/${gone}/a.png`,
      `generated_images/${kept}/b.png`,
      `shell_snapshots/${gone}.123.sh`,
      `plugins/cache/sessions/rollout-x-${gone}.jsonl`
    ];
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(home, file)), { recursive: true });
      await fs.writeFile(path.join(home, file), "x");
    }
    const found = await findCodexThreadArtifacts(base, new Set([gone]));
    expect(found.map((item) => path.relative(home, item))).toEqual([
      `archived_sessions/rollout-2026-09-01T00-00-00-${gone}.jsonl`,
      `generated_images/${gone}`,
      `sessions/2026/10/01/rollout-2026-10-01T00-00-00-${gone}.jsonl`,
      `shell_snapshots/${gone}.123.sh`
    ]);

    expect(await removePaths(found, true)).toEqual({ paths: 4, bytes: 4 });
    await expect(fs.stat(found[0])).resolves.toBeTruthy();
    expect(await removePaths(found, false)).toEqual({ paths: 4, bytes: 4 });
    for (const item of found) await expect(fs.stat(item)).rejects.toThrow();
    await expect(fs.stat(path.join(home, `generated_images/${kept}/b.png`))).resolves.toBeTruthy();
  });

  it("does not follow a symlinked directory", async () => {
    const outside = path.join(base, "outside");
    await fs.mkdir(path.join(outside, "keep"), { recursive: true });
    await fs.writeFile(path.join(outside, "keep", "file"), "x");
    const link = path.join(base, "thread-link");
    await fs.symlink(outside, link);
    expect(await removePaths([link], false)).toEqual({ paths: 1, bytes: expect.any(Number) });
    await expect(fs.stat(path.join(outside, "keep", "file"))).resolves.toBeTruthy();
  });
});
