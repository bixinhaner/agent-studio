import { describe, expect, it } from "vitest";

import { createThreadScrollFollowController } from "./thread-scroll-follow-controller";

describe("thread scroll follow controller", () => {
  it("continues following send-driven layout and streaming changes", () => {
    const controller = createThreadScrollFollowController("reading-history");

    expect(controller.onUserSend()).toBe("following");
    expect(controller.onViewportChange(false)).toBe("following");
    expect(controller.shouldFollowPassiveContent()).toBe(true);
    expect(controller.onViewportChange(false)).toBe("following");
  });

  it("stops following only after explicit user upward intent", () => {
    const controller = createThreadScrollFollowController("following");

    expect(controller.onViewportChange(false)).toBe("following");
    expect(controller.onUserScrollUp()).toBe("reading-history");
    expect(controller.onViewportChange(false)).toBe("reading-history");
    expect(controller.shouldFollowPassiveContent()).toBe(false);
  });

  it("resumes following when the reader reaches the bottom", () => {
    const controller = createThreadScrollFollowController("following");

    controller.onUserScrollUp();
    expect(controller.onViewportChange(true)).toBe("following");
    expect(controller.shouldFollowPassiveContent()).toBe(true);
  });
});
