import { describe, expect, it } from "vitest";

import {
  assertPortalAssistantHasUserParent,
  assertPortalMessageRepositoryIntegrity
} from "./message-integrity.js";

describe("Portal message integrity", () => {
  it("accepts an assistant response whose user parent is already persisted", () => {
    expect(() => assertPortalAssistantHasUserParent({
      role: "assistant",
      parentId: "user-1",
      existingMessages: [{ id: "user-1", role: "user" }]
    })).not.toThrow();
  });

  it("rejects orphan assistant responses", () => {
    expect(() => assertPortalAssistantHasUserParent({
      role: "assistant",
      parentId: "missing-user",
      existingMessages: []
    })).toThrow("parent must be an existing user message");
  });

  it("validates a complete alternating repository", () => {
    expect(() => assertPortalMessageRepositoryIntegrity([
      { id: "user-1", role: "user", parentId: null },
      { id: "assistant-1", role: "assistant", parentId: "user-1" },
      { id: "user-2", role: "user", parentId: "assistant-1" },
      { id: "assistant-2", role: "assistant", parentId: "user-2" }
    ])).not.toThrow();
  });

  it("rejects a missing parent for a user message", () => {
    expect(() => assertPortalMessageRepositoryIntegrity([
      { id: "user-1", role: "user", parentId: "missing-assistant" }
    ])).toThrow("parent must exist");
  });

  it("rejects cycles even when every referenced id exists", () => {
    expect(() => assertPortalMessageRepositoryIntegrity([
      { id: "user-1", role: "user", parentId: "assistant-1" },
      { id: "assistant-1", role: "assistant", parentId: "user-1" }
    ])).toThrow("cannot contain a cycle");
  });

  it("rejects duplicate ids", () => {
    expect(() => assertPortalMessageRepositoryIntegrity([
      { id: "user-1", role: "user", parentId: null },
      { id: "user-1", role: "user", parentId: null }
    ])).toThrow("ids must be unique");
  });
});
