import { describe, expect, it } from "vitest";

import { reconcileAuthoritativeFinalAnswer, type StreamTextPart } from "./stream-final-answer";

describe("reconcileAuthoritativeFinalAnswer", () => {
  it("repairs a final answer when a streamed delta is missing", () => {
    const streamed: StreamTextPart = { type: "text", text: "Understand the" };
    const processPart = { type: "data", name: "codex_process", data: { kind: "done" } };
    const parts: unknown[] = [processPart, streamed];

    const result = reconcileAuthoritativeFinalAnswer(
      parts,
      "Understand the project and its dependencies.",
      streamed
    );

    expect(result).toMatchObject({ changed: true, corrected: true, part: streamed });
    expect(streamed.text).toBe("Understand the project and its dependencies.");
    expect(parts[0]).toBe(processPart);
  });

  it("replaces a misapplied snapshot instead of appending duplicate text", () => {
    const first: StreamTextPart = { type: "text", text: "Prepare accurate" };
    const second: StreamTextPart = { type: "text", text: " updates if" };
    const parts: unknown[] = [first, { type: "data", name: "codex_commentary" }, second];

    const result = reconcileAuthoritativeFinalAnswer(parts, "Prepare accurate updates if requested.", second);

    expect(result.corrected).toBe(true);
    expect(parts.filter((part) => (part as { type?: string }).type === "text")).toEqual([
      { type: "text", text: "Prepare accurate updates if requested." }
    ]);
    expect(parts).toContainEqual({ type: "data", name: "codex_commentary" });
  });

  it("is unchanged when the stream already matches the authoritative answer", () => {
    const streamed: StreamTextPart = { type: "text", text: "Complete answer" };
    const parts: unknown[] = [streamed];

    expect(reconcileAuthoritativeFinalAnswer(parts, "Complete answer", streamed)).toEqual({
      changed: false,
      corrected: false,
      part: streamed
    });
  });

  it("is idempotent when duplicate done events arrive", () => {
    const parts: unknown[] = [];
    const first = reconcileAuthoritativeFinalAnswer(parts, "Authoritative answer");
    const second = reconcileAuthoritativeFinalAnswer(parts, "Authoritative answer", first.part);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(parts).toEqual([{ type: "text", text: "Authoritative answer" }]);
  });

  it("keeps streamed content when done does not contain an answer", () => {
    const streamed: StreamTextPart = { type: "text", text: "Visible stream" };
    const parts: unknown[] = [streamed];

    expect(reconcileAuthoritativeFinalAnswer(parts, "", streamed).changed).toBe(false);
    expect(parts).toEqual([streamed]);
  });
});
