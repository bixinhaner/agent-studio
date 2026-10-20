import { afterEach, describe, expect, it } from "vitest";

import {
  findBlockingPortalActiveChatRun,
  findPortalChatRunById,
  findPortalPreflightChatRun,
  portalActiveChatRuns,
  portalPreflightChatRuns,
  registerPortalPreflightChatRun,
  type PortalActiveChatRun
} from "./portal-run-registry.js";

function activeRun(overrides: Partial<PortalActiveChatRun> = {}): PortalActiveChatRun {
  return {
    userId: "user-1",
    organizationId: "org-1",
    controller: new AbortController(),
    createdAt: Date.now(),
    runId: "run-active",
    threadId: "thread-1",
    acceptedAt: new Date().toISOString(),
    ...overrides
  };
}

function preflight(overrides: Partial<Parameters<typeof registerPortalPreflightChatRun>[0]> = {}) {
  const controller = new AbortController();
  const unregister = registerPortalPreflightChatRun({
    runId: "run-1",
    userId: "user-1",
    organizationId: "org-1",
    controller,
    threadId: "thread-1",
    userMessageId: "msg-1",
    ...overrides
  });
  return { controller, unregister };
}

afterEach(() => {
  portalActiveChatRuns.clear();
  portalPreflightChatRuns.clear();
});

describe("portal run registry", () => {
  it("blocks a second send on a thread whose first send is still starting its session", () => {
    preflight();
    expect(findBlockingPortalActiveChatRun("", "user-1", "thread-1")?.runId).toBe("run-1");
    // The send itself is not blocked by its own registration.
    expect(findBlockingPortalActiveChatRun("session-new", "user-1", "thread-1", "run-1")).toBeUndefined();
    // Other users and threads are unaffected.
    expect(findBlockingPortalActiveChatRun("", "user-2", "thread-1")).toBeUndefined();
    expect(findBlockingPortalActiveChatRun("", "user-1", "thread-2")).toBeUndefined();
  });

  it("still blocks on another run of the same session while excluding the caller's run id", () => {
    portalActiveChatRuns.set("session-1", activeRun({ runId: "run-old" }));
    expect(findBlockingPortalActiveChatRun("session-1", "user-1", "thread-1", "run-new")?.runId).toBe("run-old");
  });

  it("finds an accepted send by its run id so a retry never runs the turn twice", () => {
    preflight();
    portalActiveChatRuns.set("session-1", activeRun({ runId: "run-2", threadId: "thread-2" }));
    expect(findPortalChatRunById("run-1", "user-1")?.threadId).toBe("thread-1");
    expect(findPortalChatRunById("run-2", "user-1")?.threadId).toBe("thread-2");
    expect(findPortalChatRunById("run-1", "user-2")).toBeUndefined();
    expect(findPortalChatRunById("run-3", "user-1")).toBeUndefined();
  });

  it("ignores stopped runs", () => {
    const { controller } = preflight();
    controller.abort();
    expect(findPortalChatRunById("run-1", "user-1")).toBeUndefined();
    expect(findBlockingPortalActiveChatRun("", "user-1", "thread-1")).toBeUndefined();
    expect(findPortalPreflightChatRun({ userId: "user-1", threadId: "thread-1" })).toBeUndefined();
  });

  it("locates a starting send for a stop request by run id or thread", () => {
    preflight();
    expect(findPortalPreflightChatRun({ userId: "user-1", runId: "run-1" })?.userMessageId).toBe("msg-1");
    expect(findPortalPreflightChatRun({ userId: "user-1", threadId: "thread-1" })?.runId).toBe("run-1");
    expect(findPortalPreflightChatRun({ userId: "user-1", runId: "run-x", threadId: "thread-1" })).toBeUndefined();
    expect(findPortalPreflightChatRun({ userId: "user-2", runId: "run-1" })).toBeUndefined();
  });

  it("unregisters only its own entry", () => {
    const first = preflight();
    const second = preflight();
    first.unregister();
    expect(portalPreflightChatRuns.get("run-1")?.controller).toBe(second.controller);
    second.unregister();
    expect(portalPreflightChatRuns.size).toBe(0);
  });
});
