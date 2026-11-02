import { afterEach, describe, expect, it, vi } from "vitest";

import { PRESENCE_HEARTBEAT_MS, startPortalPresence } from "./portal-presence";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("portal presence heartbeat", () => {
  it("beats on start, on the interval while visible, and when the tab comes back", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const stop = startPortalPresence({ send, now: () => Date.now() });
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);
    expect(send).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);
    expect(send).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(send).toHaveBeenCalledTimes(3);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(send).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 3);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
