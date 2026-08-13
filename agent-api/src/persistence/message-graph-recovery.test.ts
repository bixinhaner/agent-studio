import { describe, expect, it } from "vitest";

import {
  assertRecoveredMessageGraph,
  planMessageGraphRecovery,
  planMessageGraphSuffixRebuild
} from "./message-graph-recovery.js";

function message(input: Partial<{
  id: string;
  externalId: string;
  role: string;
  parentId: string | null;
  position: number;
  createdAt: string;
}> = {}) {
  return {
    id: input.id ?? `db-${input.externalId}`,
    externalId: input.externalId ?? "user-1",
    role: input.role ?? "user",
    parentId: input.parentId ?? null,
    position: input.position ?? 0,
    createdAt: input.createdAt ?? "2026-08-12T00:00:00.000Z"
  };
}

describe("message graph recovery", () => {
  it("repairs a missing Portal parent with the nearest persisted assistant", () => {
    const plan = planMessageGraphRecovery({
      headId: "user-2",
      messages: [
        message({ externalId: "user-1", position: 0 }),
        message({ externalId: "assistant-1", role: "assistant", parentId: "user-1", position: 1 }),
        message({ externalId: "user-2", parentId: "temporary-assistant", position: 2 })
      ]
    });
    expect(plan.reasons).toContain("missing_parent");
    expect(plan.messages.find((item) => item.externalId === "user-2")?.nextParentId).toBe("assistant-1");
    expect(() => assertRecoveredMessageGraph(plan)).not.toThrow();
  });

  it("repairs the known user-assistant cycle in conversational order", () => {
    const plan = planMessageGraphRecovery({
      headId: "assistant-cycle",
      messages: [
        message({ externalId: "user-previous", position: 0 }),
        message({ externalId: "assistant-previous", role: "assistant", parentId: "user-previous", position: 1 }),
        message({ externalId: "assistant-cycle", role: "assistant", parentId: "user-cycle", position: 2 }),
        message({ externalId: "user-cycle", parentId: "assistant-cycle", position: 3 })
      ]
    });
    expect(plan.reasons).toContain("cycle");
    expect(plan.messages.find((item) => item.externalId === "user-cycle")?.nextParentId).toBe("assistant-previous");
    expect(plan.messages.find((item) => item.externalId === "assistant-cycle")?.nextParentId).toBe("user-cycle");
    expect(() => assertRecoveredMessageGraph(plan)).not.toThrow();
  });

  it("renumbers duplicate positions without changing valid parents", () => {
    const plan = planMessageGraphRecovery({
      headId: "assistant-1",
      messages: [
        message({ externalId: "user-1", position: 0 }),
        message({ externalId: "assistant-1", role: "assistant", parentId: "user-1", position: 0 })
      ]
    });
    expect(plan.reasons).toContain("duplicate_position");
    expect(plan.messages.map((item) => item.nextPosition)).toEqual([0, 1]);
    expect(plan.messages[1]?.nextParentId).toBe("user-1");
  });

  it("does not rewrite an unaffected valid branch", () => {
    const plan = planMessageGraphRecovery({
      headId: "assistant-2",
      messages: [
        message({ externalId: "user-1", position: 0 }),
        message({ externalId: "assistant-1", role: "assistant", parentId: "user-1", position: 1 }),
        message({ externalId: "assistant-2", role: "assistant", parentId: "user-1", position: 2 })
      ]
    });
    expect(plan.affected).toBe(false);
    expect(plan.messages.map((item) => item.nextParentId)).toEqual([null, "user-1", "user-1"]);
  });

  it("keeps an existing head when only positions need repair", () => {
    const plan = planMessageGraphRecovery({
      headId: "assistant-1",
      messages: [
        message({ externalId: "user-1", position: 0 }),
        message({ externalId: "assistant-1", role: "assistant", parentId: "user-1", position: 0 }),
        message({ externalId: "assistant-branch", role: "assistant", parentId: "user-1", position: 2 })
      ]
    });
    expect(plan.affected).toBe(true);
    expect(plan.headId).toBe("assistant-1");
  });

  it("rebuilds the suffix after the first orphan so every later message is on one visible chain", () => {
    const plan = planMessageGraphRecovery({
      headId: "assistant-latest",
      messages: [
        message({ externalId: "user-1", position: 0 }),
        message({ externalId: "assistant-1", role: "assistant", parentId: "user-1", position: 1 }),
        message({ externalId: "user-2", parentId: "temporary-1", position: 2 }),
        message({ externalId: "assistant-2", role: "assistant", parentId: "user-2", position: 3 }),
        message({ externalId: "user-3", parentId: "temporary-2", position: 4 }),
        message({ externalId: "assistant-latest", role: "assistant", parentId: "user-3", position: 5 })
      ]
    });
    expect(plan.messages.map((item) => item.nextParentId)).toEqual([
      null,
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2",
      "user-3"
    ]);
    expect(plan.headId).toBe("assistant-latest");
    expect(() => assertRecoveredMessageGraph(plan)).not.toThrow();
  });

  it("rebuilds from the original break point while preserving newly appended messages", () => {
    const plan = planMessageGraphSuffixRebuild({
      headId: "assistant-new",
      startExternalId: "user-2",
      messages: [
        message({ externalId: "user-1", position: 0 }),
        message({ externalId: "assistant-1", role: "assistant", parentId: "user-1", position: 1 }),
        message({ externalId: "user-2", parentId: "assistant-1", position: 2 }),
        message({ externalId: "assistant-2", role: "assistant", parentId: "user-2", position: 3 }),
        message({ externalId: "user-new", parentId: "assistant-1", position: 4 }),
        message({ externalId: "assistant-new", role: "assistant", parentId: "user-new", position: 5 })
      ]
    });
    expect(plan.messages.map((item) => item.nextParentId)).toEqual([
      null,
      "user-1",
      "assistant-1",
      "user-2",
      "assistant-2",
      "user-new"
    ]);
    expect(plan.headId).toBe("assistant-new");
  });
});
