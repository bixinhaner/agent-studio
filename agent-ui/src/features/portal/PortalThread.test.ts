import { describe, expect, it } from "vitest";

import { isThreadScrollbarPointer, isThreadViewportAtBottom } from "./PortalThread";

describe("PortalThread scroll intent", () => {
  it("only treats the viewport as bottom when it is within the visual threshold", () => {
    expect(isThreadViewportAtBottom({ scrollHeight: 1000, scrollTop: 398, clientHeight: 600 })).toBe(true);
    expect(isThreadViewportAtBottom({ scrollHeight: 1000, scrollTop: 397, clientHeight: 600 })).toBe(false);
  });

  it("recognizes mouse interaction with the scrollbar without treating content clicks as scrollbar drags", () => {
    expect(isThreadScrollbarPointer(1200, 1185, "mouse")).toBe(true);
    expect(isThreadScrollbarPointer(1200, 1160, "mouse")).toBe(false);
    expect(isThreadScrollbarPointer(1200, 1195, "touch")).toBe(false);
  });
});
