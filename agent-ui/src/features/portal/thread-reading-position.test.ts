import { describe, expect, it } from "vitest";

import {
  readThreadReadingPosition,
  resolveReturnToLatestBehavior,
  resolveThreadScrollFollowMode,
  writeThreadReadingPosition
} from "./thread-reading-position";

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>();
  if (initial) values.set("agent-studio.portal.thread-reading-position.v1", initial);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

describe("thread reading position", () => {
  it("persists a message anchor and relative offset", () => {
    const storage = memoryStorage();
    writeThreadReadingPosition(storage, "user-1:thread-1", {
      messageId: "message-8",
      offset: -24,
      atBottom: false
    }, 1_000);

    expect(readThreadReadingPosition(storage, "user-1:thread-1", 2_000)).toEqual({
      messageId: "message-8",
      offset: -24,
      atBottom: false,
      updatedAt: 1_000
    });
  });

  it("ignores malformed and expired entries", () => {
    const malformed = memoryStorage("not-json");
    expect(readThreadReadingPosition(malformed, "thread", 1_000)).toBeNull();

    const storage = memoryStorage();
    writeThreadReadingPosition(storage, "thread", {
      messageId: "message-1",
      offset: 0,
      atBottom: true
    }, 1_000);
    expect(readThreadReadingPosition(storage, "thread", 50 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("keeps only the 100 most recently viewed threads", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 105; index += 1) {
      writeThreadReadingPosition(storage, `thread-${index}`, {
        messageId: `message-${index}`,
        offset: 0,
        atBottom: true
      }, index + 1);
    }

    expect(readThreadReadingPosition(storage, "thread-0", 106)).toBeNull();
    expect(readThreadReadingPosition(storage, "thread-104", 106)?.messageId).toBe("message-104");
  });
});

describe("return to latest behavior", () => {
  it("uses smooth motion only for short explicit jumps", () => {
    expect(resolveReturnToLatestBehavior({ distance: 600, viewportHeight: 600, prefersReducedMotion: false }))
      .toBe("smooth");
    expect(resolveReturnToLatestBehavior({ distance: 901, viewportHeight: 600, prefersReducedMotion: false }))
      .toBe("instant");
  });

  it("uses instant positioning when reduced motion is requested", () => {
    expect(resolveReturnToLatestBehavior({ distance: 100, viewportHeight: 600, prefersReducedMotion: true }))
      .toBe("instant");
  });
});

describe("thread scroll follow mode", () => {
  it("always follows after the user actively sends a message", () => {
    expect(resolveThreadScrollFollowMode({ current: "reading-history", event: "user-send" }))
      .toBe("following");
  });

  it("does not let passive assistant content pull a history reader away", () => {
    expect(resolveThreadScrollFollowMode({ current: "reading-history", event: "passive-content" }))
      .toBe("reading-history");
  });

  it("continues following passive assistant content when already at the bottom", () => {
    expect(resolveThreadScrollFollowMode({ current: "following", event: "passive-content" }))
      .toBe("following");
  });

  it("resumes following when the user returns to the bottom", () => {
    expect(resolveThreadScrollFollowMode({ current: "reading-history", event: "viewport-at-bottom" }))
      .toBe("following");
  });
});
