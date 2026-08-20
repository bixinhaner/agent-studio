import { describe, expect, it } from "vitest";

import { resolvePortalComposerKeyDownAction } from "./composer-keyboard";

const baseInput = {
  key: "Enter",
  keyCode: 13,
  shiftKey: false,
  isComposing: false,
  threadRunning: false
};

describe("resolvePortalComposerKeyDownAction", () => {
  it("submits a plain Enter while the thread is idle", () => {
    expect(resolvePortalComposerKeyDownAction(baseInput)).toBe("submit");
  });

  it("leaves Shift+Enter to insert a new line", () => {
    expect(resolvePortalComposerKeyDownAction({ ...baseInput, shiftKey: true })).toBe("native");
  });

  it("does not submit while the browser reports an active composition", () => {
    expect(resolvePortalComposerKeyDownAction({ ...baseInput, isComposing: true })).toBe("ime");
  });

  it("recognizes legacy 229 and Process IME boundary events", () => {
    expect(resolvePortalComposerKeyDownAction({ ...baseInput, keyCode: 229 })).toBe("ime");
    expect(resolvePortalComposerKeyDownAction({ ...baseInput, key: "Process" })).toBe("ime");
  });

  it("keeps Enter as text input while a response is running", () => {
    expect(resolvePortalComposerKeyDownAction({ ...baseInput, threadRunning: true })).toBe("native");
  });
});
