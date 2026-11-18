import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UPSTREAM_WAIT_EVENT_TYPE,
  UpstreamWaitTracker,
  createUpstreamWaitDeadline,
  parseAnnouncedDelayMs,
  upstreamWaitEvent,
  upstreamWaitNoticeFromAppServerError,
  upstreamWaitUsageMetadata
} from "./upstream-wait.js";

afterEach(() => vi.useRealTimers());

describe("upstream wait notices", () => {
  it("parses the app-server willRetry notification into a text-free event", () => {
    const notice = upstreamWaitNoticeFromAppServerError({
      willRetry: true,
      error: {
        message: "Reconnecting... 2/5",
        additionalDetails: "Selected model is at capacity. Please try a different model.",
        codexErrorInfo: "serverOverloaded"
      }
    }, new Date("2026-11-18T03:00:00.000Z"));
    expect(notice).toMatchObject({ at: "2026-11-18T03:00:00.000Z", attempt: 2, maxAttempts: 5, kind: "serverOverloaded" });
    expect(notice.message).toContain("Selected model is at capacity");
    const event = upstreamWaitEvent(notice);
    expect(event.type).toBe(UPSTREAM_WAIT_EVENT_TYPE);
    expect(event).not.toHaveProperty("text");
    expect(event).not.toHaveProperty("delta");
  });

  it("derives a kind from text and reads announced delays", () => {
    expect(upstreamWaitNoticeFromAppServerError({ message: "exceeded retry limit, last status: 429 Too Many Requests 1/5" }).kind).toBe("rateLimited");
    expect(parseAnnouncedDelayMs("retrying sampling request (1/5 in 328.99s)")).toBe(328_990);
    expect(parseAnnouncedDelayMs("Please try again in 5m28s")).toBe(328_000);
    expect(parseAnnouncedDelayMs("Reconnecting... 1/5")).toBeUndefined();
  });
});

describe("UpstreamWaitTracker", () => {
  it("measures each wait until the next runtime event and summarises the turn", () => {
    let now = Date.parse("2026-11-18T03:00:00.000Z");
    const tracker = new UpstreamWaitTracker(() => now);
    const notice = (attempt: number) => upstreamWaitEvent({ at: new Date(now).toISOString(), attempt, maxAttempts: 5, kind: "serverOverloaded", message: "m" });
    expect(tracker.observe(notice(1))).toBeTruthy();
    now += 330_000;
    expect(tracker.observe(notice(2))).toBeTruthy();
    now += 300_000;
    expect(tracker.observe({ type: "item.agent_message.delta", delta: "hi" })).toBeUndefined();
    const summary = tracker.summary()!;
    expect(summary).toMatchObject({ count: 2, totalWaitMs: 630_000, kinds: ["serverOverloaded"] });
    expect(summary.entries.map((entry) => entry.waitedMs)).toEqual([330_000, 300_000]);
    expect(upstreamWaitUsageMetadata(tracker)).toEqual({ upstreamWaits: summary });
  });

  it("adds nothing to usage metadata when the turn never waited", () => {
    const tracker = new UpstreamWaitTracker();
    tracker.observe({ type: "turn.completed" });
    expect(upstreamWaitUsageMetadata(tracker)).toEqual({});
  });
});

describe("createUpstreamWaitDeadline", () => {
  it("excludes announced waits from the budget, up to the cap", async () => {
    vi.useFakeTimers();
    const onExtend = vi.fn();
    const deadline = createUpstreamWaitDeadline({ budgetMs: 300_000, maxExtensionMs: 600_000, onExtend });
    await vi.advanceTimersByTimeAsync(200_000);
    deadline.onUpstreamWait({ delayMs: 330_000 });
    expect(onExtend).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400_000);
    expect(deadline.signal.aborted).toBe(false);
    deadline.onUpstreamWait({});
    deadline.onUpstreamWait({});
    expect(deadline.extendedMs).toBe(600_000);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(deadline.signal.aborted).toBe(true);
    expect((deadline.signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("times out at the budget without waits", async () => {
    vi.useFakeTimers();
    const deadline = createUpstreamWaitDeadline({ budgetMs: 1_000, maxExtensionMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });
});
