import { describe, expect, it } from "vitest";

import { assertMessageGraphForPersistence } from "./thread-repository.js";

describe("thread message graph persistence", () => {
  it("accepts a valid cross-channel message chain", () => {
    expect(() => assertMessageGraphForPersistence([
      { parentId: null, message: { id: "user-1", role: "user" } },
      { parentId: "user-1", message: { id: "assistant-1", role: "assistant" } },
      { parentId: "assistant-1", message: { id: "user-2", role: "user" } }
    ])).not.toThrow();
  });

  it("rejects a parent id that was never persisted", () => {
    expect(() => assertMessageGraphForPersistence([
      { parentId: "temporary-client-id", message: { id: "user-1", role: "user" } }
    ])).toThrow("parent must exist");
  });

  it("rejects cycles for every channel", () => {
    expect(() => assertMessageGraphForPersistence([
      { parentId: "assistant-1", message: { id: "user-1", role: "user" } },
      { parentId: "user-1", message: { id: "assistant-1", role: "assistant" } }
    ])).toThrow("cannot contain a cycle");
  });
});
