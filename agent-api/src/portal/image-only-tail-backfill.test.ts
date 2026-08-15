import { describe, expect, it } from "vitest";

import {
  planImageOnlyTailBackfill,
  recoveredImageAssistantMessage,
  type ImageOnlyBackfillArtifact,
  type ImageOnlyBackfillMessage
} from "./image-only-tail-backfill.js";

function message(input: Partial<ImageOnlyBackfillMessage> & Pick<ImageOnlyBackfillMessage, "id" | "externalId" | "role" | "position" | "createdAt">): ImageOnlyBackfillMessage {
  return {
    parentId: null,
    updatedAt: input.createdAt,
    content: {},
    runConfig: null,
    ...input
  };
}

function artifact(input: Partial<ImageOnlyBackfillArtifact> & Pick<ImageOnlyBackfillArtifact, "id" | "relativePath" | "createdAt">): ImageOnlyBackfillArtifact {
  return {
    previewStatus: "ready",
    downloadStatus: "ready",
    workspaceFileId: null,
    workspaceFileVersionId: null,
    updatedAt: input.createdAt,
    ...input
  };
}

describe("image-only tail backfill", () => {
  it("interleaves recovered assistants and reconnects the dangling user tail", () => {
    const base = new Date("2026-08-15T12:00:00Z");
    const plan = planImageOnlyTailBackfill({
      threadId: "thread-1",
      headId: "user-2",
      after: new Date("2026-08-15T12:00:30Z"),
      messages: [
        message({ id: "db-a", externalId: "assistant-0", role: "assistant", position: 0, createdAt: base }),
        message({ id: "db-u1", externalId: "user-1", role: "user", parentId: "assistant-0", position: 1, createdAt: new Date("2026-08-15T12:01:00Z") }),
        message({ id: "db-u2", externalId: "user-2", role: "user", parentId: "assistant-0", position: 2, createdAt: new Date("2026-08-15T12:02:00Z") })
      ],
      artifacts: [
        artifact({ id: "artifact-1", relativePath: "outputs/one.png", createdAt: new Date("2026-08-15T12:01:30Z") }),
        artifact({ id: "artifact-2", relativePath: "outputs/two.png", createdAt: new Date("2026-08-15T12:02:30Z") })
      ]
    });

    expect(plan.turns).toHaveLength(2);
    expect(plan.turns[0]).toMatchObject({ userParentId: "assistant-0", userPosition: 1, assistantPosition: 2 });
    expect(plan.turns[1]?.userParentId).toBe(plan.turns[0]?.assistantId);
    expect(plan.turns[1]).toMatchObject({ userPosition: 3, assistantPosition: 4 });
    expect(plan.headAfter).toBe(plan.turns[1]?.assistantId);
    expect(recoveredImageAssistantMessage(plan.turns[0]!).content).toMatchObject([
      { type: "text" },
      { type: "data", name: "codex_file_change", data: { changes: [{ artifact_id: "artifact-1" }] } }
    ]);
  });

  it("refuses a non-contiguous tail or a turn without a ready artifact", () => {
    const base = new Date("2026-08-15T12:00:00Z");
    expect(() => planImageOnlyTailBackfill({
      threadId: "thread-1",
      headId: "assistant-later",
      after: base,
      messages: [
        message({ id: "db-u1", externalId: "user-1", role: "user", position: 0, createdAt: base }),
        message({ id: "db-a1", externalId: "assistant-later", role: "assistant", parentId: "other", position: 1, createdAt: new Date(base.getTime() + 1000) })
      ],
      artifacts: []
    })).toThrow("contiguous dangling user-message tail");

    expect(() => planImageOnlyTailBackfill({
      threadId: "thread-1",
      headId: "user-1",
      after: base,
      messages: [message({ id: "db-u1", externalId: "user-1", role: "user", position: 0, createdAt: base })],
      artifacts: []
    })).toThrow("No ready artifact");
  });
});
