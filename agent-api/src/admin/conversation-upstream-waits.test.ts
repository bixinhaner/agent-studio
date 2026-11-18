import { describe, expect, it } from "vitest";
import { attachUpstreamWaits, readUpstreamWait } from "./conversation-upstream-waits.js";

const row = (id: string, at: string, recordedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: new Date(recordedAt),
  resultStatus: "success",
  metadata: {
    source: "action_connector_chat_stream",
    upstreamWaits: {
      count: 1,
      totalWaitMs: 330_000,
      kinds: ["serverOverloaded"],
      entries: [{ at, attempt: 1, maxAttempts: 5, kind: "serverOverloaded", message: "Reconnecting... 1/5", waitedMs: 330_000, resumedAt: recordedAt }]
    },
    ...extra
  }
});

describe("conversation upstream waits", () => {
  it("ignores usage rows without waits", () => {
    expect(readUpstreamWait({ id: "u", createdAt: new Date(), resultStatus: "success", metadata: { source: "chat_stream" } })).toBeNull();
  });

  it("attaches each wait to the answer saved after it began", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: "2026-11-18T03:00:00.000Z" },
      { id: "a1", role: "assistant", createdAt: "2026-11-18T03:01:00.000Z" },
      { id: "u2", role: "user", createdAt: "2026-11-18T03:10:00.000Z" },
      { id: "a2", role: "assistant", createdAt: "2026-11-18T03:17:00.000Z" }
    ];
    const result = attachUpstreamWaits(messages, [
      row("usage-2", "2026-11-18T03:10:30.000Z", "2026-11-18T03:17:00.000Z"),
      { id: "usage-1", createdAt: new Date("2026-11-18T03:01:00.000Z"), resultStatus: "success", metadata: { source: "chat_stream" } }
    ]);
    expect(result.find((m) => m.id === "a1")?.upstreamWaits).toBeUndefined();
    expect(result.find((m) => m.id === "a2")?.upstreamWaits).toEqual([
      expect.objectContaining({ usageEventId: "usage-2", count: 1, totalWaitMs: 330_000, source: "action_connector_chat_stream" })
    ]);
  });

  it("falls back to the last answer for a wait after every saved answer", () => {
    const result = attachUpstreamWaits(
      [{ id: "a1", role: "assistant", createdAt: "2026-11-18T03:01:00.000Z" }],
      [row("usage-3", "2026-11-18T04:00:00.000Z", "2026-11-18T04:05:00.000Z")]
    );
    expect(result[0]?.upstreamWaits?.[0]?.usageEventId).toBe("usage-3");
  });
});
