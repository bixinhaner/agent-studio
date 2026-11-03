import { describe, expect, it } from "vitest";

import { shouldReloadTimeline, timelineReloadKey } from "./timeline-sync";

const base = {
  activeThreadId: "t1",
  server: { id: "t1", head_id: "phone-answer" },
  localHeadId: "desktop-answer",
  localBusy: false,
  serverRunning: false,
  lastReloadKey: ""
};

describe("timeline sync", () => {
  it("reloads when another device added messages to the open task", () => {
    expect(shouldReloadTimeline(base)).toBe(true);
  });

  it("does nothing when the page already shows the server's last message", () => {
    expect(shouldReloadTimeline({ ...base, localHeadId: "phone-answer" })).toBe(false);
  });

  it("waits while this page is sending or loading, or a run is going on elsewhere", () => {
    expect(shouldReloadTimeline({ ...base, localBusy: true })).toBe(false);
    expect(shouldReloadTimeline({ ...base, serverRunning: true })).toBe(false);
  });

  it("ignores another task's head and an unknown head", () => {
    expect(shouldReloadTimeline({ ...base, server: { id: "t2", head_id: "x" } })).toBe(false);
    expect(shouldReloadTimeline({ ...base, server: { id: "t1", head_id: null } })).toBe(false);
    expect(shouldReloadTimeline({ ...base, server: undefined })).toBe(false);
  });

  it("loads one server state once even if the ids still differ afterwards", () => {
    expect(shouldReloadTimeline({ ...base, lastReloadKey: timelineReloadKey("t1", "phone-answer") })).toBe(false);
    expect(shouldReloadTimeline({ ...base, server: { id: "t1", head_id: "newer" }, lastReloadKey: timelineReloadKey("t1", "phone-answer") })).toBe(true);
  });
});
