import { describe, expect, it } from "vitest";

import {
  selectVisibleWorkspaceThreads,
  sortWorkspaceThreads
} from "./workspace-thread-order";

function thread(id: string, updatedAt: string) {
  return { id, external_id: null, updated_at: updatedAt };
}

describe("workspace thread ordering", () => {
  it("keeps running and unread threads ahead of ordinary recent threads", () => {
    const threads = [
      thread("ordinary-old", "2026-07-31T08:00:00.000Z"),
      thread("unread", "2026-07-31T07:00:00.000Z"),
      thread("running", "2026-07-31T06:00:00.000Z"),
      thread("ordinary-new", "2026-07-31T09:00:00.000Z")
    ];

    const result = sortWorkspaceThreads(threads, { running: true }, { unread: true });

    expect(result.map((item) => item.id)).toEqual(["unread", "running", "ordinary-new", "ordinary-old"]);
  });

  it("does not hide priority threads when they exceed the ordinary five-item limit", () => {
    const threads = Array.from({ length: 7 }, (_, index) => thread(`running-${index}`, `2026-07-31T0${index}:00:00.000Z`));
    const result = selectVisibleWorkspaceThreads(threads, {
      "running-0": true,
      "running-1": true,
      "running-2": true,
      "running-3": true,
      "running-4": true,
      "running-5": true
    }, {}, 5);

    expect(result.map((item) => item.id)).toEqual([
      "running-0",
      "running-1",
      "running-2",
      "running-3",
      "running-4",
      "running-5"
    ]);
  });

  it("keeps the selected thread visible even when it is older than the ordinary window", () => {
    const threads = [
      thread("selected", "2026-07-31T01:00:00.000Z"),
      thread("recent-1", "2026-07-31T09:00:00.000Z"),
      thread("recent-2", "2026-07-31T08:00:00.000Z"),
      thread("recent-3", "2026-07-31T07:00:00.000Z"),
      thread("recent-4", "2026-07-31T06:00:00.000Z"),
      thread("recent-5", "2026-07-31T05:00:00.000Z")
    ];
    const result = selectVisibleWorkspaceThreads(
      threads,
      {},
      {},
      5,
      { selected: true }
    );

    expect(result.map((item) => item.id)).toContain("selected");
  });
});
