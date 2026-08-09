import { describe, expect, it } from "vitest";

import {
  PORTAL_COMPOSER_STATE_TTL_MS,
  createPortalQueueItem,
  emptyPortalComposerStoredState,
  loadPortalComposerStoredState,
  portalComposerStorageKey,
  savePortalComposerStoredState
} from "./composer-workflow-state";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

describe("portal composer workflow state", () => {
  it("isolates drafts and queues by user and thread", () => {
    const storage = memoryStorage();
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    savePortalComposerStoredState(storage, "user-1", "thread-a", {
      ...emptyPortalComposerStoredState(now),
      draft: "preserved draft",
      queue: [createPortalQueueItem("queued instruction", { id: "queue-1", now })]
    }, now);

    expect(loadPortalComposerStoredState(storage, "user-1", "thread-a", now)).toMatchObject({
      draft: "preserved draft",
      queue: [{ id: "queue-1", text: "queued instruction", status: "queued" }]
    });
    expect(loadPortalComposerStoredState(storage, "user-1", "thread-b", now).draft).toBe("");
    expect(loadPortalComposerStoredState(storage, "user-2", "thread-a", now).queue).toEqual([]);
    expect(portalComposerStorageKey("user-1", "thread-a")).not.toBe(portalComposerStorageKey("user-2", "thread-a"));
  });

  it("expires old drafts after thirty days", () => {
    const storage = memoryStorage();
    const savedAt = Date.parse("2026-07-01T00:00:00.000Z");
    savePortalComposerStoredState(storage, "user-1", "thread-a", {
      ...emptyPortalComposerStoredState(savedAt),
      draft: "stale"
    }, savedAt);

    expect(
      loadPortalComposerStoredState(storage, "user-1", "thread-a", savedAt + PORTAL_COMPOSER_STATE_TTL_MS + 1)
    ).toEqual(emptyPortalComposerStoredState(savedAt + PORTAL_COMPOSER_STATE_TTL_MS + 1));
  });

  it("recovers a browser-closed sending item as a failed paused item", () => {
    const storage = memoryStorage();
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    savePortalComposerStoredState(storage, "user-1", "thread-a", {
      ...emptyPortalComposerStoredState(now),
      queue: [{ ...createPortalQueueItem("in flight", { id: "queue-1", now }), status: "sending" }]
    }, now);

    expect(loadPortalComposerStoredState(storage, "user-1", "thread-a", now)).toMatchObject({
      pausedReason: "failed",
      queue: [{ id: "queue-1", status: "failed" }]
    });
  });
});
